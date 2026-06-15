// src/app/core/service/order-api.service.ts
export type OrderStatus = 'EN_ATTENTE' | 'PAYE';

export interface Order {
  id:           number;
  group_id:     number;
  service_type: string;
  unit_price:   number;
  quantity:     number;
  status:       OrderStatus;
  time:         string;
  created_at:   string;
  paid_at:      string | null;
}

export class OrderApi {
  private static readonly STORAGE_ORDERS_KEY = 'gasipro_orders';
  private static readonly STORAGE_ID_KEY     = 'gasipro_nextId';
  private static readonly STORAGE_GID_KEY    = 'gasipro_nextGroupId';

  static loadOrders(): Order[] {
    try {
      const raw = localStorage.getItem(this.STORAGE_ORDERS_KEY);
      return raw ? (JSON.parse(raw) as Order[]) : [];
    } catch {
      return [];
    }
  }

  static loadNextId(): number {
    const raw = localStorage.getItem(this.STORAGE_ID_KEY);
    return raw ? parseInt(raw, 10) : 1000;
  }

  static loadNextGroupId(): number {
    const raw = localStorage.getItem(this.STORAGE_GID_KEY);
    return raw ? parseInt(raw, 10) : 1;
  }

  static persist(orders: Order[], nextId: number, nextGroupId: number): void {
    localStorage.setItem(this.STORAGE_ORDERS_KEY, JSON.stringify(orders));
    localStorage.setItem(this.STORAGE_ID_KEY,     String(nextId));
    localStorage.setItem(this.STORAGE_GID_KEY,    String(nextGroupId));
  }
}