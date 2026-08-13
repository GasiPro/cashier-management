// src/app/presentation/vews/cashier/cashier.ts
import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { WebsocketService, WsMessage } from '../../../core/service/websocket.service';
import { Subscription } from 'rxjs';
import * as XLSX from 'xlsx';

export interface Order {
  id: number;
  group_id: number;
  service_type: string;
  unit_price: number;
  /** Catalogue price before any manual adjustment by the counter (0 = not tracked). */
  original_unit_price: number;
  quantity: number;
  status: 'EN_ATTENTE' | 'PAYE' | 'REJETEE';
  time: string;
  /** Username of the counter (comptoir) that placed the order. */
  counter_username: string;
  created_at: string;
  paid_at: string | null;
  /** Free-text note left by the counter for the cashier when the order was placed. */
  observation: string;
  /** Optional reason given by the cashier when cancelling (rejecting) this order. */
  raison: string | null;
}

export interface OrderGroup {
  groupId: number;
  lines: Order[];
  totalAmount: number;
  time: string;
  createdAt: string;
  paidAt?: string | null;
  /** Username of the counter (comptoir) that placed the order. */
  counterUsername: string;
}

/** One day's worth of paid history, pre-grouped for the Historique panel. */
interface HistoriqueDayGroup {
  dayLabel: string;
  groups: OrderGroup[];
  count: number;
  totalAmount: number;
}

interface RapportLine {
  label: string;
  unitPrice: number;
  qty: number;
  total: number;
  /** Catalogue price before any manual adjustment by the counter. */
  originalUnitPrice: number;
  /** True if this line includes at least one order sold below its catalogue price. */
  discounted: boolean;
  /** True if this line includes at least one order sold above its catalogue price. */
  increased: boolean;
}

interface RapportCategoryGroup {
  category: string;
  lines: RapportLine[];
}

/** Granularité de la période couverte par le Rapport. */
type RapportPeriod = 'jour' | 'semaine' | 'mois' | 'annee';

/** Bornes (dates ISO, incluses) d'une période du Rapport. */
interface RapportPeriodBounds {
  start: string;
  end: string;
}

/** Detail of the Rapport (catégorie/service), scoped to a single comptoir username. */
interface RapportUserSection {
  username: string;
  groups: RapportCategoryGroup[];
  total: number;
}

/** Revenue/client rollup for one comptoir within the Rapport period. */
interface RapportCounterBreakdown {
  username: string;
  total: number;
  clients: number;
}

/** Result of comparing the Rapport's revenue against the previous day's. */
interface RapportRevenueTrend {
  previousRevenue: number;
  /** null when there is no prior-day data to compare against. */
  changePercent: number | null;
}

/** Rollup of manually-adjusted prices (remises/majorations) across the Rapport period. */
interface RapportAdjustmentsSummary {
  discountCount: number;
  increaseCount: number;
  /** Net effect on revenue of every adjusted line (unit_price - original_unit_price) × quantity. */
  netImpact: number;
}

export interface ConnectionRequest {
  addr: string;
  username: string;
}

export interface ConnectedDevice {
  addr: string;
  username: string;
}

const CASHIER_LOCAL_WS_URL = 'ws://127.0.0.1:8080';
const LS_USERNAME = 'gasipro:username';
const HISTORIQUE_ALL_COUNTERS = 'Tous';

@Component({
  selector: 'app-cashier',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cashier.html',
})
export class Cashier implements OnInit, OnDestroy {
  // ── Identity ────────────────────────────────────────────────────────────────
  username = localStorage.getItem(LS_USERNAME) ?? 'Caisse';

  // ── Order state (from WS broadcast) ─────────────────────────────────────────
  currentTime = signal('');
  pendingGroups = signal<OrderGroup[]>([]);
  paidGroups = signal<OrderGroup[]>([]);
  recentPaidGroups = computed(() => this.paidGroups().slice(0, 5));
  /** Encaissements du jour uniquement — utilisé pour les compteurs de la barre de navigation. */
  todaysPaidGroups = computed(() => this.paidGroups().filter((g) => g.paidAt && this.isToday(g.paidAt)));
  totalRevenue = signal(0);
  /** Total encaissé aujourd'hui uniquement — utilisé pour les compteurs de la barre de navigation. */
  todaysRevenue = computed(() =>
    this.todaysPaidGroups().reduce((sum, g) => sum + g.totalAmount, 0),
  );
  volumeByService = signal<Record<string, number>>({});
  wsConnected = signal(false);

  // ── Device management (from WS broadcast) ────────────────────────────────────
  pendingRequests = signal<ConnectionRequest[]>([]);
  connectedDevices = signal<ConnectedDevice[]>([]);
  showDevicesPanel = false;

  // ── UI ──────────────────────────────────────────────────────────────────────
  showMenu = false;
  showRapport = false;
  showHistorique = false;

  // ── Toast feedback (e.g. export success/failure) ─────────────────────────────
  toastVisible = signal(false);
  toastMessage = signal('');
  /** True while the xlsx export is in progress — drives aria-busy/disabled on the export button. */
  exportingRapport = signal(false);

