import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { invoke } from '@tauri-apps/api/core';
import { WebsocketService, WsMessage } from '../../../../core/service/websocket.service';
import { Subscription } from 'rxjs';
export interface Order {
  id: number;
  group_id: number;
  service_type: string;
  unit_price: number;
  original_unit_price: number;
  quantity: number;
  status: 'EN_ATTENTE' | 'PAYE' | 'REJETEE';
  time: string;
  counter_username: string;
  created_at: string;
  paid_at: string | null;
  observation: string;
  raison: string | null;
}
interface OrderGroup {
  groupId: number;
  lines: Order[];
  status: Order['status'];
  totalAmount: number;
  time: string;
  createdAt: string;
  paidAt: string | null;
  counterUsername: string;
}
interface SalesComparisonPoint {
  label: string;
  today: number;
  yesterday: number;
  todayPct: number;
  yesterdayPct: number;
}
interface PerformanceSlice {
  label: string;
  value: number;
  color: string;
  dashArray: string;
  dashOffset: string;
}
interface RecentOrder {
  groupId: string;
  summary: string;
  counterUsername: string;
  totalAmount: number;
  paidLabel: string;
}
const DONUT_CIRCUMFERENCE = 2 * Math.PI * 15.9155;
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
})
export class Dashboard implements OnInit, OnDestroy {
  displayLabel = 'Tableau de bord';
  currentTime = signal('');
  wsConnected = signal(false);
  notifications = signal<unknown[]>([]);
  totalSalesYear = signal(0);
  totalSalesToday = signal(0);
  totalTransactionsToday = signal(0);
  salesComparison = signal<SalesComparisonPoint[]>([]);
  performanceSlices = signal<PerformanceSlice[]>([]);
  performanceScore = signal(0);
  recentOrders = signal<RecentOrder[]>([]);
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  private closeSubscription?: Subscription;
  /** Full order list last applied to the dashboard, kept to detect a scoped push
   *  (see resyncOrders). Not exposed as a signal — the dashboard only cares about
   *  the derived metrics computed by applyOrders. */
  private lastOrders: Order[] = [];
  constructor(private ws: WebsocketService) {}
  ngOnInit(): void {
    // Connection + registration for the admin section is owned by the parent Admin
    // shell (so the single-use login token is spent once for the whole session, not
    // re-sent every time a subview mounts) — this view only reads from it.
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      this.wsConnected.set(true);
      if (msg.type === 'orders') {
        const incoming = msg.data as Order[];
        if (incoming.length < this.lastOrders.length) {
          void this.resyncOrders();
        } else {
          this.lastOrders = incoming;
          this.applyOrders(incoming);
        }
      } else if (msg.type === 'time') {
        this.currentTime.set(msg.data as string);
      }
    });
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      void this.resyncOrders();
    });
    this.closeSubscription = this.ws.onClosed().subscribe(() => {
      this.wsConnected.set(false);
    });
    if (this.ws.isOpen()) {
      this.wsConnected.set(true);
      void this.resyncOrders();
    }
  }
  private async resyncOrders(): Promise<void> {
    try {
      const orders = await invoke<Order[]>('order', { command: { method: 'list' } });
      this.lastOrders = orders;
      this.applyOrders(orders);
    } catch (e) {
      console.error('get_orders failed', e);
    }
  }
  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.closeSubscription?.unsubscribe();
  }
  private applyOrders(orders: Order[]): void {
    const paidOrders = orders.filter((o) => o.status === 'PAYE');
    this.totalSalesYear.set(this.sumRevenue(paidOrders.filter((o) => o.paid_at && this.isThisYear(o.paid_at))));
    const todaysPaid = paidOrders.filter((o) => o.paid_at && this.isToday(o.paid_at));
    this.totalSalesToday.set(this.sumRevenue(todaysPaid));
    this.totalTransactionsToday.set(new Set(todaysPaid.map((o) => o.group_id)).size);
    const yesterdaysPaid = paidOrders.filter((o) => o.paid_at && this.isYesterday(o.paid_at));
    this.updateSalesComparison(this.sumRevenue(todaysPaid), this.sumRevenue(yesterdaysPaid));
    this.updatePerformance(orders);
    this.updateRecentOrders(orders);
  }
  private updateSalesComparison(today: number, yesterday: number): void {
    const max = Math.max(today, yesterday, 1);
    this.salesComparison.set([
      {
        label: 'Ventes',
        today,
        yesterday,
        todayPct: (today / max) * 100,
        yesterdayPct: (yesterday / max) * 100,
      },
    ]);
  }
  private updatePerformance(orders: Order[]): void {
    const todaysOrders = orders.filter((o) => this.isToday(o.created_at));
    const paidCount = this.buildGroups(todaysOrders.filter((o) => o.status === 'PAYE')).length;
    const pendingCount = this.buildGroups(todaysOrders.filter((o) => o.status === 'EN_ATTENTE')).length;
    const rejectedCount = this.buildGroups(todaysOrders.filter((o) => o.status === 'REJETEE')).length;
    const total = paidCount + pendingCount + rejectedCount;
    this.performanceScore.set(total === 0 ? 0 : Math.round((paidCount / total) * 100));
    const rawSlices: Omit<PerformanceSlice, 'dashArray' | 'dashOffset'>[] = [
      { label: 'Payées', value: total === 0 ? 0 : Math.round((paidCount / total) * 100), color: '#059669' },
      { label: 'En attente', value: total === 0 ? 0 : Math.round((pendingCount / total) * 100), color: '#D97706' },
      { label: 'Refusées', value: total === 0 ? 0 : Math.round((rejectedCount / total) * 100), color: '#DC2626' },
    ].filter((slice) => slice.value > 0);
    this.performanceSlices.set(this.buildDonutSlices(rawSlices));
  }
  private updateRecentOrders(orders: Order[]): void {
    const groups = this.buildGroups(orders).slice(0, 5);
    this.recentOrders.set(
      groups.map((group) => ({
        groupId: this.formatGroupId(group.groupId),
        summary: this.getGroupItemsSummary(group),
        counterUsername: group.counterUsername,
        totalAmount: group.totalAmount,
        paidLabel: this.formatStatusLabel(group),
      })),
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
        status: lines[0].status,
        totalAmount: lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
        time: lines[0].time,
        createdAt: lines[0].created_at,
        paidAt: lines[0].paid_at,
        counterUsername: lines[0].counter_username,
      });
    }
    return groups.sort((a, b) => b.groupId - a.groupId);
  }
  private buildDonutSlices(
    slices: Omit<PerformanceSlice, 'dashArray' | 'dashOffset'>[],
  ): PerformanceSlice[] {
    let cumulativePct = 0;
    return slices.map((slice) => {
      const sliceLength = (slice.value / 100) * DONUT_CIRCUMFERENCE;
      const dashArray = `${sliceLength} ${DONUT_CIRCUMFERENCE - sliceLength}`;
      const dashOffset = `${-(cumulativePct / 100) * DONUT_CIRCUMFERENCE}`;
      cumulativePct += slice.value;
      return { ...slice, dashArray, dashOffset };
    });
  }
  private getGroupItemsSummary(group: OrderGroup): string {
    const categoryOrder: string[] = [];
    const byCategory = new Map<string, string[]>();
    for (const l of group.lines) {
      const parts = l.service_type.split(' — ');
      const category = parts.length > 1 ? parts[0] : 'Autre';
      const label = parts.length > 1 ? parts[1] : l.service_type;
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
        categoryOrder.push(category);
      }
      byCategory.get(category)!.push(`${label} x${l.quantity}`);
    }
    return categoryOrder
      .map((category) => `${category}: ${byCategory.get(category)!.join(', ')}`)
      .join(' • ');
  }
  private formatGroupId(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }
  private formatStatusLabel(group: OrderGroup): string {
    if (group.status === 'PAYE' && group.paidAt) {
      return `Encaissée à ${this.formatTime(group.paidAt)}`;
    }
    if (group.status === 'REJETEE') {
      return 'Refusée';
    }
    return 'En attente';
  }
  private formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  private sumRevenue(orders: Order[]): number {
    return orders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }
  private startOfDay(d: Date): number {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  private isToday(iso: string): boolean {
    return this.startOfDay(new Date(iso)) === this.startOfDay(new Date());
  }
  private isYesterday(iso: string): boolean {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return this.startOfDay(new Date(iso)) === this.startOfDay(yesterday);
  }
  private isThisYear(iso: string): boolean {
    return new Date(iso).getFullYear() === new Date().getFullYear();
  }
}
