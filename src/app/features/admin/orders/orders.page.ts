import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/error/error-messages';
import * as orderApi from '../../../data/order/order.api';
import { OrderStore } from '../../../data/order/order.store';
import { OrderGroup, OrderLine } from '../../../data/order/order.model';
import { buildGroups, formatGroupId, getGroupItemsSummary } from '../../../data/order/order.utils';
type StatusFilter = 'all' | OrderLine['status'];
type SortKey = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';
@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './orders.page.html',
  styleUrl: './orders.page.css',
})
export class OrdersPage {
  private readonly orderStore = inject(OrderStore);
  readonly wsConnected = this.orderStore.wsConnected;
  orderStatusMessage = signal('');
  orderStatusIsError = signal(false);
  private setOrderStatus(message: string, isError: boolean): void {
    this.orderStatusMessage.set(message);
    this.orderStatusIsError.set(isError);
  }
  markingPaidGroupId = signal<number | null>(null);
  async markGroupAsPaid(group: OrderGroup): Promise<void> {
    if (this.markingPaidGroupId() !== null) return;
    this.markingPaidGroupId.set(group.groupId);
    this.setOrderStatus('', false);
    try {
      await orderApi.markGroupPaid(group.groupId);
      await this.orderStore.resync();
      this.setOrderStatus(`Commande ${this.formatGroupId(group.groupId)} encaissée.`, false);
    } catch (e) {
      console.error('group_mark_paid failed', e);
      this.setOrderStatus(errorMessage(e, "Échec de l'encaissement de la commande. Réessayez."), true);
    } finally {
      this.markingPaidGroupId.set(null);
    }
  }
  readonly groups = computed<OrderGroup[]>(() => buildGroups(this.orderStore.orders()));
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
  readonly formatGroupId = formatGroupId;
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
  readonly getGroupItemsSummary = getGroupItemsSummary;
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
      await orderApi.rejectGroup(
        group.groupId,
        this.rejectReason().trim() ? this.rejectReason().trim() : null,
      );
      await this.orderStore.resync();
      this.confirmingRejectGroupId.set(null);
      this.setOrderStatus(`Commande ${this.formatGroupId(group.groupId)} refusée.`, false);
      document.getElementById(`order-toggle-btn-${group.groupId}`)?.focus();
    } catch (e) {
      console.error('reject_group failed', e);
      const message = errorMessage(e, 'Échec du refus de la commande. Réessayez.');
      this.rejectGroupError.set(message);
    } finally {
      this.rejectingGroup.set(false);
    }
  }
}