  // ── Rapport: selected period / date ───────────────────────────────────────────
  /** Granularité actuellement affichée : jour, semaine (lundi–samedi), mois civil ou année civile. */
  rapportPeriod = signal<RapportPeriod>('jour');
  rapportSelectedDate = signal<string>(this.formatIsoDate(new Date()));
  showRapportDatePicker = signal(false);
  wsAddress = signal('');
  /** Order group currently shown in the full-detail modal, if any. */
  selectedGroup = signal<OrderGroup | null>(null);

  // ── Reject (cancel) order dialog ─────────────────────────────────────────────
  /** Group currently targeted by the reject confirmation dialog, if any. */
  rejectGroupTarget = signal<OrderGroup | null>(null);
  /** Optional reason ("raison") entered by the cashier for the pending cancellation. */
  rejectReason = signal('');

  // ── Historique: per-counter filter ───────────────────────────────────────────
  readonly historiqueAllCounters = HISTORIQUE_ALL_COUNTERS;
  selectedHistoriqueUser = signal<string>(HISTORIQUE_ALL_COUNTERS);
  /** Distinct counter usernames present in the paid history, sorted alphabetically. */
  historiqueUsernames = computed(() => {
    const names = new Set(this.paidGroups().map((g) => g.counterUsername).filter(Boolean));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  });
  /** Paid history filtered to the currently selected counter, if any. */
  filteredHistoriqueGroups = computed(() => {
    const user = this.selectedHistoriqueUser();
    const groups = this.paidGroups();
    return user === HISTORIQUE_ALL_COUNTERS ? groups : groups.filter((g) => g.counterUsername === user);
  });
  /** Sum of the currently filtered history — the running total a cashier checks first. */
  historiqueTotalAmount = computed(() =>
    this.filteredHistoriqueGroups().reduce((sum, g) => sum + g.totalAmount, 0),
  );
  /**
   * Filtered history split into day buckets (most recent day first, groups within a day
   * already newest-first), each carrying its own count and subtotal for quick scanning.
   */
  historiqueGroupsByDay = computed<HistoriqueDayGroup[]>(() => {
    const days: HistoriqueDayGroup[] = [];
    const byLabel = new Map<string, HistoriqueDayGroup>();
    for (const group of this.filteredHistoriqueGroups()) {
      const dayLabel = group.paidAt ? this.formatRelativeDay(group.paidAt) : 'Date inconnue';
      let bucket = byLabel.get(dayLabel);
      if (!bucket) {
        bucket = { dayLabel, groups: [], count: 0, totalAmount: 0 };
        byLabel.set(dayLabel, bucket);
        days.push(bucket);
      }
      bucket.groups.push(group);
      bucket.count += 1;
      bucket.totalAmount += group.totalAmount;
    }
    return days;
  });

  private _rawPaidOrders: Order[] = [];
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;

  constructor(
    private router: Router,
    private ws: WebsocketService,
  ) {}

