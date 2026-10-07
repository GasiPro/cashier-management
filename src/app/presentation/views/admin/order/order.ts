import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { WebsocketService, WsMessage } from '../../../../core/service/websocket.service';
import { Subscription } from 'rxjs';
export interface OrderLine {
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
export interface OrderGroup {
  groupId: number;
  lines: OrderLine[];
  status: OrderLine['status'];
  totalAmount: number;
  time: string;
  createdAt: string;
  paidAt: string | null;
  counterUsername: string;
  observation: string;
  raison: string | null;
}
type StatusFilter = 'all' | OrderLine['status'];
type SortKey = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';
@Component({
  selector: 'app-order',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './order.html',
  styleUrl: './order.css',
})
export class Order implements OnInit, OnDestroy {
  wsConnected = signal(false);
  private rawOrders = signal<OrderLine[]>([]);
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  private closeSubscription?: Subscription;
  constructor(private ws: WebsocketService) {}
  ngOnInit(): void {
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      this.wsConnected.set(true);
      if (msg.type === 'orders') {
        const incoming = msg.data as OrderLine[];
        if (incoming.length < this.rawOrders().length) {
          void this.resyncOrders();
        } else {
          this.rawOrders.set(incoming);
        }
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
      const orders = await invoke<OrderLine[]>('order', { command: { method: 'list' } });
      this.rawOrders.set(orders);
    } catch (e) {
      console.error('get_orders failed', e);
    }
  }
  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.closeSubscription?.unsubscribe();
  }
  orderStatusMessage = signal('');
  orderStatusIsError = signal(false);
  private setOrderStatus(message: string, isError: boolean): void {
    this.orderStatusMessage.set(message);
    this.orderStatusIsError.set(isError);
  }
  private errorMessage(e: unknown, fallback: string): string {
    if (typeof e === 'string') return e.trim() || fallback;
    if (e instanceof Error) return e.message.trim() || fallback;
    if (e && typeof e === 'object' && 'message' in e) {
      const message = String((e as { message: unknown }).message).trim();
      if (message) return message;
    }
    if (e === null || e === undefined) return fallback;
    const text = String(e).trim();
    return text && text !== '[object Object]' ? text : fallback;
  }
  markingPaidGroupId = signal<number | null>(null);
  async markGroupAsPaid(group: OrderGroup): Promise<void> {
    if (this.markingPaidGroupId() !== null) return;
    this.markingPaidGroupId.set(group.groupId);
    this.setOrderStatus('', false);
    try {
      await invoke<void>('order', {
        command: { method: 'group_mark_paid', group_id: group.groupId },
      });
      await this.resyncOrders();
      this.setOrderStatus(`Commande ${this.formatGroupId(group.groupId)} encaissée.`, false);
    } catch (e) {
      console.error('group_mark_paid failed', e);
      this.setOrderStatus(this.errorMessage(e, "Échec de l'encaissement de la commande. Réessayez."), true);
    } finally {
      this.markingPaidGroupId.set(null);
    }
  }
  readonly groups = computed<OrderGroup[]>(() => {
    const map = new Map<number, OrderLine[]>();
    for (const line of this.rawOrders()) {
      if (!map.has(line.group_id)) map.set(line.group_id, []);
      map.get(line.group_id)!.push(line);
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
        observation: lines[0].observation,
        raison: lines[0].raison,
      });
    }
    return groups.sort((a, b) => b.groupId - a.groupId);
  });
  readonly totalCount = computed(() => this.groups().length);
  readonly paidCount = computed(() => this.groups().filter((g) => g.status === 'PAYE').length);
  readonly pendingCount = computed(() => this.groups().filter((g) => g.status === 'EN_ATTENTE').length);
  readonly rejectedCount = computed(() => this.groups().filter((g) => g.status === 'REJETEE').length);
  readonly totalRevenue = computed(() =>
    this.groups()
      .filter((g) => g.status === 'PAYE')
      .reduce((sum, g) => sum + g.totalAmount, 0),
  );
  statusFilter = signal<StatusFilter>('all');
  searchTerm = signal('');
  sortKey = signal<SortKey>('date-desc');
  setStatusFilter(status: StatusFilter): void {
    this.statusFilter.set(status);
  }
  isStatusFilterActive(status: StatusFilter): boolean {
    return this.statusFilter() === status;
  }
  readonly filtersActive = computed(
    () => this.statusFilter() !== 'all' || this.searchTerm().trim().length > 0,
  );
  resetFilters(): void {
    this.statusFilter.set('all');
    this.searchTerm.set('');
  }
  readonly filteredGroups = computed<OrderGroup[]>(() => {
    const status = this.statusFilter();
    const term = this.searchTerm().trim().toLowerCase();
    const sort = this.sortKey();
    const list = this.groups().filter((group) => {
      if (status !== 'all' && group.status !== status) return false;
      if (term) {
        const idMatch = this.formatGroupId(group.groupId).toLowerCase().includes(term);
        const counterMatch = group.counterUsername.toLowerCase().includes(term);
        const lineMatch = group.lines.some((l) => l.service_type.toLowerCase().includes(term));
        if (!idMatch && !counterMatch && !lineMatch) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'date-asc':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'amount-desc':
          return b.totalAmount - a.totalAmount;
        case 'amount-asc':
          return a.totalAmount - b.totalAmount;
        case 'date-desc':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
  });
  expandedGroupId = signal<number | null>(null);
  toggleExpand(group: OrderGroup): void {
    this.expandedGroupId.set(this.expandedGroupId() === group.groupId ? null : group.groupId);
  }
  isExpanded(group: OrderGroup): boolean {
    return this.expandedGroupId() === group.groupId;
  }
  formatGroupId(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }
  statusLabel(status: OrderLine['status']): string {
    switch (status) {
      case 'PAYE':
        return 'Payée';
      case 'REJETEE':
        return 'Refusée';
      case 'EN_ATTENTE':
      default:
        return 'En attente';
    }
  }
  statusBadgeClass(status: OrderLine['status']): string {
    const base = 'inline-flex items-center text-[10px] font-semibold uppercase tracking-wide' +
      ' border rounded-full px-1.5 py-0.5 flex-shrink-0';
    switch (status) {
      case 'PAYE':
        return `${base} text-emerald-700 bg-emerald-50 border-emerald-200`;
      case 'REJETEE':
        return `${base} text-red-700 bg-red-50 border-red-200`;
      case 'EN_ATTENTE':
      default:
        return `${base} text-amber-700 bg-amber-50 border-amber-200`;
    }
  }
  getGroupItemsSummary(group: OrderGroup): string {
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
  formatDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  formatTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  confirmingRejectGroupId = signal<number | null>(null);
  rejectReason = signal('');
  rejectingGroup = signal(false);
  rejectGroupError = signal('');
  requestRejectGroup(group: OrderGroup): void {
    this.expandedGroupId.set(group.groupId);
    this.confirmingRejectGroupId.set(group.groupId);
    this.rejectReason.set('');
    this.rejectGroupError.set('');
    setTimeout(() => {
      document.getElementById(`order-reject-confirm-btn-${group.groupId}`)?.focus();
    });
  }
  cancelRejectGroup(): void {
    const groupId = this.confirmingRejectGroupId();
    this.confirmingRejectGroupId.set(null);
    this.rejectGroupError.set('');
    if (groupId !== null) {
      document.getElementById(`order-reject-btn-${groupId}`)?.focus();
    }
  }
  async confirmRejectGroup(group: OrderGroup): Promise<void> {
    if (this.rejectingGroup()) return;
    this.rejectingGroup.set(true);
    this.rejectGroupError.set('');
    this.setOrderStatus('', false);
    try {
      await invoke<void>('order', {
        command: {
          method: 'group_reject',
          group_id: group.groupId,
          raison: this.rejectReason().trim() ? this.rejectReason().trim() : null,
        },
      });
      await this.resyncOrders();
      this.confirmingRejectGroupId.set(null);
      this.setOrderStatus(`Commande ${this.formatGroupId(group.groupId)} refusée.`, false);
      document.getElementById(`order-toggle-btn-${group.groupId}`)?.focus();
    } catch (e) {
      console.error('reject_group failed', e);
      const message = this.errorMessage(e, 'Échec du refus de la commande. Réessayez.');
      this.rejectGroupError.set(message);
    } finally {
      this.rejectingGroup.set(false);
    }
  }
}
