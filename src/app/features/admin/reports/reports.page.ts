import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrderStore } from '../../../data/order/order.store';
import { OrderLine } from '../../../data/order/order.model';
import {
  Period,
  PeriodBounds,
  mondayOfIsoWeek,
  periodBounds,
  previousPeriodBounds,
  rangeLabel,
  reportDefaultFileName,
  toIsoWeekValue,
} from '../../../data/report/report-period';
import {
  REPORT_ALL_COUNTERS,
  AdjustmentsSummary,
  CategoryGroup,
  CategoryLine,
  CounterBreakdown,
  CounterSection,
  RevenueTrend,
  adjustmentsSummaryOf,
  allOrdersInPeriod,
  buildCategoryGroups,
  byCounterOf,
  clientsCountOf,
  computeRevenueTrend,
  counterNames,
  groupsCountByStatus,
  itemsCountOf,
  lineShare,
  ordersDateBounds,
  paidOrdersInPeriod,
  revenueForPeriod,
  revenueOf,
  sectionsByCounterOf,
  timeRangeOf,
  topServicesOf,
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
  readonly allCounters = REPORT_ALL_COUNTERS;
  private readonly orderStore = inject(OrderStore);
  private readonly reportStore = inject(ReportStore);
  readonly wsConnected = this.orderStore.wsConnected;
  private readonly rawOrders = this.orderStore.orders;
  private readonly paidOrders = computed(() => this.rawOrders().filter((o) => o.status === 'PAYE'));
  readonly counters = computed<string[]>(() => counterNames(this.paidOrders()));
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
    return periodBounds(this.selectedDate(), this.period());
  }
  private readonly periodOrders = computed<OrderLine[]>(() =>
    paidOrdersInPeriod(this.paidOrders(), this.periodBounds(), this.counterFilter()),
  );
  readonly revenue = computed(() => revenueOf(this.periodOrders()));
  readonly clientsCount = computed(() => clientsCountOf(this.periodOrders()));
  readonly averageBasket = computed(() => {
    const clients = this.clientsCount();
    return clients === 0 ? 0 : this.revenue() / clients;
  });
  readonly itemsCount = computed(() => itemsCountOf(this.periodOrders()));
  private readonly rawOrdersInPeriod = computed<OrderLine[]>(() =>
    allOrdersInPeriod(this.rawOrders(), this.periodBounds(), this.counterFilter()),
  );
  readonly pendingCount = computed(() => groupsCountByStatus(this.rawOrdersInPeriod(), 'EN_ATTENTE'));
  readonly rejectedCount = computed(() => groupsCountByStatus(this.rawOrdersInPeriod(), 'REJETEE'));
  readonly revenueTrend = computed<RevenueTrend>(() =>
    computeRevenueTrend(
      this.revenue(),
      revenueForPeriod(
        this.paidOrders(),
        previousPeriodBounds(this.selectedDate(), this.period()),
        this.counterFilter(),
      ),
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
    return timeRangeOf(this.periodOrders());
  }
  readonly adjustmentsSummary = computed<AdjustmentsSummary>(() => adjustmentsSummaryOf(this.periodOrders()));
  readonly byCounter = computed<CounterBreakdown[]>(() => byCounterOf(this.periodOrders()));
  readonly categoryGroups = computed<CategoryGroup[]>(() => buildCategoryGroups(this.periodOrders()));
  readonly topServices = computed<CategoryLine[]>(() => topServicesOf(this.categoryGroups()));
  lineShare(total: number): number {
    return lineShare(total, this.revenue());
  }
  readonly sectionsByCounter = computed<CounterSection[]>(() => sectionsByCounterOf(this.periodOrders()));
  expandedCounter = signal<string | null>(null);
  toggleCounterDetail(username: string): void {
    this.expandedCounter.set(this.expandedCounter() === username ? null : username);
  }
  isCounterExpanded(username: string): boolean {
    return this.expandedCounter() === username;
  }
  private defaultFileName(): string {
    return reportDefaultFileName(this.period(), this.selectedDate(), this.periodBounds());
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
      counterLabel: this.counterFilter() === REPORT_ALL_COUNTERS ? undefined : this.counterFilter(),
      orders: this.periodOrders(),
      trend: this.revenueTrend(),
      comparisonLabel: this.comparisonLabel(),
      pendingCount: this.pendingCount(),
      rejectedCount: this.rejectedCount(),
      timeRange: this.period() === 'jour' ? this.timeRange() : undefined,
      defaultFileName: this.defaultFileName(),
    });
    if (result === 'saved') {
      this.exportError.set('');
    } else if (result === 'dialog_failed') {
      this.exportError.set("Échec de l'export : impossible d'ouvrir la boîte de dialogue.");
    } else if (result === 'save_failed') {
      this.exportError.set("Échec de l'enregistrement du fichier Excel.");
    }
  }
  exportError = signal('');
}
