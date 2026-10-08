import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { WsClient } from '../../core/realtime/ws-client';
import type { WsMessage } from '../../core/realtime/ws-protocol';
import { listOrders } from './order.api';
import type { OrderGroup, OrderLine } from './order.model';
import { buildGroups } from './order.utils';

@Injectable({ providedIn: 'root' })
export class OrderStore implements OnDestroy {
  readonly orders = signal<OrderLine[]>([]);
  readonly wsConnected = signal(false);

  readonly groups = computed<OrderGroup[]>(() => buildGroups(this.orders()));
  readonly pendingGroups = computed<OrderGroup[]>(() =>
    buildGroups(this.orders().filter((o) => o.status === 'EN_ATTENTE')),
  );
  readonly paidOrders = computed<OrderLine[]>(() => this.orders().filter((o) => o.status === 'PAYE'));
  readonly paidGroups = computed<OrderGroup[]>(() => buildGroups(this.paidOrders()));
  readonly rejectedGroups = computed<OrderGroup[]>(() =>
    buildGroups(this.orders().filter((o) => o.status === 'REJETEE')),
  );

  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  private closeSubscription?: Subscription;

  constructor(private ws: WsClient) {}

  start(): void {
    this.stop();
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      this.wsConnected.set(true);
      if (msg.type === 'orders') {
        const incoming = msg.data;
        if (incoming.length < this.orders().length) {
          void this.resync();
        } else {
          this.orders.set(incoming);
        }
      }
    });
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      void this.resync();
    });
    this.closeSubscription = this.ws.onClosed().subscribe(() => {
      this.wsConnected.set(false);
    });
    if (this.ws.isOpen()) {
      this.wsConnected.set(true);
      void this.resync();
    }
  }

  stop(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.closeSubscription?.unsubscribe();
  }

  async resync(): Promise<void> {
    try {
      this.orders.set(await listOrders());
    } catch (e) {
      console.error('get_orders failed', e);
    }
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
