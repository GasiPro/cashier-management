export enum ServiceItemType {
    PRODUCT = 'produit',
    SERVICE = 'service'
}

export interface ServiceItem {
    id: string;
    type: ServiceItemType;
    category: string;
    label: string;
    price: number;
}

export interface CartItem {
    service: ServiceItem;
    qty: number;
    unitPrice: number;
}


export class PriceCalculator {
  static calculateLineTotal(qty: number, unitPrice: number): number {
    return qty * unitPrice;
  }

  static calculateRevenue(paidOrders: { quantity: number; unit_price: number }[]): number {
    return paidOrders.reduce((sum, o) => sum + this.calculateLineTotal(o.quantity, o.unit_price), 0);
  }

  static aggregateVolumeByService(paidOrders: { service_type: string }[]): Record<string, number> {
    return paidOrders.reduce((acc, o) => {
      acc[o.service_type] = (acc[o.service_type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
}
