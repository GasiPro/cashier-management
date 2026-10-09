import { ipcInvoke } from '../../core/ipc/tauri-ipc';
import type { PricingItemType, ServiceItem } from './pricing.model';

export interface PricingItemInput {
  label: string;
  category: string;
  price: number;
  item_type: PricingItemType;
}

export function getPricingMatrix(): Promise<ServiceItem[]> {
  return ipcInvoke<ServiceItem[]>('pricing', { method: 'get_matrix' });
}

export function createPricingItem(input: PricingItemInput): Promise<ServiceItem> {
  return ipcInvoke<ServiceItem>('pricing', {
    method: 'item_create',
    label: input.label,
    category: input.category,
    price: input.price,
    item_type: input.item_type,
  });
}

export function updatePricingItem(id: string, input: PricingItemInput): Promise<ServiceItem> {
  return ipcInvoke<ServiceItem>('pricing', {
    method: 'item_update',
    id,
    label: input.label,
    category: input.category,
    price: input.price,
    item_type: input.item_type,
  });
}

export function deletePricingItem(id: string): Promise<void> {
  return ipcInvoke<void>('pricing', { method: 'item_delete', id });
}
