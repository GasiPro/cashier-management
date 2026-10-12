import { Component, EventEmitter, Output, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderLine } from '../../../../data/order/order.model';
import { exportReportXlsx } from '../../../../data/report/report-export';
import {
  Period,
  comparisonLabel,
  currentPeriodLabel,
  mondayOfIsoWeek,
  periodBounds,
  previousPeriodBounds,
  previousPeriodLabel,
  reportDateLabel,
  reportDefaultFileName,
  reportTitle,
  toIsoWeekValue,
} from '../../../../data/report/report-period';
import * as reportCalc from '../../../../data/report/report.calculator';
import { formatIsoDate, parseIsoDate } from '../../../../shared/utils/date';
@Component({
  selector: 'app-report-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './report-panel.html',
})
export class ReportPanel {
  paidOrders = input.required<OrderLine[]>();
  pendingCount = input<number>(0);
  @Output() closed = new EventEmitter<void>();
  @Output() notify = new EventEmitter<string>();
  exportingRapport = signal(false);
  rapportPeriod = signal<Period>('jour');
  rapportSelectedDate = signal<string>(formatIsoDate(new Date()));
  showRapportDatePicker = signal(false);
  private rapportPeriodBounds = computed(() =>
    periodBounds(this.rapportSelectedDate(), this.rapportPeriod()),
  );
  private rapportPaidOrders = computed(() =>
    reportCalc.paidOrdersInPeriod(this.paidOrders(), this.rapportPeriodBounds()),
  );
  rapportGroupsByUsername = computed(() => reportCalc.sectionsByCounterOf(this.rapportPaidOrders()));
  rapportByCounter = computed(() => reportCalc.byCounterOf(this.rapportPaidOrders()));
  rapportAverageBasket = computed(() => reportCalc.averageBasketOf(this.rapportPaidOrders()));
  rapportItemsCount = computed(() => reportCalc.itemsCountOf(this.rapportPaidOrders()));
  rapportTopServices = computed(() =>
    reportCalc.topServicesOf(reportCalc.buildCategoryGroups(this.rapportPaidOrders()), 5),
  );
  rapportAdjustmentsSummary = computed(() =>
    reportCalc.adjustmentsSummaryOf(this.rapportPaidOrders()),
  );
  rapportRevenue = computed(() => reportCalc.revenueOf(this.rapportPaidOrders()));
  rapportClientsCount = computed(() => reportCalc.clientsCountOf(this.rapportPaidOrders()));
  rapportTimeRange = computed(() => reportCalc.timeRangeOf(this.rapportPaidOrders()));
  rapportRevenueTrend = computed(() =>
    reportCalc.computeRevenueTrend(
      this.rapportRevenue(),
      reportCalc.revenueForPeriod(
        this.paidOrders(),
        previousPeriodBounds(this.rapportSelectedDate(), this.rapportPeriod()),
      ),
    ),
  );
  rapportDateLabel = computed(() =>
    reportDateLabel(
      this.rapportPeriod(),
      this.rapportSelectedDate(),
      reportCalc.ordersDateBounds(this.rapportPaidOrders(), this.rapportPeriodBounds()),
    ),
  );
  rapportCurrentPeriodLabel = computed(() => currentPeriodLabel(this.rapportPeriod()));
  rapportPreviousPeriodLabel = computed(() => previousPeriodLabel(this.rapportPeriod()));
  rapportComparisonLabel = computed(() => comparisonLabel(this.rapportPeriod()));
  rapportWeekInputValue = computed(() =>
    toIsoWeekValue(parseIsoDate(this.rapportPeriodBounds().start)),
  );
  rapportMonthInputValue = computed(() => {
    const anchor = parseIsoDate(this.rapportSelectedDate());
    return `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
  });
  rapportYearInputValue = computed(() => parseIsoDate(this.rapportSelectedDate()).getFullYear());
  rapportLineShare(line: reportCalc.CategoryLine): number {
    return reportCalc.lineShare(line.total, this.rapportRevenue());
  }
  setRapportPeriod(period: Period): void {
    if (this.rapportPeriod() === period) return;
    this.rapportPeriod.set(period);
    this.showRapportDatePicker.set(false);
  }
  setRapportCurrentPeriod(): void {
    this.rapportSelectedDate.set(formatIsoDate(new Date()));
    this.showRapportDatePicker.set(false);
  }
  setRapportPreviousPeriod(): void {
    const todayIso = formatIsoDate(new Date());
    const previous = previousPeriodBounds(todayIso, this.rapportPeriod());
    this.rapportSelectedDate.set(previous.start);
    this.showRapportDatePicker.set(false);
  }
  isRapportCurrentPeriod(): boolean {
    const todayIso = formatIsoDate(new Date());
    const bounds = this.rapportPeriodBounds();
    return todayIso >= bounds.start && todayIso <= bounds.end;
  }
  isRapportPreviousPeriod(): boolean {
    const todayIso = formatIsoDate(new Date());
    const previous = previousPeriodBounds(todayIso, this.rapportPeriod());
    const anchor = this.rapportSelectedDate();
    return anchor >= previous.start && anchor <= previous.end;
  }
  isRapportCustomPeriod(): boolean {
    return !this.isRapportCurrentPeriod() && !this.isRapportPreviousPeriod();
  }
  toggleRapportDatePicker(): void {
    this.showRapportDatePicker.update((v) => !v);
  }
  onRapportDateChange(value: string): void {
    if (!value) return;
    this.rapportSelectedDate.set(value);
    this.showRapportDatePicker.set(false);
  }
  onRapportWeekChange(value: string): void {
    const match = /^(\d{4})-W(\d{2})$/.exec(value);
    if (!match) return;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const monday = mondayOfIsoWeek(year, week);
    this.rapportSelectedDate.set(formatIsoDate(monday));
    this.showRapportDatePicker.set(false);
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
  onRapportYearChange(value: string): void {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
    this.rapportSelectedDate.set(`${year}-01-01`);
    this.showRapportDatePicker.set(false);
  }
  async exportRapportXlsx(): Promise<void> {
    this.exportingRapport.set(true);
    try {
      const period = this.rapportPeriod();
      const result = await exportReportXlsx({
        title: reportTitle(period),
        dateLabel: this.rapportDateLabel(),
        orders: this.rapportPaidOrders(),
        trend: this.rapportRevenueTrend(),
        comparisonLabel: this.rapportComparisonLabel(),
        timeRange: period === 'jour' ? this.rapportTimeRange() : undefined,
        defaultFileName: reportDefaultFileName(
          period,
          this.rapportSelectedDate(),
          this.rapportPeriodBounds(),
        ),
      });
      if (result === 'saved') this.notify.emit('Rapport exporté avec succès !');
      else if (result === 'dialog_failed') {
        this.notify.emit("Échec de l'export : impossible d'ouvrir la boîte de dialogue.");
      } else if (result === 'save_failed') {
        this.notify.emit("Échec de l'enregistrement du fichier Excel.");
      }
    } catch (e) {
      console.error('export rapport failed', e);
      this.notify.emit("Échec de l'export du rapport.");
    } finally {
      this.exportingRapport.set(false);
    }
  }
}
