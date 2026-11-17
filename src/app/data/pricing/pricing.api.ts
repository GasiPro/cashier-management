import { ipcInvoke } from '../../core/ipc/tauri-ipc';
import type { CurrencyInfo, PriceHistoryEntry, ServiceItem } from './pricing.model';
export interface PricingItemUpdateInput {
  price: number;
  allow_majoration: boolean;
  allow_reduction: boolean;
  price_editable: boolean;
}
export function getPricingMatrix(): Promise<ServiceItem[]> {
  return ipcInvoke<ServiceItem[]>('pricing', { method: 'get_matrix' });
}
export function updatePricingItem(id: string, input: PricingItemUpdateInput): Promise<ServiceItem> {
  return ipcInvoke<ServiceItem>('pricing', {
    method: 'item_update',
    id,
    price: input.price,
    allow_majoration: input.allow_majoration,
    allow_reduction: input.allow_reduction,
    price_editable: input.price_editable,
  });
}
export function getPriceHistory(): Promise<PriceHistoryEntry[]> {
  return ipcInvoke<PriceHistoryEntry[]>('pricing', { method: 'history_get' });
}
export function getCurrency(): Promise<CurrencyInfo> {
  return ipcInvoke<CurrencyInfo>('pricing', { method: 'currency_get' });
}
export function setCurrency(code: string, name: string | null): Promise<CurrencyInfo> {
  return ipcInvoke<CurrencyInfo>('pricing', { method: 'currency_set', code, name });
}
