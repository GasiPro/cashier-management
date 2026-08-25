import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { WebsocketService, WsMessage } from '../../../core/service/websocket.service';
import { Navbar } from '../../shared/navbar/navbar';
import { Subscription } from 'rxjs';
import * as XLSX from 'xlsx';
export interface Order {
  id: number;
  group_id: number;
  service_type: string;
  unit_price: number;
  original_unit_price: number;
  quantity: number;
  status: 'EN_ATTENTE' | 'PAYE' | 'REJETEE';
  time: string;
  counter_username: string;
  created_at: string;
  paid_at: string | null;
  observation: string;
  raison: string | null;
}
export interface OrderGroup {
  groupId: number;
  lines: Order[];
  totalAmount: number;
  time: string;
  createdAt: string;
  paidAt?: string | null;
  counterUsername: string;
}
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
  originalUnitPrice: number;
  discounted: boolean;
  increased: boolean;
}
interface RapportCategoryGroup {
  category: string;
  lines: RapportLine[];
}
type RapportPeriod = 'jour' | 'semaine' | 'mois' | 'annee';
interface RapportPeriodBounds {
  start: string;
  end: string;
}
interface RapportUserSection {
  username: string;
  groups: RapportCategoryGroup[];
  total: number;
}
interface RapportCounterBreakdown {
  username: string;
  total: number;
  clients: number;
}
interface RapportRevenueTrend {
  previousRevenue: number;
  changePercent: number | null;
}
interface RapportAdjustmentsSummary {
  discountCount: number;
  increaseCount: number;
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
const LS_DISPLAY_NAME = 'gasipro:displayName';
const HISTORIQUE_ALL_COUNTERS = 'Tous';
@Component({
  selector: 'app-cashier',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './cashier.html',
})
export class Cashier implements OnInit, OnDestroy {
  username = localStorage.getItem(LS_USERNAME) ?? 'Caisse';
  private displayName = localStorage.getItem(LS_DISPLAY_NAME) ?? '';
  /** Name shown in the navbar — the account display name when one exists, otherwise the username. */
  get displayLabel(): string {
    return this.displayName.trim() ? this.displayName : this.username;
  }
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
  pendingRequests = signal<ConnectionRequest[]>([]);
  connectedDevices = signal<ConnectedDevice[]>([]);
  showDevicesPanel = false;
  maxConnectedDevices = signal<number>(0);
  atDeviceCapacity = computed(
    () => this.maxConnectedDevices() > 0 && this.connectedDevices().length >= this.maxConnectedDevices(),
  );
  showRapport = false;
  showHistorique = false;
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
    invoke<string>('get_ws_address')
      .then((addr) => this.wsAddress.set(addr))
      .catch(() => this.wsAddress.set('127.0.0.1:8080'));
    invoke<number>('get_max_connected_devices')
      .then((max) => this.maxConnectedDevices.set(max))
      .catch(() => {});
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
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      this.ws.send({ type: 'cashier_register', username: this.username });
    });
    this.ws.connect(CASHIER_LOCAL_WS_URL);
    if (this.ws.isOpen()) {
      this.ws.send({ type: 'cashier_register', username: this.username });
    }
  }
  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
  }
  get totalPendingRequests(): number {
    return this.pendingRequests().length;
  }
  async approveDevice(addr: string): Promise<void> {
    try {
      await invoke('approve_connection', { addr });
    } catch (e) {
      console.error('approve_connection failed', e);
      this.showToast(typeof e === 'string' ? e : "Impossible d'approuver cet appareil.");
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
  async markGroupAsPaid(groupId: number): Promise<void> {
    await invoke('mark_group_as_paid', { groupId });
  }
  async rejectGroup(groupId: number, raison?: string): Promise<void> {
    try {
      await invoke('reject_group', { groupId, raison: raison?.trim() ? raison.trim() : null });
    } catch (e) {
      console.error('reject_group failed', e);
    }
  }
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
  goToSettings(): void {
    this.showDevicesPanel = false;
    this.router.navigate(['/reglages']);
  }
  openGroupDetail(g: OrderGroup): void {
    this.selectedGroup.set(g);
  }
  closeGroupDetail(): void {
    this.selectedGroup.set(null);
  }
  isGroupPending(g: OrderGroup): boolean {
    return !g.paidAt;
  }
  formatGroupId(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }
  isLineDiscounted(order: Order): boolean {
    return order.original_unit_price > 0 && order.unit_price < order.original_unit_price;
  }
  isLineIncreased(order: Order): boolean {
    return order.original_unit_price > 0 && order.unit_price > order.original_unit_price;
  }
  groupHasDiscount(group: OrderGroup): boolean {
    return group.lines.some((l) => this.isLineDiscounted(l));
  }
  groupHasIncrease(group: OrderGroup): boolean {
    return group.lines.some((l) => this.isLineIncreased(l));
  }
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
  setHistoriqueUserFilter(username: string): void {
    this.selectedHistoriqueUser.set(username);
  }
  private formatRelativeDay(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
    if (diffDays === 0) return "aujourd'hui";
    if (diffDays === 1) return 'hier';
    return date.toLocaleDateString('fr-FR');
  }
  formatPaidLabel(group: OrderGroup): string {
    if (!group.paidAt) return '';
    const date = new Date(group.paidAt);
    const dayLabel = this.formatRelativeDay(group.paidAt);
    const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `Encaissé ${dayLabel} à ${time}`;
  }
  formatPaidTime(group: OrderGroup): string {
    if (!group.paidAt) return '';
    return new Date(group.paidAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  historiqueItemCount(group: OrderGroup): number {
    return group.lines.reduce((sum, l) => sum + l.quantity, 0);
  }
  formatCreatedLabel(group: OrderGroup): string {
    const dayLabel = this.formatRelativeDay(group.createdAt);
    return `${dayLabel} à ${group.time}`;
  }
  rapportGroups(): RapportCategoryGroup[] {
    return this.buildRapportGroups(this.rapportPaidOrders());
  }
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
  rapportAverageBasket(): number {
    const clients = this.rapportClientsCount();
    return clients === 0 ? 0 : this.rapportRevenue() / clients;
  }
  rapportItemsCount(): number {
    return this.rapportPaidOrders().reduce((sum, o) => sum + o.quantity, 0);
  }
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
  rapportLineShare(line: RapportLine): number {
    const revenue = this.rapportRevenue();
    return revenue === 0 ? 0 : Math.round((line.total / revenue) * 100);
  }
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
  setRapportPeriod(period: RapportPeriod): void {
    if (this.rapportPeriod() === period) return;
    this.rapportPeriod.set(period);
    this.showRapportDatePicker.set(false);
  }
  setRapportCurrentPeriod(): void {
    this.rapportSelectedDate.set(this.formatIsoDate(new Date()));
    this.showRapportDatePicker.set(false);
  }
  setRapportPreviousPeriod(): void {
    const todayIso = this.formatIsoDate(new Date());
    const previous = this.previousPeriodBounds(todayIso, this.rapportPeriod());
    this.rapportSelectedDate.set(previous.start);
    this.showRapportDatePicker.set(false);
  }
  isRapportCurrentPeriod(): boolean {
    const todayIso = this.formatIsoDate(new Date());
    const bounds = this.rapportPeriodBounds();
    return todayIso >= bounds.start && todayIso <= bounds.end;
  }
  isRapportPreviousPeriod(): boolean {
    const todayIso = this.formatIsoDate(new Date());
    const previous = this.previousPeriodBounds(todayIso, this.rapportPeriod());
    const anchor = this.rapportSelectedDate();
    return anchor >= previous.start && anchor <= previous.end;
  }
  isRapportCustomPeriod(): boolean {
    return !this.isRapportCurrentPeriod() && !this.isRapportPreviousPeriod();
  }
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
  rapportWeekInputValue(): string {
    const { start } = this.rapportPeriodBounds();
    return this.toIsoWeekValue(this.parseIsoDate(start));
  }
  onRapportWeekChange(value: string): void {
    const match = /^(\d{4})-W(\d{2})$/.exec(value);
    if (!match) return;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const monday = this.mondayOfIsoWeek(year, week);
    this.rapportSelectedDate.set(this.formatIsoDate(monday));
    this.showRapportDatePicker.set(false);
  }
  rapportMonthInputValue(): string {
    const anchor = this.parseIsoDate(this.rapportSelectedDate());
    return `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
  }
  onRapportMonthChange(value: string): void {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return;
    this.rapportSelectedDate.set(`${year}-${String(month).padStart(2, '0')}-01`);
    this.showRapportDatePicker.set(false);
  }
  rapportYearInputValue(): number {
    return this.parseIsoDate(this.rapportSelectedDate()).getFullYear();
  }
  onRapportYearChange(value: string): void {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
    this.rapportSelectedDate.set(`${year}-01-01`);
    this.showRapportDatePicker.set(false);
  }
  private rapportPeriodBounds(): RapportPeriodBounds {
    return this.periodBounds(this.rapportSelectedDate(), this.rapportPeriod());
  }
  private periodBounds(anchorIso: string, period: RapportPeriod): RapportPeriodBounds {
    const anchor = this.parseIsoDate(anchorIso);
    switch (period) {
      case 'semaine': {
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
  private startOfIsoWeek(d: Date): Date {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date;
  }
  private toIsoWeekValue(d: Date): string {
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayNumber = (target.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNumber + 3);
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const firstThursdayDay = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstThursdayDay + 3);
    const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
    return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  private mondayOfIsoWeek(year: number, week: number): Date {
    const jan4 = new Date(year, 0, 4);
    const jan4Day = (jan4.getDay() + 6) % 7;
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - jan4Day);
    const target = new Date(week1Monday);
    target.setDate(week1Monday.getDate() + (week - 1) * 7);
    return target;
  }
  private revenueForPeriod(bounds: RapportPeriodBounds): number {
    return this._rawPaidOrders
      .filter((o) => o.paid_at && this.isWithinRapportPeriod(o.paid_at, bounds))
      .reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }
  private isWithinRapportPeriod(iso: string, bounds: RapportPeriodBounds): boolean {
    const day = this.formatIsoDate(new Date(iso));
    return day >= bounds.start && day <= bounds.end;
  }
  rapportRevenue(): number {
    return this.rapportPaidOrders().reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }
  rapportClientsCount(): number {
    return new Set(this.rapportPaidOrders().map((o) => o.group_id)).size;
  }
  private rapportOrdersDateBounds(bounds: RapportPeriodBounds): RapportPeriodBounds {
    const days = this._rawPaidOrders
      .filter((o) => o.paid_at && this.isWithinRapportPeriod(o.paid_at, bounds))
      .map((o) => this.formatIsoDate(new Date(o.paid_at as string)))
      .sort();
    if (days.length === 0) return bounds;
    return { start: days[0], end: days[days.length - 1] };
  }
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
  toggleRapportDatePicker(): void {
    this.showRapportDatePicker.update((v) => !v);
  }
  onRapportDateChange(value: string): void {
    if (!value) return;
    this.rapportSelectedDate.set(value);
    this.showRapportDatePicker.set(false);
  }
  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    this.toastVisible.set(true);
    setTimeout(() => this.toastVisible.set(false), 3000);
  }
  async exportRapportXlsx(): Promise<void> {
    this.exportingRapport.set(true);
    try {
      await this.buildAndSaveRapportXlsx();
    } finally {
      this.exportingRapport.set(false);
    }
  }
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
    const headerRow = pushRow([
      'Catégorie',
      'Service',
      'N° Commande',
      'Comptoir',
      'Prix unitaire (Ar)',
      'Prix appliqué (Ar)',
      'Quantité',
      'Heure commande',
      'Heure paiement',
      'Total (Ar)',
    ]);
    const formatRapportTime = (iso: string): string =>
      new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const ordersByUsername = new Map<string, Order[]>();
    for (const order of this.rapportPaidOrders()) {
      const key = order.counter_username || 'Non renseigné';
      if (!ordersByUsername.has(key)) ordersByUsername.set(key, []);
      ordersByUsername.get(key)!.push(order);
    }
    const sections = Array.from(ordersByUsername.entries())
      .map(([username, orders]) => ({
        username,
        orders,
        total: orders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0),
      }))
      .sort((a, b) => b.total - a.total);
    for (const section of sections) {
      const usernameRow = pushRow([section.username]);
      usernameHeaderRows.push(usernameRow);
      const sortedOrders = [...section.orders].sort((a, b) => {
        const [categoryA] = a.service_type.split(' — ');
        const [categoryB] = b.service_type.split(' — ');
        return categoryA === categoryB ? a.time.localeCompare(b.time) : categoryA.localeCompare(categoryB);
      });
      for (const order of sortedOrders) {
        const [category, label] = order.service_type.split(' — ');
        const r = pushRow([
          category,
          label ?? order.service_type,
          order.group_id,
          section.username,
          order.original_unit_price,
          order.unit_price,
          order.quantity,
          order.time,
          order.paid_at ? formatRapportTime(order.paid_at) : '',
          order.quantity * order.unit_price,
        ]);
        currencyCells.push({ r, c: 4 }, { r, c: 5 }, { r, c: 9 });
      }
      const subtotalRow = pushRow(['', '', '', '', '', '', '', '', `Total ${section.username}`, section.total]);
      currencyCells.push({ r: subtotalRow, c: 9 });
      pushRow([]);
    }
    const totalRow = pushRow(['', '', '', '', '', '', '', '', 'Total général', this.rapportRevenue()]);
    currencyCells.push({ r: totalRow, c: 9 });
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 24 },
      { wch: 13 },
      { wch: 16 },
      { wch: 17 },
      { wch: 17 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
    ];
    worksheet['!merges'] = [
      { s: { r: titleRow, c: 0 }, e: { r: titleRow, c: 9 } },
      { s: { r: dateRow, c: 0 }, e: { r: dateRow, c: 9 } },
      ...usernameHeaderRows.map((r) => ({ s: { r, c: 0 }, e: { r, c: 9 } })),
    ];
    worksheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: 9 } }),
    };
    const currencyFormat = '#,##0" Ar"';
    for (const { r, c } of currencyCells) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[cellRef];
      if (cell) cell.z = currencyFormat;
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Rapport');
    const defaultFileName = this.rapportDefaultFileName();
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
    if (!destinationPath) return;
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
  private rapportPaidOrders(): Order[] {
    const bounds = this.rapportPeriodBounds();
    return this._rawPaidOrders.filter((o) => o.paid_at && this.isWithinRapportPeriod(o.paid_at, bounds));
  }
  private formatIsoDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
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
