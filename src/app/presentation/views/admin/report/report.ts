import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { WebsocketService, WsMessage } from '../../../../core/service/websocket.service';
import { Subscription } from 'rxjs';
import * as XLSX from 'xlsx';
export interface OrderLine {
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
type Period = 'jour' | 'semaine' | 'mois' | 'annee';
interface PeriodBounds {
  start: string;
  end: string;
}
interface CategoryLine {
  label: string;
  qty: number;
  total: number;
  discounted: boolean;
  increased: boolean;
}
interface CategoryGroup {
  category: string;
  lines: CategoryLine[];
  total: number;
}
interface CounterSection {
  username: string;
  groups: CategoryGroup[];
  total: number;
  clients: number;
}
interface CounterBreakdown {
  username: string;
  total: number;
  clients: number;
}
interface RevenueTrend {
  previousRevenue: number;
  changePercent: number | null;
}
interface AdjustmentsSummary {
  discountCount: number;
  increaseCount: number;
  netImpact: number;
}
const REPORT_ALL_COUNTERS = 'all';
const REPORT_LOCAL_WS_URL = 'ws://127.0.0.1:8080';
@Component({
  selector: 'app-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report.html',
  styleUrl: './report.css',
})
export class Report implements OnInit, OnDestroy {
  readonly allCounters = REPORT_ALL_COUNTERS;
  wsConnected = signal(false);
  private rawOrders = signal<OrderLine[]>([]);
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  constructor(private ws: WebsocketService) {}
  ngOnInit(): void {
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      this.wsConnected.set(true);
      if (msg.type === 'orders') {
        this.rawOrders.set(msg.data as OrderLine[]);
      }
    });
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      this.ws.send({ type: 'admin_register' });
    });
    this.ws.connect(REPORT_LOCAL_WS_URL);
    if (this.ws.isOpen()) {
      this.ws.send({ type: 'admin_register' });
    }
  }
  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
  }
  private readonly paidOrders = computed(() => this.rawOrders().filter((o) => o.status === 'PAYE'));
  readonly counters = computed<string[]>(() => {
    const set = new Set(this.paidOrders().map((o) => o.counter_username || 'Non renseigné'));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  });
  counterFilter = signal<string>(REPORT_ALL_COUNTERS);
  setCounterFilter(username: string): void {
    this.counterFilter.set(username);
  }
  exportingReport = signal(false);
  period = signal<Period>('jour');
  selectedDate = signal<string>(this.formatIsoDate(new Date()));
  showDatePicker = signal(false);
  setPeriod(period: Period): void {
    if (this.period() === period) return;
    this.period.set(period);
    this.showDatePicker.set(false);
  }
  toggleDatePicker(): void {
    this.showDatePicker.update((v) => !v);
  }
  setCurrentPeriod(): void {
    this.selectedDate.set(this.formatIsoDate(new Date()));
    this.showDatePicker.set(false);
  }
  setPreviousPeriod(): void {
    const todayIso = this.formatIsoDate(new Date());
    const previous = this.previousPeriodBounds(todayIso, this.period());
    this.selectedDate.set(previous.start);
    this.showDatePicker.set(false);
  }
  isCurrentPeriod(): boolean {
    const todayIso = this.formatIsoDate(new Date());
    const bounds = this.periodBounds();
    return todayIso >= bounds.start && todayIso <= bounds.end;
  }
  isPreviousPeriod(): boolean {
    const todayIso = this.formatIsoDate(new Date());
    const previous = this.previousPeriodBounds(todayIso, this.period());
    const anchor = this.selectedDate();
    return anchor >= previous.start && anchor <= previous.end;
  }
  isCustomPeriod(): boolean {
    return !this.isCurrentPeriod() && !this.isPreviousPeriod();
  }
  currentPeriodLabel(): string {
    switch (this.period()) {
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
  previousPeriodLabel(): string {
    switch (this.period()) {
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
  comparisonLabel(): string {
    switch (this.period()) {
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
  onDateChange(value: string): void {
    if (!value) return;
    this.selectedDate.set(value);
    this.showDatePicker.set(false);
  }
  weekInputValue(): string {
    const { start } = this.periodBounds();
    return this.toIsoWeekValue(this.parseIsoDate(start));
  }
  onWeekChange(value: string): void {
    const match = /^(\d{4})-W(\d{2})$/.exec(value);
    if (!match) return;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const monday = this.mondayOfIsoWeek(year, week);
    this.selectedDate.set(this.formatIsoDate(monday));
    this.showDatePicker.set(false);
  }
  monthInputValue(): string {
    const anchor = this.parseIsoDate(this.selectedDate());
    return `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
  }
  onMonthChange(value: string): void {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return;
    this.selectedDate.set(`${year}-${String(month).padStart(2, '0')}-01`);
    this.showDatePicker.set(false);
  }
  yearInputValue(): number {
    return this.parseIsoDate(this.selectedDate()).getFullYear();
  }
  onYearChange(value: string): void {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
    this.selectedDate.set(`${year}-01-01`);
    this.showDatePicker.set(false);
  }
  private periodBounds(): PeriodBounds {
    return this.boundsFor(this.selectedDate(), this.period());
  }
  private boundsFor(anchorIso: string, period: Period): PeriodBounds {
    const anchor = this.parseIsoDate(anchorIso);
    switch (period) {
      case 'semaine': {
        const start = this.startOfIsoWeek(anchor);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
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
  private previousPeriodBounds(anchorIso: string, period: Period): PeriodBounds {
    const anchor = this.parseIsoDate(anchorIso);
    switch (period) {
      case 'semaine': {
        const prevAnchor = new Date(anchor);
        prevAnchor.setDate(prevAnchor.getDate() - 7);
        return this.boundsFor(this.formatIsoDate(prevAnchor), period);
      }
      case 'mois': {
        const prevAnchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
        return this.boundsFor(this.formatIsoDate(prevAnchor), period);
      }
      case 'annee': {
        const prevAnchor = new Date(anchor.getFullYear() - 1, 0, 1);
        return this.boundsFor(this.formatIsoDate(prevAnchor), period);
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
  private formatIsoDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  private parseIsoDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }
  private isWithinPeriod(iso: string, bounds: PeriodBounds): boolean {
    const day = this.formatIsoDate(new Date(iso));
    return day >= bounds.start && day <= bounds.end;
  }
  /** Paid orders within the selected period and, if set, the selected counter. */
  private readonly periodOrders = computed<OrderLine[]>(() => {
    const bounds = this.periodBounds();
    const counter = this.counterFilter();
    return this.paidOrders().filter((o) => {
      if (!o.paid_at || !this.isWithinPeriod(o.paid_at, bounds)) return false;
      if (counter !== REPORT_ALL_COUNTERS && (o.counter_username || 'Non renseigné') !== counter) return false;
      return true;
    });
  });
  private revenueForPeriod(bounds: PeriodBounds): number {
    const counter = this.counterFilter();
    return this.paidOrders()
      .filter((o) => {
        if (!o.paid_at || !this.isWithinPeriod(o.paid_at, bounds)) return false;
        if (counter !== REPORT_ALL_COUNTERS && (o.counter_username || 'Non renseigné') !== counter) return false;
        return true;
      })
      .reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }
  readonly revenue = computed(() => this.periodOrders().reduce((sum, o) => sum + o.quantity * o.unit_price, 0));
  readonly clientsCount = computed(() => new Set(this.periodOrders().map((o) => o.group_id)).size);
  readonly averageBasket = computed(() => {
    const clients = this.clientsCount();
    return clients === 0 ? 0 : this.revenue() / clients;
  });
  readonly itemsCount = computed(() => this.periodOrders().reduce((sum, o) => sum + o.quantity, 0));
  /** Pending/rejected order counts within the period, for a fuller activity picture. */
  private readonly rawOrdersInPeriod = computed<OrderLine[]>(() => {
    const bounds = this.periodBounds();
    const counter = this.counterFilter();
    return this.rawOrders().filter((o) => {
      const reference = o.status === 'PAYE' ? o.paid_at : o.created_at;
      if (!reference || !this.isWithinPeriod(reference, bounds)) return false;
      if (counter !== REPORT_ALL_COUNTERS && (o.counter_username || 'Non renseigné') !== counter) return false;
      return true;
    });
  });
  readonly pendingCount = computed(
    () => new Set(this.rawOrdersInPeriod().filter((o) => o.status === 'EN_ATTENTE').map((o) => o.group_id)).size,
  );
  readonly rejectedCount = computed(
    () => new Set(this.rawOrdersInPeriod().filter((o) => o.status === 'REJETEE').map((o) => o.group_id)).size,
  );
  readonly revenueTrend = computed<RevenueTrend>(() => {
    const previous = this.previousPeriodBounds(this.selectedDate(), this.period());
    const previousRevenue = this.revenueForPeriod(previous);
    const currentRevenue = this.revenue();
    if (previousRevenue === 0) {
      return { previousRevenue, changePercent: currentRevenue > 0 ? 100 : null };
    }
    return {
      previousRevenue,
      changePercent: Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100),
    };
  });
  private rapportOrdersDateBounds(bounds: PeriodBounds): PeriodBounds {
    const days = this.periodOrders()
      .map((o) => this.formatIsoDate(new Date(o.paid_at as string)))
      .sort();
    if (days.length === 0) return bounds;
    return { start: days[0], end: days[days.length - 1] };
  }
  private rangeLabel(bounds: PeriodBounds): string {
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
  dateLabel(): string {
    const anchor = this.parseIsoDate(this.selectedDate());
    switch (this.period()) {
      case 'semaine':
        return `Semaine du ${this.rangeLabel(this.rapportOrdersDateBounds(this.periodBounds()))}`;
      case 'mois':
      case 'annee':
        return this.rangeLabel(this.rapportOrdersDateBounds(this.periodBounds()));
      default:
        return anchor.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
    }
  }
  title(): string {
    switch (this.period()) {
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
  timeRange(): string {
    const orders = this.periodOrders();
    if (orders.length === 0) return '';
    const timestamps = orders
      .map((o) => new Date(o.paid_at as string).getTime())
      .sort((a, b) => a - b);
    const format = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `${format(timestamps[0])} – ${format(timestamps[timestamps.length - 1])}`;
  }
  private isLineDiscounted(order: OrderLine): boolean {
    return order.original_unit_price > 0 && order.unit_price < order.original_unit_price;
  }
  private isLineIncreased(order: OrderLine): boolean {
    return order.original_unit_price > 0 && order.unit_price > order.original_unit_price;
  }
  readonly adjustmentsSummary = computed<AdjustmentsSummary>(() => {
    let discountCount = 0;
    let increaseCount = 0;
    let netImpact = 0;
    for (const order of this.periodOrders()) {
      if (this.isLineDiscounted(order)) discountCount += 1;
      if (this.isLineIncreased(order)) increaseCount += 1;
      if (order.original_unit_price > 0) {
        netImpact += (order.unit_price - order.original_unit_price) * order.quantity;
      }
    }
    return { discountCount, increaseCount, netImpact };
  });
  readonly byCounter = computed<CounterBreakdown[]>(() => {
    const map = new Map<string, { total: number; groupIds: Set<number> }>();
    for (const order of this.periodOrders()) {
      const key = order.counter_username || 'Non renseigné';
      if (!map.has(key)) map.set(key, { total: 0, groupIds: new Set() });
      const entry = map.get(key)!;
      entry.total += order.quantity * order.unit_price;
      entry.groupIds.add(order.group_id);
    }
    return Array.from(map.entries())
      .map(([username, v]) => ({ username, total: v.total, clients: v.groupIds.size }))
      .sort((a, b) => b.total - a.total);
  });
  private buildCategoryGroups(orders: OrderLine[]): CategoryGroup[] {
    const map = new Map<string, Map<string, CategoryLine>>();
    for (const order of orders) {
      const parts = order.service_type.split(' — ');
      const category = parts.length > 1 ? parts[0] : 'Autre';
      const label = parts.length > 1 ? parts[1] : order.service_type;
      if (!map.has(category)) map.set(category, new Map());
      const cat = map.get(category)!;
      if (!cat.has(label)) {
        cat.set(label, { label, qty: 0, total: 0, discounted: false, increased: false });
      }
      const entry = cat.get(label)!;
      entry.qty += order.quantity;
      entry.total += order.quantity * order.unit_price;
      entry.discounted = entry.discounted || this.isLineDiscounted(order);
      entry.increased = entry.increased || this.isLineIncreased(order);
    }
    return Array.from(map.entries())
      .map(([category, lines]) => {
        const sortedLines = Array.from(lines.values()).sort((a, b) => b.total - a.total);
        return { category, lines: sortedLines, total: sortedLines.reduce((sum, l) => sum + l.total, 0) };
      })
      .sort((a, b) => b.total - a.total);
  }
  readonly categoryGroups = computed<CategoryGroup[]>(() => this.buildCategoryGroups(this.periodOrders()));
  readonly topServices = computed<CategoryLine[]>(() =>
    this.categoryGroups()
      .map(
        (g): CategoryLine => ({
          label: g.category,
          qty: g.lines.reduce((sum, l) => sum + l.qty, 0),
          total: g.total,
          discounted: g.lines.some((l) => l.discounted),
          increased: g.lines.some((l) => l.increased),
        }),
      )
      .slice(0, 5),
  );
  lineShare(total: number): number {
    const revenue = this.revenue();
    return revenue === 0 ? 0 : Math.round((total / revenue) * 100);
  }
  readonly sectionsByCounter = computed<CounterSection[]>(() => {
    const byUser = new Map<string, OrderLine[]>();
    for (const order of this.periodOrders()) {
      const key = order.counter_username || 'Non renseigné';
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(order);
    }
    return Array.from(byUser.entries())
      .map(([username, orders]) => ({
        username,
        groups: this.buildCategoryGroups(orders),
        total: orders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0),
        clients: new Set(orders.map((o) => o.group_id)).size,
      }))
      .sort((a, b) => b.total - a.total);
  });
  expandedCounter = signal<string | null>(null);
  toggleCounterDetail(username: string): void {
    this.expandedCounter.set(this.expandedCounter() === username ? null : username);
  }
  isCounterExpanded(username: string): boolean {
    return this.expandedCounter() === username;
  }
  private defaultFileName(): string {
    switch (this.period()) {
      case 'semaine': {
        const { start, end } = this.periodBounds();
        return `rapport_semaine_${start}_au_${end}.xlsx`;
      }
      case 'mois':
        return `rapport_mois_${this.monthInputValue()}.xlsx`;
      case 'annee':
        return `rapport_annee_${this.yearInputValue()}.xlsx`;
      default:
        return `rapport_du_jour_${this.selectedDate()}.xlsx`;
    }
  }
  async exportXlsx(): Promise<void> {
    this.exportingReport.set(true);
    try {
      await this.buildAndSaveXlsx();
    } finally {
      this.exportingReport.set(false);
    }
  }
  private async buildAndSaveXlsx(): Promise<void> {
    const rows: (string | number)[][] = [];
    const currencyCells: { r: number; c: number }[] = [];
    const usernameHeaderRows: number[] = [];
    const pushRow = (row: (string | number)[]): number => {
      rows.push(row);
      return rows.length - 1;
    };
    pushRow([this.title()]);
    pushRow([this.dateLabel()]);
    if (this.counterFilter() !== REPORT_ALL_COUNTERS) {
      pushRow([`Comptoir : ${this.counterFilter()}`]);
    }
    pushRow([]);
    const revenueRow = pushRow(["Chiffre d'affaires", this.revenue()]);
    currencyCells.push({ r: revenueRow, c: 1 });
    const trend = this.revenueTrend();
    const comparisonLabel = this.comparisonLabel();
    const previousRevenueRow = pushRow([`Chiffre d'affaires (${comparisonLabel.toLowerCase()})`, trend.previousRevenue]);
    currencyCells.push({ r: previousRevenueRow, c: 1 });
    if (trend.changePercent !== null) {
      pushRow([`Évolution vs ${comparisonLabel.toLowerCase()}`, `${trend.changePercent >= 0 ? '+' : ''}${trend.changePercent}%`]);
    }
    pushRow(['Transactions', this.clientsCount()]);
    const avgBasketRow = pushRow(['Panier moyen', this.averageBasket()]);
    currencyCells.push({ r: avgBasketRow, c: 1 });
    pushRow(['Articles vendus', this.itemsCount()]);
    pushRow(['Commandes en attente', this.pendingCount()]);
    pushRow(['Commandes refusées', this.rejectedCount()]);
    if (this.period() === 'jour' && this.timeRange()) {
      pushRow(['Plage horaire', this.timeRange()]);
    }
    const counters = this.byCounter();
    if (counters.length > 1) {
      pushRow([]);
      pushRow(['Comptoir', 'Transactions', 'Total (Ar)']);
      for (const counter of counters) {
        const r = pushRow([counter.username, counter.clients, counter.total]);
        currencyCells.push({ r, c: 2 });
      }
    }
    const adjustments = this.adjustmentsSummary();
    if (adjustments.discountCount > 0 || adjustments.increaseCount > 0) {
      pushRow([]);
      pushRow(['Remises appliquées', adjustments.discountCount]);
      pushRow(['Majorations appliquées', adjustments.increaseCount]);
      const netImpactRow = pushRow(["Impact net des ajustements (Ar)", adjustments.netImpact]);
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
    const formatReportTime = (iso: string): string =>
      new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const sections = this.sectionsByCounter();
    for (const section of sections) {
      const usernameRow = pushRow([section.username]);
      usernameHeaderRows.push(usernameRow);
      const orders = this.periodOrders()
        .filter((o) => (o.counter_username || 'Non renseigné') === section.username)
        .sort((a, b) => {
          const [categoryA] = a.service_type.split(' — ');
          const [categoryB] = b.service_type.split(' — ');
          return categoryA === categoryB ? a.time.localeCompare(b.time) : categoryA.localeCompare(categoryB);
        });
      for (const order of orders) {
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
          order.paid_at ? formatReportTime(order.paid_at) : '',
          order.quantity * order.unit_price,
        ]);
        currencyCells.push({ r, c: 4 }, { r, c: 5 }, { r, c: 9 });
      }
      const subtotalRow = pushRow(['', '', '', '', '', '', '', '', `Total ${section.username}`, section.total]);
      currencyCells.push({ r: subtotalRow, c: 9 });
      pushRow([]);
    }
    const totalRow = pushRow(['', '', '', '', '', '', '', '', 'Total général', this.revenue()]);
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
      { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
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
    const defaultFileName = this.defaultFileName();
    let destinationPath: string | null;
    try {
      destinationPath = await save({
        defaultPath: defaultFileName,
        filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }],
      });
    } catch (e) {
      console.error('export dialog failed', e);
      this.exportError.set("Échec de l'export : impossible d'ouvrir la boîte de dialogue.");
      return;
    }
    if (!destinationPath) return;
    const workbookBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    try {
      await invoke('save_binary_file', {
        path: destinationPath,
        data: Array.from(new Uint8Array(workbookBytes)),
      });
      this.exportError.set('');
    } catch (e) {
      console.error('save_binary_file failed', e);
      this.exportError.set("Échec de l'enregistrement du fichier Excel.");
    }
  }
  exportError = signal('');
}
