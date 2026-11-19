export type PricingItemType = 'service' | 'product';
export type PriceAdjustmentKind = 'majoration' | 'reduction';
export interface PriceRule {
  id: string;
  rate: number;
  days: number | null;
  max_orders: number | null;
  created_at: string;
  used_orders: number;
}
export interface MorInput {
  rate: number;
  days: number | null;
  max_orders: number | null;
}
export interface ServiceItem {
  id: string;
  label: string;
  price: number;
  category: string;
  type: PricingItemType;
  available: boolean;
  majoration: PriceRule | null;
  reduction: PriceRule | null;
  price_editable: boolean;
}
export type PricePeak = 'highest' | 'lowest';
export interface PriceHistoryEntry {
  id: string;
  at: string;
  counter_username: string;
  counter_id: string;
  order_id: number;
  item_id: string;
  service_type: string;
  kind: PriceAdjustmentKind;
  normal_price: number;
  applied_price: number;
  peak?: PricePeak | null;
}
export type PriceLogAction = 'mor_added' | 'price_changed' | 'currency_changed';
export interface PriceLogEntry {
  id: string;
  at: string;
  admin_username: string;
  admin_id: string;
  item_id: string;
  service_type: string;
  action: PriceLogAction;
  kind: PriceAdjustmentKind | null;
  before: number | null;
  after: number | null;
  before_code?: string | null;
  after_code?: string | null;
}
export interface Currency {
  code: string;
  name: string;
}
export interface CurrencyInfo {
  selected: string;
  currencies: Currency[];
}
