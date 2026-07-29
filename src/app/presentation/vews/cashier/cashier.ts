// src/app/presentation/vews/cashier/cashier.ts
import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { WebsocketService, WsMessage } from '../../../core/service/websocket.service';
import { Subscription } from 'rxjs';

// Define Rust-mirrored types locally for UI compilation
export interface Order {
  id: number;
  group_id: number;
  service_type: string;
  unit_price: number;
  quantity: number;
  status: 'EN_ATTENTE' | 'PAYE';
  time: string;
  created_at: string;
  paid_at: string | null;
}

export interface OrderGroup {
  groupId: number;
  lines: Order[];
  totalAmount: number;
  time: string;
  paidAt?: string | null;
}

interface RapportLine {
  label: string;
  unitPrice: number;
  qty: number;
  total: number;
}

interface RapportCategoryGroup {
  category: string;
  lines: RapportLine[];
}

// The Cashier is always the WS host, so it talks to its own local server —
// no LAN address to configure here (unlike Counter, which connects out to
// the Cashier's IP).
const CASHIER_LOCAL_WS_URL = 'ws://127.0.0.1:8080';

@Component({
  selector: 'app-cashier',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cashier.html',
})
export class Cashier implements OnInit, OnDestroy {
  // This app runs zoneless (no zone.js — see package.json / angular.json).
  // Anything written from an async callback that Angular doesn't already
  // track (WebSocket messages, setTimeout, promise continuations, etc.)
  // has to live in a signal, or the view silently stops updating until
  // some unrelated click forces a re-render. Everything below is written
  // from the WS subscription, so it's a signal.
  currentTime = signal('');
  pendingGroups = signal<OrderGroup[]>([]);
  paidGroups = signal<OrderGroup[]>([]);
  totalRevenue = signal(0);
  volumeByService = signal<Record<string, number>>({});
  wsConnected = signal(false);

  // showRapport is only ever toggled from a (click) handler in the template,
  // which Angular's zoneless scheduler already picks up on its own — no
  // signal needed here.
  showRapport = false;

  // Local storage for processing UI computations without domain imports
  private _rawOrders: Order[] = [];
  private _rawPaidOrders: Order[] = [];
  private wsSubscription?: Subscription;

  constructor(
    private router: Router,
    private ws: WebsocketService,
  ) {}

  ngOnInit(): void {
    // Every field below is now derived purely from the "orders" / "time" WS
    // broadcasts pushed by this same machine's Rust backend — there's no
    // more separate invoke('get_pending_orders') / invoke('get_paid_orders')
    // polling step, so there's exactly one source of truth for order state.
    this.ws.connect(CASHIER_LOCAL_WS_URL);
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      this.wsConnected.set(true);
      if (msg.type === 'orders') {
        this.applyOrders(msg.data as Order[]);
      } else if (msg.type === 'time') {
        this.currentTime.set(msg.data as string);
      }
    });
  }

  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.ws.disconnect();
  }

  // ── Rust Bridge Integration ──────────────────────────────────────────────────

  async markGroupAsPaid(groupId: number): Promise<void> {
    // Mutates local state directly since the Cashier IS the WS host. The
    // Rust command broadcasts the refreshed "orders" snapshot afterwards,
    // which flows back through the subscription above — no manual refresh
    // needed, and every connected Counter sees the same update instantly.
    await invoke('mark_group_as_paid', { groupId });
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  // ── Template UI Helpers ──────────────────────────────────────────────────────

  formatGroupId(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }

  getGroupItemsSummary(group: OrderGroup): string {
    return group.lines
      .map((l) => {
        const parts = l.service_type.split(' — ');
        return `${l.quantity}× ${parts[1] ?? l.service_type}`;
      })
      .join(', ');
  }

  volumeEntries(): { key: string; value: number }[] {
    return Object.entries(this.volumeByService()).map(([key, value]) => ({
      key,
      value,
    }));
  }

  rapportGroups(): RapportCategoryGroup[] {
    const map = new Map<string, Map<string, RapportLine>>();

    for (const order of this._rawPaidOrders) {
      const [category, label] = order.service_type.split(' — ');
      const key = label ?? order.service_type;

      if (!map.has(category)) map.set(category, new Map());
      const cat = map.get(category)!;

      if (!cat.has(key)) {
        cat.set(key, {
          label: key,
          unitPrice: order.unit_price,
          qty: 0,
          total: 0,
        });
      }

      const entry = cat.get(key)!;
      entry.qty += order.quantity;
      entry.total += order.quantity * order.unit_price;
    }

    return Array.from(map.entries()).map(([category, lines]) => ({
      category,
      lines: Array.from(lines.values()),
    }));
  }

  // ── Derivation from the latest "orders" broadcast ─────────────────────────────

  private applyOrders(orders: Order[]): void {
    this._rawOrders = orders;
    this._rawPaidOrders = orders.filter(o => o.status === 'PAYE');
    const pendingOrders = orders.filter(o => o.status === 'EN_ATTENTE');

    this.pendingGroups.set(this.buildGroups(pendingOrders));
    this.paidGroups.set(this.buildGroups(this._rawPaidOrders));

    this.totalRevenue.set(
      this._rawPaidOrders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0)
    );

    this.volumeByService.set(
      this._rawPaidOrders.reduce((acc, o) => {
        acc[o.service_type] = (acc[o.service_type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    );
  }

  private buildGroups(orders: Order[]): OrderGroup[] {
    const map = new Map<number, Order[]>();
    for (const o of orders) {
      if (!map.has(o.group_id)) map.set(o.group_id, []);
      map.get(o.group_id)!.push(o);
    }

    const groups: OrderGroup[] = [];
    for (const [groupId, lines] of map.entries()) {
      groups.push({
        groupId,
        lines,
        totalAmount: lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
        time: lines[0].time,
        paidAt: lines[0].paid_at,
      });
    }
    return groups.sort((a, b) => b.groupId - a.groupId);
  }
}
