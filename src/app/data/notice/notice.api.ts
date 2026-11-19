import { ipcInvoke } from '../../core/ipc/tauri-ipc';
export function publishNotice(counter: string[], cashier: string[]): Promise<void> {
  return ipcInvoke<void>('server', { method: 'notice_publish', counter, cashier });
}
