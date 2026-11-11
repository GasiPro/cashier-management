import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { errorMessage } from '../../../core/error/error-messages';
import { exportReportXlsx } from '../../../data/report/report-export';
import {
  averageBasketOf,
  byCounterOf,
  clientsCountOf,
  itemsCountOf,
  revenueOf,
} from '../../../data/report/report.calculator';
import { listReports } from '../../../data/report/report.api';
import { ReportRecord, formatReportId } from '../../../data/report/report.model';
import { TimePipe } from '../../../shared/pipes/time.pipe';

interface ReportRow {
  record: ReportRecord;
  idLabel: string;
  revenue: number;
  transactions: number;
  averageBasket: number;
  items: number;
  counters: string;
}

interface Notice {
  message: string;
  error: boolean;
}

const NOTICE_DURATION_MS = 3000;
const COPIED_DURATION_MS = 1500;

function toRow(record: ReportRecord): ReportRow {
  const orders = record.payload.orders;
  return {
    record,
    idLabel: formatReportId(record.id),
    revenue: revenueOf(orders),
    transactions: clientsCountOf(orders),
    averageBasket: averageBasketOf(orders),
    items: itemsCountOf(orders),
    counters: byCounterOf(orders)
      .map((counter) => counter.username)
      .join(', '),
  };
}

@Component({
  selector: 'app-admin-reports',
  standalone: true,
  imports: [CommonModule, TimePipe],
  templateUrl: './reports.page.html',
})
export class ReportsPage implements OnInit, OnDestroy {
  readonly reports = signal<ReportRecord[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly expandedId = signal<number | null>(null);
  readonly copiedId = signal<number | null>(null);
  readonly downloadingId = signal<number | null>(null);
  readonly notice = signal<Notice | null>(null);

  readonly rows = computed<ReportRow[]>(() => this.reports().map(toRow));

  private copiedTimer?: ReturnType<typeof setTimeout>;
  private noticeTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.copiedTimer);
    clearTimeout(this.noticeTimer);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      this.reports.set(await listReports());
    } catch (e) {
      console.error('list reports failed', e);
      this.loadError.set(errorMessage(e, 'Impossible de charger les rapports.'));
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: number): void {
    this.expandedId.update((current) => (current === id ? null : id));
  }

  isExpanded(id: number): boolean {
    return this.expandedId() === id;
  }

  async copyId(record: ReportRecord): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatReportId(record.id));
      this.copiedId.set(record.id);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedId.set(null), COPIED_DURATION_MS);
    } catch (e) {
      console.error('copy report id failed', e);
      this.showNotice("Impossible de copier l'identifiant.", true);
    }
  }

  async download(record: ReportRecord): Promise<void> {
    if (this.downloadingId() !== null) return;
    this.downloadingId.set(record.id);
    try {
      const result = await exportReportXlsx(record.payload);
      if (result === 'saved') {
        this.showNotice('Rapport téléchargé.', false);
      } else if (result === 'dialog_failed') {
        this.showNotice("Échec du téléchargement : impossible d'ouvrir la boîte de dialogue.", true);
      } else if (result === 'save_failed') {
        this.showNotice("Échec de l'enregistrement du fichier Excel.", true);
      }
    } catch (e) {
      console.error('download report failed', e);
      this.showNotice('Échec du téléchargement du rapport.', true);
    } finally {
      this.downloadingId.set(null);
    }
  }

  private showNotice(message: string, error: boolean): void {
    this.notice.set({ message, error });
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.set(null), NOTICE_DURATION_MS);
  }
}
