import { ipcInvoke } from '../../core/ipc/tauri-ipc';
import { getStoredUsername } from '../../core/storage/local-storage';
import type {
  CurrencyInfo,
  MorInput,
  PriceAdjustmentKind,
  PriceHistoryEntry,
  PriceLogEntry,
  ServiceItem,
} from './pricing.model';
export interface PricingItemUpdateInput {
  price: number;
  price_editable: boolean;
  majoration?: MorInput | null;
  reduction?: MorInput | null;
}
export function getPricingMatrix(): Promise<ServiceItem[]> {
  return ipcInvoke<ServiceItem[]>('pricing', { method: 'get_matrix' });
}
export function updatePricingItem(id: string, input: PricingItemUpdateInput): Promise<ServiceItem> {
  return ipcInvoke<ServiceItem>('pricing', {
    method: 'item_update',
    id,
    price: input.price,
    price_editable: input.price_editable,
    majoration: input.majoration ?? null,
    reduction: input.reduction ?? null,
    username: getStoredUsername() ?? '',
  });
}
export function setMor(id: string, kind: PriceAdjustmentKind, input: MorInput): Promise<ServiceItem> {
  return ipcInvoke<ServiceItem>('pricing', {
    method: 'mor_set',
    id,
    kind,
    rate: input.rate,
    days: input.days,
    max_orders: input.max_orders,
    username: getStoredUsername() ?? '',
  });
}
export function deleteMor(id: string, kind: PriceAdjustmentKind): Promise<ServiceItem> {
  return ipcInvoke<ServiceItem>('pricing', { method: 'mor_delete', id, kind });
}
export function getPriceHistory(): Promise<PriceHistoryEntry[]> {
  return ipcInvoke<PriceHistoryEntry[]>('pricing', { method: 'history_get' });
}
export function getPriceLog(): Promise<PriceLogEntry[]> {
  return ipcInvoke<PriceLogEntry[]>('pricing', { method: 'log_get' });
}
export function getCurrency(): Promise<CurrencyInfo> {
  return ipcInvoke<CurrencyInfo>('pricing', { method: 'currency_get' });
}
export function setCurrency(code: string, name: string | null): Promise<CurrencyInfo> {
  return ipcInvoke<CurrencyInfo>('pricing', {
    method: 'currency_set',
    code,
    name,
    username: getStoredUsername() ?? '',
  });
}
