export type PricingItemType = 'service' | 'product';

export interface ServiceItem {
  id: string;
  label: string;
  price: number;
  category: string;
  type: PricingItemType;
}
