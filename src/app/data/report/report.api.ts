import { ipcInvoke } from '../../core/ipc/tauri-ipc';
import { getStoredUsername } from '../../core/storage/local-storage';
import type { ReportExportInput } from './report-export';
import type { ReportRecord } from './report.model';

export function listReports(): Promise<ReportRecord[]> {
  return ipcInvoke<ReportRecord[]>('report', { method: 'list' });
}

export function submitReport(payload: ReportExportInput): Promise<void> {
  return ipcInvoke<void>('report', {
    method: 'submit',
    cashier_username: getStoredUsername() ?? '',
    payload,
  });
}
