import { ipcInvoke } from '../../core/ipc/tauri-ipc';
import type { OrderLine } from './order.model';

export function listOrders(): Promise<OrderLine[]> {
  return ipcInvoke<OrderLine[]>('order', { method: 'list' });
}

export function markGroupPaid(groupId: number): Promise<void> {
  return ipcInvoke<void>('order', { method: 'group_mark_paid', group_id: groupId });
}

export function rejectGroup(groupId: number, raison?: string | null): Promise<void> {
  return ipcInvoke<void>('order', {
    method: 'group_reject',
    group_id: groupId,
    raison: raison?.trim() ? raison.trim() : null,
  });
}
