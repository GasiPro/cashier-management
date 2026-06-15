// src/app/presentation/vews/caisse/caisse.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { OrderService }    from '../../../core/service/order.service';
import { Order }           from '../../../domain/order/order.model';
import { PriceCalculator } from '../../../domain/order/price-calculator';

export interface OrderGroup {
  groupId:     number;
  lines:       Order[];
  totalAmount: number;
  time:        string;
  paidAt?:     string | null;
}

@Component({
  selector: 'app-caissier',
  standalone:  true,
  imports:     [CommonModule],
  templateUrl: './cashier.html',
})
export class Cashier implements OnInit, OnDestroy {

  currentTime  = '';
  private clockId!: ReturnType<typeof setInterval>;
  pendingGroups: OrderGroup[] = [];
  paidGroups:    OrderGroup[] = [];
  totalRevenue                = 0;
  volumeByService: Record<string, number> = {};
  showRapport     = false;

  private sub!: Subscription;

  constructor(
    private orderService: OrderService,
    private router:       Router,
  ) {}

  ngOnInit(): void {
    this.updateClock();
    this.clockId = setInterval(() => this.updateClock(), 60_000);
    this.sub = this.orderService.orders$.subscribe(() => this.refresh());
    this.refresh();
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    clearInterval(this.clockId);
  }

  // ── Domain delegation ────────────────────────────────────────────────────────

  private refresh(): void {
    this.totalRevenue    = PriceCalculator.calculateRevenue(this.orderService.paid);
    this.volumeByService = PriceCalculator.aggregateVolumeByService(this.orderService.paid);
    this.pendingGroups   = this.buildGroups(this.orderService.pending);
    this.paidGroups      = this.buildGroups(this.orderService.paid);
  }

  // ── Commands ─────────────────────────────────────────────────────────────────

  markGroupAsPaid(groupId: number): void {
    this.orderService.markGroupAsPaid(groupId);
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  // ── Template helpers ─────────────────────────────────────────────────────────

  formatGroupId(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }

  getGroupItemsSummary(group: OrderGroup): string {
    return group.lines
      .map(l => {
        const parts = l.service_type.split(' — ');
        return `${l.quantity}× ${parts[1] ?? l.service_type}`;
      })
      .join(', ');
  }

  volumeEntries(): { key: string; value: number }[] {
    return Object.entries(this.volumeByService)
      .map(([key, value]) => ({ key, value })); 
  }

  rapportGroups(): { category: string; lines: { label: string; unitPrice: number; qty: number; total: number }[] }[] {
  const map = new Map<string, Map<string, { unitPrice: number; qty: number; total: number }>>();

  for (const order of this.orderService.paid) {
    const [category, label] = order.service_type.split(' — ');
    const key = label ?? order.service_type;

    if (!map.has(category)) map.set(category, new Map());
    const cat = map.get(category)!;

    if (!cat.has(key)) cat.set(key, { unitPrice: order.unit_price, qty: 0, total: 0 });
    const entry = cat.get(key)!;
    entry.qty   += order.quantity;
    entry.total += order.quantity * order.unit_price;
  }

  return Array.from(map.entries()).map(([category, lines]) => ({
    category,
    lines: Array.from(lines.entries()).map(([label, v]) => ({ label, ...v })),
  }));
}

  // ── Private helpers ──────────────────────────────────────────────────────────

  private buildGroups(orders: Order[]): OrderGroup[] {
    const map = new Map<number, Order[]>();
    for (const o of orders) {
      if (!map.has(o.group_id)) map.set(o.group_id, []);
      map.get(o.group_id)!.push(o);
    }

    const groups: OrderGroup[] = [];
    for (const [groupId, lines] of map.entries()) {
      const totalAmount = lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
      groups.push({
        groupId,
        lines,
        totalAmount,
        time:   lines[0].time,
        paidAt: lines[0].paid_at,
      });
    }
    // Most-recent group first
    return groups.sort((a, b) => b.groupId - a.groupId);
  }

  private updateClock(): void {
    this.currentTime = new Date().toLocaleTimeString('fr-FR', {
      hour:   '2-digit',
      minute: '2-digit',
    });
  }
}