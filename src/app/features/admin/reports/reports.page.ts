import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrderStore } from '../../../data/order/order.store';
import { OrderLine } from '../../../data/order/order.model';
import {
  Period,
  PeriodBounds,
  boundsFor,
  mondayOfIsoWeek,
  previousPeriodBounds,
  rangeLabel,
  toIsoWeekValue,
} from '../../../data/report/report-period';
import {
  ALL_COUNTERS,
  AdjustmentsSummary,
  CategoryGroup,
  CategoryLine,
  CounterBreakdown,
  CounterSection,
  RevenueTrend,
  breakdownByCounter,
  buildCategoryGroups,
  buildSectionsByCounter,
  computeRevenueTrend,
  computeTopServices,
  countGroups,
  countGroupsByStatus,
  filterOrdersInPeriod,
  filterPaidInPeriod,
  lineShare,
  listCounters,
  ordersDateBounds,
  paidTimeRange,
  sumQuantity,
  sumRevenue,
  summarizeAdjustments,
} from '../../../data/report/report.calculator';
import { exportReportXlsx } from '../../../data/report/report-export';
import { formatIsoDate, parseIsoDate } from '../../../shared/utils/date';
import { ReportStore } from './report.store';
@Component({
  selector: 'app-admin-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [ReportStore],
  templateUrl: './reports.page.html',
  styleUrl: './reports.page.css',
})
export class ReportsPage {
  readonly allCounters = ALL_COUNTERS;
  private readonly orderStore = inject(OrderStore);
  private readonly reportStore = inject(ReportStore);
  readonly wsConnected = this.orderStore.wsConnected;
  private readonly rawOrders = this.orderStore.lines;
  private readonly paidOrders = computed(() => this.rawOrders().filter((o) => o.status === 'PAYE'));
  readonly counters = computed<string[]>(() => listCounters(this.paidOrders()));
  readonly counterFilter = this.reportStore.counterFilter;
  setCounterFilter(username: string): void {
    this.counterFilter.set(username);
  }
  exportingReport = signal(false);
  readonly period = this.reportStore.period;
  readonly selectedDate = this.reportStore.selectedDate;
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
    this.selectedDate.set(formatIsoDate(new Date()));
    this.showDatePicker.set(false);
  }
  setPreviousPeriod(): void {
    const todayIso = formatIsoDate(new Date());
    const previous = previousPeriodBounds(todayIso, this.period());
    this.selectedDate.set(previous.start);
    this.showDatePicker.set(false);
  }
  isCurrentPeriod(): boolean {
    const todayIso = formatIsoDate(new Date());
    const bounds = this.periodBounds();
    return todayIso >= bounds.start && todayIso <= bounds.end;
  }
  isPreviousPeriod(): boolean {
    const todayIso = formatIsoDate(new Date());
    const previous = previousPeriodBounds(todayIso, this.period());
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
    return toIsoWeekValue(parseIsoDate(start));
  }
  onWeekChange(value: string): void {
    const match = /^(\d{4})-W(\d{2})$/.exec(value);
    if (!match) return;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const monday = mondayOfIsoWeek(year, week);
    this.selectedDate.set(formatIsoDate(monday));
    this.showDatePicker.set(false);
  }
  monthInputValue(): string {
    const anchor = parseIsoDate(this.selectedDate());
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
    return parseIsoDate(this.selectedDate()).getFullYear();
  }
  onYearChange(value: string): void {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
    this.selectedDate.set(`${year}-01-01`);
    this.showDatePicker.set(false);
  }
  private periodBounds(): PeriodBounds {
    return boundsFor(this.selectedDate(), this.period());
  }
  private readonly periodOrders = computed<OrderLine[]>(() =>
    filterPaidInPeriod(this.paidOrders(), this.periodBounds(), this.counterFilter()),
  );
  readonly revenue = computed(() => sumRevenue(this.periodOrders()));
  readonly clientsCount = computed(() => countGroups(this.periodOrders()));
  readonly averageBasket = computed(() => {
    const clients = this.clientsCount();
    return clients === 0 ? 0 : this.revenue() / clients;
  });
  readonly itemsCount = computed(() => sumQuantity(this.periodOrders()));
  private readonly rawOrdersInPeriod = computed<OrderLine[]>(() =>
    filterOrdersInPeriod(this.rawOrders(), this.periodBounds(), this.counterFilter()),
  );
  readonly pendingCount = computed(() => countGroupsByStatus(this.rawOrdersInPeriod(), 'EN_ATTENTE'));
  readonly rejectedCount = computed(() => countGroupsByStatus(this.rawOrdersInPeriod(), 'REJETEE'));
  readonly revenueTrend = computed<RevenueTrend>(() =>
    computeRevenueTrend(
      this.paidOrders(),
      previousPeriodBounds(this.selectedDate(), this.period()),
      this.counterFilter(),
      this.revenue(),
    ),
  );
  dateLabel(): string {
    const anchor = parseIsoDate(this.selectedDate());
    switch (this.period()) {
      case 'semaine':
        return `Semaine du ${rangeLabel(ordersDateBounds(this.periodOrders(), this.periodBounds()))}`;
      case 'mois':
      case 'annee':
        return rangeLabel(ordersDateBounds(this.periodOrders(), this.periodBounds()));
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
    return paidTimeRange(this.periodOrders());
  }
  readonly adjustmentsSummary = computed<AdjustmentsSummary>(() => summarizeAdjustments(this.periodOrders()));
  readonly byCounter = computed<CounterBreakdown[]>(() => breakdownByCounter(this.periodOrders()));
  readonly categoryGroups = computed<CategoryGroup[]>(() => buildCategoryGroups(this.periodOrders()));
  readonly topServices = computed<CategoryLine[]>(() => computeTopServices(this.categoryGroups()));
  lineShare(total: number): number {
    return lineShare(total, this.revenue());
  }
  readonly sectionsByCounter = computed<CounterSection[]>(() => buildSectionsByCounter(this.periodOrders()));
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
    const result = await exportReportXlsx({
      title: this.title(),
      dateLabel: this.dateLabel(),
      counterFilter: this.counterFilter(),
      revenue: this.revenue(),
      revenueTrend: this.revenueTrend(),
      comparisonLabel: this.comparisonLabel(),
      clientsCount: this.clientsCount(),
      averageBasket: this.averageBasket(),
      itemsCount: this.itemsCount(),
      pendingCount: this.pendingCount(),
      rejectedCount: this.rejectedCount(),
      period: this.period(),
      timeRange: this.timeRange(),
      byCounter: this.byCounter(),
      adjustmentsSummary: this.adjustmentsSummary(),
      sectionsByCounter: this.sectionsByCounter(),
      periodOrders: this.periodOrders(),
      defaultFileName: this.defaultFileName(),
    });
    if (result.status === 'saved') {
      this.exportError.set('');
    } else if (result.status === 'error') {
      this.exportError.set(result.message);
    }
  }
  exportError = signal('');
}
