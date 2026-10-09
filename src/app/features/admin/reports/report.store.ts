import { Injectable, signal } from '@angular/core';
import { Period } from '../../../data/report/report-period';
import { ALL_COUNTERS } from '../../../data/report/report.calculator';
import { formatIsoDate } from '../../../shared/utils/date';

@Injectable()
export class ReportStore {
  readonly period = signal<Period>('jour');
  readonly selectedDate = signal<string>(formatIsoDate(new Date()));
  readonly counterFilter = signal<string>(ALL_COUNTERS);
}
