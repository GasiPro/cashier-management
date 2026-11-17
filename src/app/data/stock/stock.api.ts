import { ipcInvoke } from '../../core/ipc/tauri-ipc';
import type { StockHistoryEntry, StockItem, StockItemFields } from './stock.model';
export function getStockItems(): Promise<StockItem[]> {
  return ipcInvoke<StockItem[]>('stock', { method: 'list' });
}
export function getStockHistory(): Promise<StockHistoryEntry[]> {
  return ipcInvoke<StockHistoryEntry[]>('stock', { method: 'history' });
}
export function setStockAvailability(id: string, available: boolean, username: string): Promise<StockItem> {
  return ipcInvoke<StockItem>('stock', { method: 'set_availability', id, available, username });
}
export function setStockQuantity(id: string, quantity: number | null, username: string): Promise<StockItem> {
  return ipcInvoke<StockItem>('stock', { method: 'set_quantity', id, quantity, username });
}
export function createStockItem(
  fields: StockItemFields,
  price: number | null,
  quantity: number | null,
  username: string,
): Promise<StockItem> {
  return ipcInvoke<StockItem>('stock', { method: 'create_item', ...fields, price, quantity, username });
}
export function updateStockItem(id: string, fields: StockItemFields): Promise<StockItem> {
  return ipcInvoke<StockItem>('stock', { method: 'update_item', id, ...fields });
}
