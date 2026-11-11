import type { ReportExportInput } from './report-export';

export interface ReportRecord {
  id: number;
  cashier_username: string;
  created_at: string;
  payload: ReportExportInput;
}

export function formatReportId(id: number): string {
  return '#' + String(id).padStart(4, '0');
}
