import { Injectable, computed, signal } from '@angular/core';
import { NotifyLevel, playAlertSound } from '../../core/notification/notification';
import { PeerId } from '../../data/device/device.model';
import { OrderGroup } from '../../data/order/order.model';
import { OrderStore } from '../../data/order/order.store';
import { formatGroupId, getGroupItemsSummary } from '../../data/order/order.utils';
import { BottomBarNotification } from '../../layouts/main-layout/bottom-bar/bottom-bar';
import { formatIsoDate, formatRelativeDay } from '../../shared/utils/date';
export type CashierPanel = 'devices' | 'report' | 'history';
export type PaymentMethod = 'cash' | 'mobile_money';
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  mobile_money: 'Mobile money',
};
export interface HistoriqueDayGroup {
  dayLabel: string;
  groups: OrderGroup[];
  count: number;
  totalAmount: number;
}
const HISTORIQUE_ALL_COUNTERS = 'Tous';
@Injectable()
export class CashierStore {
  readonly historiqueAllCounters = HISTORIQUE_ALL_COUNTERS;
  readonly pendingAllCounters = HISTORIQUE_ALL_COUNTERS;
  openPanel = signal<CashierPanel | null>(null);
  notifications = signal<BottomBarNotification[]>([]);
  private notificationIdCounter = 0;
  busyDeviceId = signal<PeerId | null>(null);
  busyGroupId = signal<number | null>(null);
  confirmingBlockDeviceId = signal<PeerId | null>(null);
  selectedGroupId = signal<number | null>(null);
  rejectGroupTarget = signal<OrderGroup | null>(null);
  rejectReason = signal('');
  payGroupId = signal<number | null>(null);
  paymentMethod = signal<PaymentMethod>('cash');
  pendingSearch = signal('');
  private pendingCounterChoice = signal<string>(HISTORIQUE_ALL_COUNTERS);
  private historiqueUserChoice = signal<string>(HISTORIQUE_ALL_COUNTERS);
  constructor(private orders: OrderStore) {}
  recentPaidGroups = computed(() => this.orders.paidGroups().slice(0, 5));
  /** Encaissements du jour uniquement — utilisé pour les compteurs de la barre de navigation. */
  todaysPaidGroups = computed(() =>
    this.orders.paidGroups().filter((g) => g.paidAt && this.isToday(g.paidAt)),
  );
  /** Total encaissé aujourd'hui uniquement — utilisé pour les compteurs de la barre de navigation. */
  todaysRevenue = computed(() =>
    this.todaysPaidGroups().reduce((sum, g) => sum + g.totalAmount, 0),
  );
  selectedGroup = computed<OrderGroup | null>(() => {
    const id = this.selectedGroupId();
    if (id === null) return null;
    return (
      this.orders.pendingGroups().find((g) => g.groupId === id) ??
      this.orders.paidGroups().find((g) => g.groupId === id) ??
      null
    );
  });
  payGroupTarget = computed<OrderGroup | null>(() => {
    const id = this.payGroupId();
    if (id === null) return null;
    return this.orders.pendingGroups().find((g) => g.groupId === id) ?? null;
  });
  pendingCounters = computed(() => {
    const names = new Set(
      this.orders
        .pendingGroups()
        .map((g) => g.counterUsername)
        .filter(Boolean),
    );
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  });
  selectedPendingCounter = computed(() => {
    const counter = this.pendingCounterChoice();
    return counter === HISTORIQUE_ALL_COUNTERS || this.pendingCounters().includes(counter)
      ? counter
      : HISTORIQUE_ALL_COUNTERS;
  });
  filteredPendingGroups = computed(() => {
    const counter = this.selectedPendingCounter();
    const query = this.pendingSearch().trim().toLowerCase().replace(/^#/, '');
    return this.orders.pendingGroups().filter((g) => {
      if (counter !== HISTORIQUE_ALL_COUNTERS && g.counterUsername !== counter) return false;
      if (!query) return true;
      return [formatGroupId(g.groupId), g.counterUsername, getGroupItemsSummary(g)].some((text) =>
        text.toLowerCase().includes(query),
      );
    });
  });
  pendingTotalAmount = computed(() =>
    this.filteredPendingGroups().reduce((sum, g) => sum + g.totalAmount, 0),
  );
  historiqueUsernames = computed(() => {
    const names = new Set(
      this.orders
        .paidGroups()
        .map((g) => g.counterUsername)
        .filter(Boolean),
    );
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  });
  selectedHistoriqueUser = computed(() => {
    const user = this.historiqueUserChoice();
    return user === HISTORIQUE_ALL_COUNTERS || this.historiqueUsernames().includes(user)
      ? user
      : HISTORIQUE_ALL_COUNTERS;
  });
  filteredHistoriqueGroups = computed(() => {
    const user = this.selectedHistoriqueUser();
    const groups = this.orders.paidGroups();
    return user === HISTORIQUE_ALL_COUNTERS
      ? groups
      : groups.filter((g) => g.counterUsername === user);
  });
  historiqueTotalAmount = computed(() =>
    this.filteredHistoriqueGroups().reduce((sum, g) => sum + g.totalAmount, 0),
  );
  historiqueGroupsByDay = computed<HistoriqueDayGroup[]>(() => {
    const days: HistoriqueDayGroup[] = [];
    const byLabel = new Map<string, HistoriqueDayGroup>();
    for (const group of this.filteredHistoriqueGroups()) {
      const dayLabel = group.paidAt ? formatRelativeDay(group.paidAt) : 'Date inconnue';
      let bucket = byLabel.get(dayLabel);
      if (!bucket) {
        bucket = { dayLabel, groups: [], count: 0, totalAmount: 0 };
        byLabel.set(dayLabel, bucket);
        days.push(bucket);
      }
      bucket.groups.push(group);
      bucket.count += 1;
      bucket.totalAmount += group.totalAmount;
    }
    return days;
  });
  closePanel(): void {
    this.openPanel.set(null);
  }
  setPendingCounterFilter(username: string): void {
    this.pendingCounterChoice.set(username);
  }
  setHistoriqueUserFilter(username: string): void {
    this.historiqueUserChoice.set(username);
  }
  openGroupDetail(g: OrderGroup): void {
    this.selectedGroupId.set(g.groupId);
  }
  closeGroupDetail(): void {
    this.selectedGroupId.set(null);
  }
  openRejectDialog(group: OrderGroup): void {
    this.rejectReason.set('');
    this.rejectGroupTarget.set(group);
    this.selectedGroupId.set(null);
  }
  closeRejectDialog(): void {
    this.rejectGroupTarget.set(null);
    this.rejectReason.set('');
  }
  openPaymentDialog(groupId: number): void {
    this.paymentMethod.set('cash');
    this.payGroupId.set(groupId);
    this.selectedGroupId.set(null);
  }
  closePaymentDialog(): void {
    this.payGroupId.set(null);
  }
  backToGroupDetail(): void {
    this.selectedGroupId.set(this.payGroupId());
    this.payGroupId.set(null);
  }
  requestBlockDevice(id: PeerId): void {
    this.confirmingBlockDeviceId.set(id);
  }
  cancelBlockDevice(): void {
    this.confirmingBlockDeviceId.set(null);
  }
  notify(msg: string, level: NotifyLevel = 'quiet'): void {
    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    this.notifications.update((list) =>
      [...list, { id: ++this.notificationIdCounter, message: msg, time, alert: level !== 'quiet' }].slice(-30),
    );
    if (level === 'sound') playAlertSound();
  }
  private isToday(iso: string): boolean {
    return formatIsoDate(new Date(iso)) === formatIsoDate(new Date());
  }
}
