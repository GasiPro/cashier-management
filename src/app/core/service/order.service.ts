// src/app/core/service/order.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { OrderApi, Order } from './order-api.service';
import { CartItem }        from '../../domain/order/price-calculator';

@Injectable({ providedIn: 'root' })
export class OrderService {

  // ── Private state ────────────────────────────────────────────────────────────
  private _orders: Order[]     = [];
  private _nextId: number;
  private _nextGroupId: number;

  // ── Public reactive stream ───────────────────────────────────────────────────
  private readonly _orders$ = new BehaviorSubject<Order[]>([]);
  readonly orders$: Observable<Order[]> = this._orders$.asObservable();

  constructor() {
    this._orders      = OrderApi.loadOrders();
    this._nextId      = OrderApi.loadNextId();
    this._nextGroupId = OrderApi.loadNextGroupId();
    this._orders$.next(this._orders);
  }

  // ── Selectors ────────────────────────────────────────────────────────────────

  get orders(): Order[] {
    return this._orders;
  }

  /** Orders waiting to be cashed out. */
  get pending(): Order[] {
    return this._orders.filter(o => o.status === 'EN_ATTENTE');
  }

  /** Orders that have been paid today. */
  get paid(): Order[] {
    return this._orders.filter(o => o.status === 'PAYE');
  }

  // ── Commands ─────────────────────────────────────────────────────────────────

  /**
   * Atomically push a full cart as one order group.
   * Each CartItem becomes one Order row sharing the same group_id.
   */
  createOrder(cart: CartItem[]): void {
    if (cart.length === 0) return;

    const now      = new Date();
    const time     = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const created  = now.toISOString();
    const groupId  = this._nextGroupId++;

    for (const item of cart) {
      this._orders.push({
        id:           this._nextId++,
        group_id:     groupId,
        // "Photocopie — A3 NB" format consumed by both components
        service_type: `${item.service.category} — ${item.service.label}`,
        unit_price:   item.unitPrice,
        quantity:     item.qty,
        status:       'EN_ATTENTE',
        time,
        created_at:   created,
        paid_at:      null,
      });
    }

    this.commit();
  }

  /**
   * Mark every pending line of a group as paid.
   * Idempotent: already-paid lines are left untouched.
   */
  markGroupAsPaid(groupId: number): void {
    const paidAt = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    let changed = false;
    for (const order of this._orders) {
      if (order.group_id === groupId && order.status === 'EN_ATTENTE') {
        order.status  = 'PAYE';
        order.paid_at = paidAt;
        changed       = true;
      }
    }

    if (changed) this.commit();
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private commit(): void {
    OrderApi.persist(this._orders, this._nextId, this._nextGroupId);
    // Emit a new array reference so Angular OnPush / async pipe picks up the change
    this._orders$.next([...this._orders]);
  }
}