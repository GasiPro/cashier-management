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

  // ── Rapport: selected date / time-range filters ──────────────────────────────
  rapportSelectedDate = signal<string>(this.formatIsoDate(new Date()));
  showRapportDatePicker = signal(false);
  rapportTimeFilter = signal<{ start: string; end: string } | null>(null);
  rapportTimeFilterDraft = signal<{ start: string; end: string }>({ start: '', end: '' });
  showRapportTimePicker = signal(false);
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
    const map = new Map<string, Map<string, RapportLine>>();
    for (const order of this.rapportPaidOrders()) {
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

  /** Les services les plus vendus (par chiffre d'affaires), tous comptoirs confondus. */
  rapportTopServices(limit = 5): RapportLine[] {
    const all = this.rapportGroups().flatMap((g) => g.lines);
    return [...all].sort((a, b) => b.total - a.total).slice(0, limit);
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

  /** Compare le chiffre d'affaires du jour sélectionné (journée complète) à celui de la veille. */
  rapportRevenueTrend(): RapportRevenueTrend {
    const previousRevenue = this.revenueForDate(this.previousRapportDate());
    const currentRevenue = this.revenueForDate(this.rapportSelectedDate());
    if (previousRevenue === 0) {
      return { previousRevenue, changePercent: currentRevenue > 0 ? 100 : null };
    }
    return {
      previousRevenue,
      changePercent: Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100),
    };
  }

  /** Positionne le rapport sur la date du jour. */
  setRapportToday(): void {
    this.rapportSelectedDate.set(this.formatIsoDate(new Date()));
    this.rapportTimeFilter.set(null);
    this.showRapportDatePicker.set(false);
  }

  /** Positionne le rapport sur la date d'hier. */
  setRapportYesterday(): void {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    this.rapportSelectedDate.set(this.formatIsoDate(d));
    this.rapportTimeFilter.set(null);
    this.showRapportDatePicker.set(false);
  }

  /** True si la date sélectionnée du rapport est celle d'aujourd'hui. */
  isRapportToday(): boolean {
    return this.rapportSelectedDate() === this.formatIsoDate(new Date());
  }

  /** True si la date sélectionnée du rapport est celle d'hier. */
  isRapportYesterday(): boolean {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return this.rapportSelectedDate() === this.formatIsoDate(d);
  }

  /** Chiffre d'affaires du rapport (date et plage horaire sélectionnées). */
  rapportRevenue(): number {
    return this.rapportPaidOrders().reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }

  /** Nombre de clients (commandes distinctes) encaissés sur la date/plage sélectionnée. */
  rapportClientsCount(): number {
    return new Set(this.rapportPaidOrders().map((o) => o.group_id)).size;
  }

  /** Date du rapport, ex. "mardi 4 août 2026" — jour, mois et année en toutes lettres. */
  rapportDateLabel(): string {
    return this.parseIsoDate(this.rapportSelectedDate()).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /** Plage horaire couverte par le rapport : la sélection manuelle si définie, sinon la plage réelle des commandes. */
  rapportTimeRange(): string {
    const filter = this.rapportTimeFilter();
    if (filter) return `${filter.start} – ${filter.end}`;
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
    this.showRapportTimePicker.set(false);
  }

  /** Applique la date choisie dans le sélecteur du rapport. */
  onRapportDateChange(value: string): void {
    if (!value) return;
    this.rapportSelectedDate.set(value);
    this.showRapportDatePicker.set(false);
  }

  /** Ouvre/ferme le sélecteur de plage horaire du rapport. */
  toggleRapportTimePicker(): void {
    const current = this.rapportTimeFilter();
    this.rapportTimeFilterDraft.set(current ? { ...current } : { start: '', end: '' });
    this.showRapportTimePicker.update((v) => !v);
    this.showRapportDatePicker.set(false);
  }

  /** Met à jour l'heure de début ou de fin en cours de saisie dans le sélecteur de plage horaire. */
  updateRapportTimeDraft(field: 'start' | 'end', value: string): void {
    this.rapportTimeFilterDraft.update((d) => ({ ...d, [field]: value }));
  }

  /** Valide la plage horaire saisie et l'applique au rapport. */
  applyRapportTimeFilter(): void {
    const { start, end } = this.rapportTimeFilterDraft();
    if (start && end) {
      this.rapportTimeFilter.set({ start, end });
    }
    this.showRapportTimePicker.set(false);
  }

  /** Retire le filtre de plage horaire du rapport (affiche à nouveau toute la journée). */
  clearRapportTimeFilter(): void {
    this.rapportTimeFilter.set(null);
    this.rapportTimeFilterDraft.set({ start: '', end: '' });
    this.showRapportTimePicker.set(false);
  }

  /** Exporte le rapport du jour en cours au format Excel (.xlsx), mis en forme pour la lisibilité. */
  async exportRapportXlsx(): Promise<void> {
    const groups = this.rapportGroups();
    const rows: (string | number)[][] = [];
    const currencyCells: { r: number; c: number }[] = [];

    const pushRow = (row: (string | number)[]): number => {
      rows.push(row);
      return rows.length - 1;
    };

    const titleRow = pushRow(['Rapport du jour']);
    const dateRow = pushRow([this.rapportDateLabel()]);
    pushRow([]);

    const revenueRow = pushRow(["Chiffre d'affaires", this.rapportRevenue()]);
    currencyCells.push({ r: revenueRow, c: 1 });

    const trend = this.rapportRevenueTrend();
    const previousRevenueRow = pushRow(['Chiffre d\'affaires (veille)', trend.previousRevenue]);
    currencyCells.push({ r: previousRevenueRow, c: 1 });
    if (trend.changePercent !== null) {
      pushRow(['Évolution vs veille', `${trend.changePercent >= 0 ? '+' : ''}${trend.changePercent}%`]);
    }

    pushRow(['Clients servis', this.rapportClientsCount()]);

    const avgBasketRow = pushRow(['Panier moyen', this.rapportAverageBasket()]);
    currencyCells.push({ r: avgBasketRow, c: 1 });

    pushRow(['Articles vendus', this.rapportItemsCount()]);

    if (this.rapportTimeRange()) {
      pushRow(['Plage horaire', this.rapportTimeRange()]);
    }

    const counters = this.rapportByCounter();
    if (counters.length > 1) {
      pushRow([]);
      pushRow(['Comptoir', 'Clients', 'Total (Ar)']);
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

    for (const group of groups) {
      for (const line of group.lines) {
        const r = pushRow([group.category, line.label, line.unitPrice, line.qty, line.total]);
        currencyCells.push({ r, c: 2 }, { r, c: 4 });
      }
    }

    pushRow([]);
    const totalRow = pushRow(['', '', '', 'Total général', this.rapportRevenue()]);
    currencyCells.push({ r: totalRow, c: 4 });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    // Largeurs de colonnes adaptées au contenu pour une meilleure lisibilité.
    worksheet['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 16 }];

    // Fusion des lignes de titre et de date sur toute la largeur du tableau.
    worksheet['!merges'] = [
      { s: { r: titleRow, c: 0 }, e: { r: titleRow, c: 4 } },
      { s: { r: dateRow, c: 0 }, e: { r: dateRow, c: 4 } },
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

    const isoDate = this.rapportSelectedDate();
    const defaultFileName = `rapport_du_jour_${isoDate}.xlsx`;

    // Laisse l'utilisateur choisir le dossier de destination et le nom du fichier.
    let destinationPath: string | null;
    try {
      destinationPath = await save({
        defaultPath: defaultFileName,
        filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }],
      });
    } catch (e) {
      console.error('export dialog failed', e);
      return;
    }
    if (!destinationPath) return; // Annulé par l'utilisateur.

    const workbookBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    try {
      await invoke('save_binary_file', {
        path: destinationPath,
        data: Array.from(new Uint8Array(workbookBytes)),
      });
    } catch (e) {
      console.error('save_binary_file failed', e);
    }
  }

  /** Commandes payées appartenant à la date sélectionnée et, le cas échéant, à la plage horaire choisie — seule base du rapport. */
  private rapportPaidOrders(): Order[] {
    return this._rawPaidOrders.filter(
      (o) =>
        o.paid_at &&
        this.isSelectedRapportDate(o.paid_at) &&
        this.isWithinRapportTimeFilter(o.paid_at),
    );
  }

  private isSelectedRapportDate(iso: string): boolean {
    return this.formatIsoDate(new Date(iso)) === this.rapportSelectedDate();
  }

  /** Chiffre d'affaires encaissé sur une date ISO donnée (journée complète, sans filtre horaire). */
  private revenueForDate(isoDate: string): number {
    return this._rawPaidOrders
      .filter((o) => o.paid_at && this.formatIsoDate(new Date(o.paid_at)) === isoDate)
      .reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }

  /** Date ISO du jour précédant celui actuellement sélectionné dans le rapport. */
  private previousRapportDate(): string {
    const d = this.parseIsoDate(this.rapportSelectedDate());
    d.setDate(d.getDate() - 1);
    return this.formatIsoDate(d);
  }

  private isWithinRapportTimeFilter(iso: string): boolean {
    const filter = this.rapportTimeFilter();
    if (!filter) return true;
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return time >= filter.start && time <= filter.end;
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