  ngOnInit(): void {
    // Load WS address for display in header
    invoke<string>('get_ws_address')
      .then((addr) => this.wsAddress.set(addr))
      .catch(() => this.wsAddress.set('ws://127.0.0.1:8080'));

    // Subscribe to messages
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      this.wsConnected.set(true);
      if (msg.type === 'orders') {
        this.applyOrders(msg.data as Order[]);
      } else if (msg.type === 'time') {
        this.currentTime.set(msg.data as string);
      } else if (msg.type === 'connection_requests') {
        this.pendingRequests.set(msg.data as ConnectionRequest[]);
      } else if (msg.type === 'connected_devices') {
        this.connectedDevices.set(msg.data as ConnectedDevice[]);
      }
    });

    // Connect and register as cashier when the socket opens
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      this.ws.send({ type: 'cashier_register', username: this.username });
    });

    this.ws.connect(CASHIER_LOCAL_WS_URL);

    // If socket is already open (e.g. navigated back from elsewhere), register immediately
    if (this.ws.isOpen()) {
      this.ws.send({ type: 'cashier_register', username: this.username });
    }
  }

  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
  }

  // ── Device management ────────────────────────────────────────────────────────

  get totalPendingRequests(): number {
    return this.pendingRequests().length;
  }

  async approveDevice(addr: string): Promise<void> {
    try {
      await invoke('approve_connection', { addr });
    } catch (e) {
      console.error('approve_connection failed', e);
    }
  }

  async rejectDevice(addr: string): Promise<void> {
    try {
      await invoke('reject_connection', { addr });
    } catch (e) {
      console.error('reject_connection failed', e);
    }
  }

  async disconnectDevice(addr: string): Promise<void> {
    try {
      await invoke('disconnect_device', { addr });
    } catch (e) {
      console.error('disconnect_device failed', e);
    }
  }

  // ── Rust bridge ───────────────────────────────────────────────────────────────

  async markGroupAsPaid(groupId: number): Promise<void> {
    await invoke('mark_group_as_paid', { groupId });
  }

  /** Refuse an entire pending order (e.g. rupture de stock, client parti). */
  async rejectGroup(groupId: number, raison?: string): Promise<void> {
    try {
      await invoke('reject_group', { groupId, raison: raison?.trim() ? raison.trim() : null });
    } catch (e) {
      console.error('reject_group failed', e);
    }
  }

  // ── Reject (cancel) order dialog ─────────────────────────────────────────────

  /** Open the reject confirmation dialog for a group, optionally closing the detail modal. */
  openRejectDialog(group: OrderGroup): void {
    this.rejectReason.set('');
    this.rejectGroupTarget.set(group);
    this.selectedGroup.set(null);
  }

  closeRejectDialog(): void {
    this.rejectGroupTarget.set(null);
    this.rejectReason.set('');
  }

  /** Confirm the cancellation from the reject dialog, including the optional raison. */
  async confirmRejectGroup(): Promise<void> {
    const group = this.rejectGroupTarget();
    if (!group) return;
    await this.rejectGroup(group.groupId, this.rejectReason());
    this.closeRejectDialog();
  }

  copyWsAddress(): void {
    navigator.clipboard.writeText(this.wsAddress()).catch(() => {});
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  // ── Order detail modal ────────────────────────────────────────────────────────

  /** Open the full-detail modal for a given order group (pending or paid). */
  openGroupDetail(g: OrderGroup): void {
    this.selectedGroup.set(g);
  }

  closeGroupDetail(): void {
    this.selectedGroup.set(null);
  }

  /** True if the given group is still awaiting payment (not yet settled). */
  isGroupPending(g: OrderGroup): boolean {
    return !g.paidAt;
  }

  // ── Template helpers ─────────────────────────────────────────────────────────

  formatGroupId(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }

  /** True if a placed order line's price was edited down from its original catalogue price. */
  isLineDiscounted(order: Order): boolean {
    return order.original_unit_price > 0 && order.unit_price < order.original_unit_price;
  }

  /** True if a placed order line's price was edited up from its original catalogue price. */
  isLineIncreased(order: Order): boolean {
    return order.original_unit_price > 0 && order.unit_price > order.original_unit_price;
  }

  /** True if any line of the group carries a manually-applied discount. */
  groupHasDiscount(group: OrderGroup): boolean {
    return group.lines.some((l) => this.isLineDiscounted(l));
  }

  /** True if any line of the group carries a manually-applied price increase. */
  groupHasIncrease(group: OrderGroup): boolean {
    return group.lines.some((l) => this.isLineIncreased(l));
  }

  /**
   * Brief, categorized summary of a group's lines, e.g.
   * "Impression: Couleur x4, Normal NB x8 • Reliure: Spirale x2".
   */
  getGroupItemsSummary(group: OrderGroup): string {
    const categoryOrder: string[] = [];
    const byCategory = new Map<string, string[]>();
    for (const l of group.lines) {
      const parts = l.service_type.split(' — ');
      const category = parts.length > 1 ? parts[0] : 'Autre';
      const label = parts.length > 1 ? parts[1] : l.service_type;
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
        categoryOrder.push(category);
      }
      byCategory.get(category)!.push(`${label} x${l.quantity}`);
    }
    return categoryOrder
      .map((category) => `${category}: ${byCategory.get(category)!.join(', ')}`)
      .join(' • ');
  }

  /** Set which counter's history should be shown in the Historique panel ('Tous' = all). */
  setHistoriqueUserFilter(username: string): void {
    this.selectedHistoriqueUser.set(username);
  }

  /** \"aujourd'hui\", \"hier\", or the localized date, based on the given ISO timestamp. */
  private formatRelativeDay(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

    if (diffDays === 0) return "aujourd'hui";
    if (diffDays === 1) return 'hier';
    return date.toLocaleDateString('fr-FR');
  }

  /** Human-readable "Encaissé aujourd'hui/hier/le JJ/MM/AAAA à HH:MM" label for the history table. */
  formatPaidLabel(group: OrderGroup): string {
    if (!group.paidAt) return '';
    const date = new Date(group.paidAt);
    const dayLabel = this.formatRelativeDay(group.paidAt);
    const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `Encaissé ${dayLabel} à ${time}`;
  }

  /** Time-only "HH:MM" label for a paid group — used inside the Historique panel, where entries are already grouped by day. */
  formatPaidTime(group: OrderGroup): string {
    if (!group.paidAt) return '';
    return new Date(group.paidAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  /** Total quantity of items across a group's lines, for the compact "N articles" indicator in the history list. */
  historiqueItemCount(group: OrderGroup): number {
    return group.lines.reduce((sum, l) => sum + l.quantity, 0);
  }

  /** Human-readable "aujourd'hui/hier/JJ/MM/AAAA à HH:MM" label for a pending order's creation time. */
  formatCreatedLabel(group: OrderGroup): string {
    const dayLabel = this.formatRelativeDay(group.createdAt);
    return `${dayLabel} à ${group.time}`;
  }

  rapportGroups(): RapportCategoryGroup[] {
    return this.buildRapportGroups(this.rapportPaidOrders());
  }

  /** Détail du rapport (catégorie/service), séparé par comptoir, avec le total de chacun. */
  rapportGroupsByUsername(): RapportUserSection[] {
    const byUser = new Map<string, Order[]>();
    for (const order of this.rapportPaidOrders()) {
      const key = order.counter_username || 'Non renseigné';
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(order);
    }
    return Array.from(byUser.entries())
      .map(([username, orders]) => ({
        username,
        groups: this.buildRapportGroups(orders),
        total: orders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }

  /** Regroupe une liste de commandes par catégorie puis par service, avec quantités et totaux cumulés. */
  private buildRapportGroups(orders: Order[]): RapportCategoryGroup[] {
    const map = new Map<string, Map<string, RapportLine>>();
    for (const order of orders) {
      const [category, label] = order.service_type.split(' — ');
      const key = label ?? order.service_type;
      if (!map.has(category)) map.set(category, new Map());
      const cat = map.get(category)!;
      if (!cat.has(key)) {
        cat.set(key, {
          label: key,
          unitPrice: order.unit_price,
          qty: 0,
          total: 0,
          originalUnitPrice: order.original_unit_price,
          discounted: false,
          increased: false,
        });
      }
      const entry = cat.get(key)!;
      entry.qty += order.quantity;
      entry.total += order.quantity * order.unit_price;
      entry.discounted = entry.discounted || this.isLineDiscounted(order);
      entry.increased = entry.increased || this.isLineIncreased(order);
    }
    return Array.from(map.entries()).map(([category, lines]) => ({
      category,
      lines: Array.from(lines.values()).sort((a, b) => b.total - a.total),
    }));
  }

  /** Répartition du chiffre d'affaires du rapport par comptoir, triée du plus grand au plus petit. */
  rapportByCounter(): RapportCounterBreakdown[] {
    const map = new Map<string, { total: number; groupIds: Set<number> }>();
    for (const order of this.rapportPaidOrders()) {
      const key = order.counter_username || 'Non renseigné';
      if (!map.has(key)) map.set(key, { total: 0, groupIds: new Set() });
      const entry = map.get(key)!;
      entry.total += order.quantity * order.unit_price;
      entry.groupIds.add(order.group_id);
    }
    return Array.from(map.entries())
      .map(([username, v]) => ({ username, total: v.total, clients: v.groupIds.size }))
      .sort((a, b) => b.total - a.total);
  }

  /** Panier moyen (chiffre d'affaires / nombre de clients) du rapport. */
  rapportAverageBasket(): number {
    const clients = this.rapportClientsCount();
    return clients === 0 ? 0 : this.rapportRevenue() / clients;
  }

  /** Quantité totale d'articles vendus sur la période du rapport. */
  rapportItemsCount(): number {
    return this.rapportPaidOrders().reduce((sum, o) => sum + o.quantity, 0);
  }

  /** Les catégories les plus vendues (par chiffre d'affaires), tous comptoirs confondus. */
  rapportTopServices(limit = 5): RapportLine[] {
    return this.rapportGroups()
      .map(
        (g): RapportLine => ({
          label: g.category,
          unitPrice: 0,
          qty: g.lines.reduce((sum, l) => sum + l.qty, 0),
          total: g.lines.reduce((sum, l) => sum + l.total, 0),
          originalUnitPrice: 0,
          discounted: g.lines.some((l) => l.discounted),
          increased: g.lines.some((l) => l.increased),
        }),
      )
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }

  /** Part (en %) du chiffre d'affaires total que représente une ligne — pour la mini barre de progression. */
  rapportLineShare(line: RapportLine): number {
    const revenue = this.rapportRevenue();
    return revenue === 0 ? 0 : Math.round((line.total / revenue) * 100);
  }

  /** Résumé des ajustements de prix (remises et majorations) appliqués par les comptoirs sur la période. */
  rapportAdjustmentsSummary(): RapportAdjustmentsSummary {
    let discountCount = 0;
    let increaseCount = 0;
    let netImpact = 0;
    for (const order of this.rapportPaidOrders()) {
      if (this.isLineDiscounted(order)) discountCount += 1;
      if (this.isLineIncreased(order)) increaseCount += 1;
      if (order.original_unit_price > 0) {
        netImpact += (order.unit_price - order.original_unit_price) * order.quantity;
      }
    }
    return { discountCount, increaseCount, netImpact };
  }

  /** Compare le chiffre d'affaires de la période sélectionnée (jour/semaine/année) à celui de la période précédente. */
  rapportRevenueTrend(): RapportRevenueTrend {
    const previous = this.previousPeriodBounds(this.rapportSelectedDate(), this.rapportPeriod());
    const current = this.rapportPeriodBounds();
    const previousRevenue = this.revenueForPeriod(previous);
    const currentRevenue = this.revenueForPeriod(current);
    if (previousRevenue === 0) {
      return { previousRevenue, changePercent: currentRevenue > 0 ? 100 : null };
    }
    return {
      previousRevenue,
      changePercent: Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100),
    };
  }

  /** Change la granularité du rapport (jour/semaine/année) en conservant la date d'ancrage. */
  setRapportPeriod(period: RapportPeriod): void {
    if (this.rapportPeriod() === period) return;
    this.rapportPeriod.set(period);
    this.showRapportDatePicker.set(false);
  }

  /** Positionne le rapport sur la période courante (aujourd'hui / semaine en cours / année en cours). */
  setRapportCurrentPeriod(): void {
    this.rapportSelectedDate.set(this.formatIsoDate(new Date()));
    this.showRapportDatePicker.set(false);
  }

  /** Positionne le rapport sur la période précédant immédiatement la période courante. */
  setRapportPreviousPeriod(): void {
    const todayIso = this.formatIsoDate(new Date());
    const previous = this.previousPeriodBounds(todayIso, this.rapportPeriod());
    this.rapportSelectedDate.set(previous.start);
    this.showRapportDatePicker.set(false);
  }

  /** True si la période sélectionnée du rapport couvre la date d'aujourd'hui. */
  isRapportCurrentPeriod(): boolean {
    const todayIso = this.formatIsoDate(new Date());
    const bounds = this.rapportPeriodBounds();
    return todayIso >= bounds.start && todayIso <= bounds.end;
  }

  /** True si la période sélectionnée du rapport est celle précédant immédiatement la période courante. */
  isRapportPreviousPeriod(): boolean {
    const todayIso = this.formatIsoDate(new Date());
    const previous = this.previousPeriodBounds(todayIso, this.rapportPeriod());
    const anchor = this.rapportSelectedDate();
    return anchor >= previous.start && anchor <= previous.end;
  }

  /** True si la période sélectionnée du rapport n'est ni la période courante ni la précédente — sélection manuelle. */
  isRapportCustomPeriod(): boolean {
    return !this.isRapportCurrentPeriod() && !this.isRapportPreviousPeriod();
  }

  /** Libellé du raccourci "période courante", adapté à la granularité sélectionnée. */
  rapportCurrentPeriodLabel(): string {
    switch (this.rapportPeriod()) {
      case 'semaine':
        return 'Cette semaine';
      case 'mois':
        return 'Ce mois-ci';
      case 'annee':
        return 'Cette année';
      default:
        return "Aujourd'hui";
    }
  }

  /** Libellé du raccourci "période précédente", adapté à la granularité sélectionnée. */
  rapportPreviousPeriodLabel(): string {
    switch (this.rapportPeriod()) {
      case 'semaine':
        return 'Semaine dernière';
      case 'mois':
        return 'Mois dernier';
      case 'annee':
        return 'Année dernière';
      default:
        return 'Hier';
    }
  }

  /** Libellé désignant la période de comparaison ("Veille", "Semaine précédente", "Mois précédent", "Année précédente"). */
  rapportComparisonLabel(): string {
    switch (this.rapportPeriod()) {
      case 'semaine':
        return 'Semaine précédente';
      case 'mois':
        return 'Mois précédent';
      case 'annee':
        return 'Année précédente';
      default:
        return 'Veille';
    }
  }

  /** Valeur "AAAA-Www" (semaine ISO) de la semaine ancrant le rapport, pour l'input[type=week]. */
  rapportWeekInputValue(): string {
    const { start } = this.rapportPeriodBounds();
    return this.toIsoWeekValue(this.parseIsoDate(start));
  }

  /** Applique la semaine ISO choisie ("AAAA-Www") comme nouvelle ancre du rapport. */
  onRapportWeekChange(value: string): void {
    const match = /^(\d{4})-W(\d{2})$/.exec(value);
    if (!match) return;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const monday = this.mondayOfIsoWeek(year, week);
    this.rapportSelectedDate.set(this.formatIsoDate(monday));
    this.showRapportDatePicker.set(false);
  }

  /** Valeur "AAAA-MM" du mois ancrant le rapport, pour l'input[type=month]. */
  rapportMonthInputValue(): string {
    const anchor = this.parseIsoDate(this.rapportSelectedDate());
    return `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Applique le mois choisi ("AAAA-MM") comme nouvelle ancre du rapport. */
  onRapportMonthChange(value: string): void {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return;
    this.rapportSelectedDate.set(`${year}-${String(month).padStart(2, '0')}-01`);
    this.showRapportDatePicker.set(false);
  }

  /** Année civile actuellement sélectionnée pour le rapport, pour l'input[type=number]. */
  rapportYearInputValue(): number {
    return this.parseIsoDate(this.rapportSelectedDate()).getFullYear();
  }

  /** Applique l'année civile saisie comme nouvelle ancre du rapport. */
  onRapportYearChange(value: string): void {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
    this.rapportSelectedDate.set(`${year}-01-01`);
    this.showRapportDatePicker.set(false);
  }

  /** Bornes [début, fin] (dates ISO incluses) de la période actuellement sélectionnée pour le rapport. */
  private rapportPeriodBounds(): RapportPeriodBounds {
    return this.periodBounds(this.rapportSelectedDate(), this.rapportPeriod());
  }

  /** Bornes [début, fin] de la période (jour/semaine/année) ancrée sur la date ISO donnée. */
  private periodBounds(anchorIso: string, period: RapportPeriod): RapportPeriodBounds {
    const anchor = this.parseIsoDate(anchorIso);
    switch (period) {
      case 'semaine': {
        // Semaine commerciale : du lundi au samedi (pas de dimanche).
        const start = this.startOfIsoWeek(anchor);
        const end = new Date(start);
        end.setDate(end.getDate() + 5);
        return { start: this.formatIsoDate(start), end: this.formatIsoDate(end) };
      }
      case 'mois': {
        const year = anchor.getFullYear();
        const month = anchor.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();
        return {
          start: `${year}-${String(month + 1).padStart(2, '0')}-01`,
          end: `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
        };
      }
      case 'annee': {
        const year = anchor.getFullYear();
        return { start: `${year}-01-01`, end: `${year}-12-31` };
      }
      default:
        return { start: anchorIso, end: anchorIso };
    }
  }

  /** Bornes de la période immédiatement précédente (jour/semaine/mois/année) par rapport à une date d'ancrage donnée. */
  private previousPeriodBounds(anchorIso: string, period: RapportPeriod): RapportPeriodBounds {
    const anchor = this.parseIsoDate(anchorIso);
    switch (period) {
      case 'semaine': {
        const prevAnchor = new Date(anchor);
        prevAnchor.setDate(prevAnchor.getDate() - 7);
        return this.periodBounds(this.formatIsoDate(prevAnchor), period);
      }
      case 'mois': {
        const prevAnchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
        return this.periodBounds(this.formatIsoDate(prevAnchor), period);
      }
      case 'annee': {
        const prevAnchor = new Date(anchor.getFullYear() - 1, 0, 1);
        return this.periodBounds(this.formatIsoDate(prevAnchor), period);
      }
      default: {
        const d = new Date(anchor);
        d.setDate(d.getDate() - 1);
        const iso = this.formatIsoDate(d);
        return { start: iso, end: iso };
      }
    }
  }

  /** Lundi (ISO) de la semaine contenant la date donnée. */
  private startOfIsoWeek(d: Date): Date {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = date.getDay(); // 0 = dimanche
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date;
  }

  /** Convertit une date en valeur "AAAA-Www" (semaine ISO 8601) pour l'input[type=week]. */
  private toIsoWeekValue(d: Date): string {
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayNumber = (target.getDay() + 6) % 7; // 0 = lundi
    target.setDate(target.getDate() - dayNumber + 3); // jeudi de la semaine ISO
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const firstThursdayDay = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstThursdayDay + 3);
    const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
    return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  /** Reconstruit le lundi de la semaine ISO 8601 "année/numéro de semaine" donnée. */
  private mondayOfIsoWeek(year: number, week: number): Date {
    const jan4 = new Date(year, 0, 4);
    const jan4Day = (jan4.getDay() + 6) % 7; // 0 = lundi
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - jan4Day);
    const target = new Date(week1Monday);
    target.setDate(week1Monday.getDate() + (week - 1) * 7);
    return target;
  }

  /** Chiffre d'affaires encaissé sur une période [début, fin] donnée (dates ISO incluses). */
  private revenueForPeriod(bounds: RapportPeriodBounds): number {
    return this._rawPaidOrders
      .filter((o) => o.paid_at && this.isWithinRapportPeriod(o.paid_at, bounds))
      .reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }

  /** True si la date ISO (issue d'un timestamp) tombe dans les bornes [début, fin] données. */
  private isWithinRapportPeriod(iso: string, bounds: RapportPeriodBounds): boolean {
    const day = this.formatIsoDate(new Date(iso));
    return day >= bounds.start && day <= bounds.end;
  }

  /** Chiffre d'affaires du rapport (période et, pour un jour, plage horaire sélectionnées). */
  rapportRevenue(): number {
    return this.rapportPaidOrders().reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }

  /** Nombre de clients (commandes distinctes) encaissés sur la date/plage sélectionnée. */
  rapportClientsCount(): number {
    return new Set(this.rapportPaidOrders().map((o) => o.group_id)).size;
  }

  /**
   * Bornes [début, fin] réellement couvertes par les commandes du rapport : du jour de la première
   * à celui de la dernière commande encaissée dans les bornes calendaires données. À défaut de
   * commande, retombe sur les bornes calendaires elles-mêmes.
   */
  private rapportOrdersDateBounds(bounds: RapportPeriodBounds): RapportPeriodBounds {
    const days = this._rawPaidOrders
      .filter((o) => o.paid_at && this.isWithinRapportPeriod(o.paid_at, bounds))
      .map((o) => this.formatIsoDate(new Date(o.paid_at as string)))
      .sort();
    if (days.length === 0) return bounds;
    return { start: days[0], end: days[days.length - 1] };
  }

  /** Libellé "4 au 10 août 2026" (ou date unique si début = fin) pour des bornes de dates ISO données. */
  private rapportRangeLabel(bounds: RapportPeriodBounds): string {
    const startLabel = this.parseIsoDate(bounds.start).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
    });
    const endLabel = this.parseIsoDate(bounds.end).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return bounds.start === bounds.end ? endLabel : `${startLabel} au ${endLabel}`;
  }

  /**
   * Libellé de la période du rapport, adapté à la granularité sélectionnée : jour ("mardi 4 août
   * 2026"), ou, pour semaine/mois/année, le jour de la première à la dernière commande encaissée
   * dans la période ("Semaine du 4 au 8 août 2026", "4 au 29 août 2026", "3 janvier au 20 décembre 2026").
   */
  rapportDateLabel(): string {
    const anchor = this.parseIsoDate(this.rapportSelectedDate());
    switch (this.rapportPeriod()) {
      case 'semaine':
        return `Semaine du ${this.rapportRangeLabel(this.rapportOrdersDateBounds(this.rapportPeriodBounds()))}`;
      case 'mois':
      case 'annee':
        return this.rapportRangeLabel(this.rapportOrdersDateBounds(this.rapportPeriodBounds()));
      default:
        return anchor.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
    }
  }

  /** Titre du rapport tel qu'exporté, adapté à la granularité sélectionnée. */
  rapportTitle(): string {
    switch (this.rapportPeriod()) {
      case 'semaine':
        return 'Rapport de la semaine';
      case 'mois':
        return 'Rapport du mois';
      case 'annee':
        return "Rapport de l'année";
      default:
        return 'Rapport du jour';
    }
  }

  /** Nom de fichier par défaut proposé lors de l'export, adapté à la granularité sélectionnée. */
  private rapportDefaultFileName(): string {
    switch (this.rapportPeriod()) {
      case 'semaine': {
        const { start, end } = this.rapportPeriodBounds();
        return `rapport_semaine_${start}_au_${end}.xlsx`;
      }
      case 'mois':
        return `rapport_mois_${this.rapportMonthInputValue()}.xlsx`;
      case 'annee':
        return `rapport_annee_${this.rapportYearInputValue()}.xlsx`;
      default:
        return `rapport_du_jour_${this.rapportSelectedDate()}.xlsx`;
    }
  }

  /** Plage horaire couverte par le rapport (période "jour" uniquement) : de la première à la dernière commande encaissée ce jour-là. */
  rapportTimeRange(): string {
    const orders = this.rapportPaidOrders();
    if (orders.length === 0) return '';
    const timestamps = orders
      .map((o) => new Date(o.paid_at as string).getTime())
      .sort((a, b) => a - b);
    const format = (t: number) =>
      new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `${format(timestamps[0])} – ${format(timestamps[timestamps.length - 1])}`;
  }

  /** Ouvre/ferme le sélecteur de date du rapport. */
  toggleRapportDatePicker(): void {
    this.showRapportDatePicker.update((v) => !v);
  }

  /** Applique la date choisie dans le sélecteur du rapport. */
  onRapportDateChange(value: string): void {
    if (!value) return;
    this.rapportSelectedDate.set(value);
    this.showRapportDatePicker.set(false);
  }

  /** Affiche un toast temporaire (auto-masqué après 3s), annoncé aux lecteurs d'écran via aria-live. */
  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    this.toastVisible.set(true);
    setTimeout(() => this.toastVisible.set(false), 3000);
  }

  /** Exporte le rapport du jour en cours au format Excel (.xlsx), mis en forme pour la lisibilité. */
  async exportRapportXlsx(): Promise<void> {
    this.exportingRapport.set(true);
    try {
      await this.buildAndSaveRapportXlsx();
    } finally {
      this.exportingRapport.set(false);
    }
  }

  /** Construit le classeur du rapport et l'enregistre à l'emplacement choisi par l'utilisateur. */
  private async buildAndSaveRapportXlsx(): Promise<void> {
    const rows: (string | number)[][] = [];
    const currencyCells: { r: number; c: number }[] = [];
    const usernameHeaderRows: number[] = [];

    const pushRow = (row: (string | number)[]): number => {
      rows.push(row);
      return rows.length - 1;
    };

    const titleRow = pushRow([this.rapportTitle()]);
    const dateRow = pushRow([this.rapportDateLabel()]);
    pushRow([]);

    const revenueRow = pushRow(["Chiffre d'affaires", this.rapportRevenue()]);
    currencyCells.push({ r: revenueRow, c: 1 });

    const trend = this.rapportRevenueTrend();
    const comparisonLabel = this.rapportComparisonLabel();
    const previousRevenueRow = pushRow([`Chiffre d'affaires (${comparisonLabel.toLowerCase()})`, trend.previousRevenue]);
    currencyCells.push({ r: previousRevenueRow, c: 1 });
    if (trend.changePercent !== null) {
      pushRow([`Évolution vs ${comparisonLabel.toLowerCase()}`, `${trend.changePercent >= 0 ? '+' : ''}${trend.changePercent}%`]);
    }

    pushRow(['Transactions', this.rapportClientsCount()]);

    const avgBasketRow = pushRow(['Panier moyen', this.rapportAverageBasket()]);
    currencyCells.push({ r: avgBasketRow, c: 1 });

    pushRow(['Articles vendus', this.rapportItemsCount()]);

    if (this.rapportPeriod() === 'jour' && this.rapportTimeRange()) {
      pushRow(['Plage horaire', this.rapportTimeRange()]);
    }

    const counters = this.rapportByCounter();
    if (counters.length > 1) {
      pushRow([]);
      pushRow(['Comptoir', 'Transactions', 'Total (Ar)']);
      for (const counter of counters) {
        const r = pushRow([counter.username, counter.clients, counter.total]);
        currencyCells.push({ r, c: 2 });
      }
    }

    const adjustments = this.rapportAdjustmentsSummary();
    if (adjustments.discountCount > 0 || adjustments.increaseCount > 0) {
      pushRow([]);
      pushRow(['Remises appliquées', adjustments.discountCount]);
      pushRow(['Majorations appliquées', adjustments.increaseCount]);
      const netImpactRow = pushRow(['Impact net des ajustements (Ar)', adjustments.netImpact]);
      currencyCells.push({ r: netImpactRow, c: 1 });
    }

    pushRow([]);

    const headerRow = pushRow(['Catégorie', 'Service', 'Prix unitaire (Ar)', 'Quantité', 'Total (Ar)']);

    // Détail groupé par comptoir, chacun suivi de son propre sous-total.
    const sections = this.rapportGroupsByUsername();
    for (const section of sections) {
      const usernameRow = pushRow([section.username]);
      usernameHeaderRows.push(usernameRow);
      for (const group of section.groups) {
        for (const line of group.lines) {
          const r = pushRow([group.category, line.label, line.unitPrice, line.qty, line.total]);
          currencyCells.push({ r, c: 2 }, { r, c: 4 });
        }
      }
      const subtotalRow = pushRow(['', '', '', `Total ${section.username}`, section.total]);
      currencyCells.push({ r: subtotalRow, c: 4 });
      pushRow([]);
    }

    const totalRow = pushRow(['', '', '', 'Total général', this.rapportRevenue()]);
    currencyCells.push({ r: totalRow, c: 4 });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    // Largeurs de colonnes adaptées au contenu pour une meilleure lisibilité.
    worksheet['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 16 }];

    // Fusion des lignes de titre, de date et d'en-tête de comptoir sur toute la largeur du tableau.
    worksheet['!merges'] = [
      { s: { r: titleRow, c: 0 }, e: { r: titleRow, c: 4 } },
      { s: { r: dateRow, c: 0 }, e: { r: dateRow, c: 4 } },
      ...usernameHeaderRows.map((r) => ({ s: { r, c: 0 }, e: { r, c: 4 } })),
    ];

    // Filtre automatique sur l'en-tête du détail par service.
    worksheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: 4 } }),
    };

    // Format monétaire (Ar) pour les colonnes de montants.
    const currencyFormat = '#,##0" Ar"';
    for (const { r, c } of currencyCells) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[cellRef];
      if (cell) cell.z = currencyFormat;
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Rapport');

    const defaultFileName = this.rapportDefaultFileName();

    // Laisse l'utilisateur choisir le dossier de destination et le nom du fichier.
    let destinationPath: string | null;
    try {
      destinationPath = await save({
        defaultPath: defaultFileName,
        filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }],
      });
    } catch (e) {
      console.error('export dialog failed', e);
      this.showToast("Échec de l'export : impossible d'ouvrir la boîte de dialogue.");
      return;
    }
    if (!destinationPath) return; // Annulé par l'utilisateur — pas d'erreur, pas de toast.

    const workbookBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    try {
      await invoke('save_binary_file', {
        path: destinationPath,
        data: Array.from(new Uint8Array(workbookBytes)),
      });
      this.showToast('Rapport exporté avec succès !');
    } catch (e) {
      console.error('save_binary_file failed', e);
      this.showToast("Échec de l'enregistrement du fichier Excel.");
    }
  }

  /** Commandes payées appartenant à la période sélectionnée (jour/semaine/mois/année) — seule base du rapport. */
  private rapportPaidOrders(): Order[] {
    const bounds = this.rapportPeriodBounds();
    return this._rawPaidOrders.filter((o) => o.paid_at && this.isWithinRapportPeriod(o.paid_at, bounds));
  }

  /** Formate une date locale en "AAAA-MM-JJ", utilisable dans un input[type=date]. */
  private formatIsoDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Reconstruit une Date locale (minuit) à partir d'une chaîne "AAAA-MM-JJ". */
  private parseIsoDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }

  private isToday(iso: string): boolean {
    const date = new Date(iso);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return startOfDay(date) === startOfDay(now);
  }

  // ── Derivation from "orders" broadcast ───────────────────────────────────────

  private applyOrders(orders: Order[]): void {
    this._rawPaidOrders = orders.filter((o) => o.status === 'PAYE');
    const pendingOrders = orders.filter((o) => o.status === 'EN_ATTENTE');
    this.pendingGroups.set(this.buildGroups(pendingOrders));
    this.paidGroups.set(this.buildGroups(this._rawPaidOrders));
    this.totalRevenue.set(
      this._rawPaidOrders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0),
    );
    this.volumeByService.set(
      this._rawPaidOrders.reduce((acc, o) => {
        acc[o.service_type] = (acc[o.service_type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    );
    // Drop the counter filter if it no longer matches any group in the refreshed history.
    if (
      this.selectedHistoriqueUser() !== HISTORIQUE_ALL_COUNTERS &&
      !this.historiqueUsernames().includes(this.selectedHistoriqueUser())
    ) {
      this.selectedHistoriqueUser.set(HISTORIQUE_ALL_COUNTERS);
    }
  }

  private buildGroups(orders: Order[]): OrderGroup[] {
    const map = new Map<number, Order[]>();
    for (const o of orders) {
      if (!map.has(o.group_id)) map.set(o.group_id, []);
      map.get(o.group_id)!.push(o);
    }
    const groups: OrderGroup[] = [];
    for (const [groupId, lines] of map.entries()) {
      groups.push({
        groupId,
        lines,
        totalAmount: lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
        time: lines[0].time,
        createdAt: lines[0].created_at,
        paidAt: lines[0].paid_at,
        counterUsername: lines[0].counter_username,
      });
    }
    return groups.sort((a, b) => b.groupId - a.groupId);
  }
}
