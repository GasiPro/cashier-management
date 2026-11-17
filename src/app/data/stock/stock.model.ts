import type { PricingItemType } from '../pricing/pricing.model';

export type StockAction = 'availability' | 'quantity' | 'empty';

export interface StockItem {
  id: string;
  label: string;
  category: string;
  type: PricingItemType;
  available: boolean;
  quantity: number | null;
}

export interface StockHistoryEntry {
  id: number;
  at: string;
  admin_username: string;
  admin_id: string;
  item_id: string;
  item_label: string;
  item_category: string;
  item_type: PricingItemType;
  action: StockAction;
  before: string;
  after: string;
}
