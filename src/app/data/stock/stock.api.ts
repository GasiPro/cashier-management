import { ipcInvoke } from '../../core/ipc/tauri-ipc';
import type { StockHistoryEntry, StockItem } from './stock.model';

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
