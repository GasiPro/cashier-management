import { Component, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderStore } from '../../../data/order/order.store';
import { OrderGroup, OrderLine } from '../../../data/order/order.model';
import { buildGroups, formatGroupId, getGroupItemsSummary } from '../../../data/order/order.utils';
import { startOfDay } from '../../../shared/utils/date';
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
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.page.html',
})
export class DashboardPage {
  totalSalesYear = signal(0);
  totalSalesToday = signal(0);
  totalTransactionsToday = signal(0);
  salesComparison = signal<SalesComparisonPoint[]>([]);
  performanceSlices = signal<PerformanceSlice[]>([]);
  performanceScore = signal(0);
  recentOrders = signal<RecentOrder[]>([]);
  private readonly orderStore = inject(OrderStore);
  constructor() {
    effect(() => {
      const orders = this.orderStore.lines();
      untracked(() => this.applyOrders(orders));
    });
  }
  private applyOrders(orders: OrderLine[]): void {
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
  private updatePerformance(orders: OrderLine[]): void {
    const todaysOrders = orders.filter((o) => this.isToday(o.created_at));
    const paidCount = buildGroups(todaysOrders.filter((o) => o.status === 'PAYE')).length;
    const pendingCount = buildGroups(todaysOrders.filter((o) => o.status === 'EN_ATTENTE')).length;
    const rejectedCount = buildGroups(todaysOrders.filter((o) => o.status === 'REJETEE')).length;
    const total = paidCount + pendingCount + rejectedCount;
    this.performanceScore.set(total === 0 ? 0 : Math.round((paidCount / total) * 100));
    const rawSlices: Omit<PerformanceSlice, 'dashArray' | 'dashOffset'>[] = [
      { label: 'Payées', value: total === 0 ? 0 : Math.round((paidCount / total) * 100), color: '#059669' },
      { label: 'En attente', value: total === 0 ? 0 : Math.round((pendingCount / total) * 100), color: '#D97706' },
      { label: 'Refusées', value: total === 0 ? 0 : Math.round((rejectedCount / total) * 100), color: '#DC2626' },
    ].filter((slice) => slice.value > 0);
    this.performanceSlices.set(this.buildDonutSlices(rawSlices));
  }
  private updateRecentOrders(orders: OrderLine[]): void {
    const groups = buildGroups(orders).slice(0, 5);
    this.recentOrders.set(
      groups.map((group) => ({
        groupId: formatGroupId(group.groupId),
        summary: getGroupItemsSummary(group),
        counterUsername: group.counterUsername,
        totalAmount: group.totalAmount,
        paidLabel: this.formatStatusLabel(group),
      })),
    );
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
  private sumRevenue(orders: OrderLine[]): number {
    return orders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }
  private isToday(iso: string): boolean {
    return startOfDay(new Date(iso)) === startOfDay(new Date());
  }
  private isYesterday(iso: string): boolean {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return startOfDay(new Date(iso)) === startOfDay(yesterday);
  }
  private isThisYear(iso: string): boolean {
    return new Date(iso).getFullYear() === new Date().getFullYear();
  }
}
