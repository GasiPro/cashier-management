// src/app/presentation/vews/cashier/cashier.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';

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

@Component({
  selector: 'app-cashier', // was 'app-caissier' — kept the class/selector language consistent with `Counter`
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cashier.html',
})
export class Cashier implements OnInit, OnDestroy {
  currentTime = '';
  private clockId!: ReturnType<typeof setInterval>;

  pendingGroups: OrderGroup[] = [];
  paidGroups: OrderGroup[] = [];
  totalRevenue = 0;
  volumeByService: Record<string, number> = {};
  showRapport = false;

  // Local storage for processing UI computations without domain imports
  private _rawPaidOrders: Order[] = [];

  constructor(private router: Router) {}

  async ngOnInit(): Promise<void> {
    this.updateClock();
    this.clockId = setInterval(() => this.updateClock(), 60_000);
    await this.refresh();
  }

  ngOnDestroy(): void {
    clearInterval(this.clockId);
  }

  // ── Rust Bridge Integration ──────────────────────────────────────────────────

  private async refresh(): Promise<void> {
    // Fetch state directly from your registered Tauri commands
    const pendingOrders = await invoke<Order[]>('get_pending_orders');
    this._rawPaidOrders = await invoke<Order[]>('get_paid_orders');

    // Perform layout groupings natively for the view
    this.pendingGroups = this.buildGroups(pendingOrders);
    this.paidGroups = this.buildGroups(this._rawPaidOrders);

    // Calculate metrics locally using the raw data to replace PriceCalculator logic
    this.totalRevenue = this._rawPaidOrders.reduce(
      (sum, o) => sum + o.quantity * o.unit_price,
      0
    );

    this.volumeByService = this._rawPaidOrders.reduce((acc, o) => {
      acc[o.service_type] = (acc[o.service_type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  async markGroupAsPaid(groupId: number): Promise<void> {
    await invoke('mark_group_as_paid', { groupId });
    await this.refresh();
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
    return Object.entries(this.volumeByService).map(([key, value]) => ({
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

  private updateClock(): void {
    this.currentTime = new Date().toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
