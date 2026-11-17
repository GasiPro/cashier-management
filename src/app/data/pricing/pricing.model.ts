export type PricingItemType = 'service' | 'product';
export interface ServiceItem {
  id: string;
  label: string;
  price: number;
  category: string;
  type: PricingItemType;
  available: boolean;
  allow_majoration: boolean;
  allow_reduction: boolean;
  price_editable: boolean;
}
export type PriceAdjustmentKind = 'majoration' | 'reduction';
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
export interface Currency {
  code: string;
  name: string;
}
export interface CurrencyInfo {
  selected: string;
  currencies: Currency[];
}
