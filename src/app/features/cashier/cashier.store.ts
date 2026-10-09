import { Injectable, computed, signal } from '@angular/core';
import { PeerId } from '../../data/device/device.model';
import { OrderGroup } from '../../data/order/order.model';
import { OrderStore } from '../../data/order/order.store';
import { BottomBarNotification } from '../../layouts/main-layout/bottom-bar/bottom-bar';
import { formatIsoDate, formatRelativeDay } from '../../shared/utils/date';

export type CashierPanel = 'devices' | 'report' | 'history';

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

  openPanel = signal<CashierPanel | null>(null);

  notifications = signal<BottomBarNotification[]>([]);
  private notificationIdCounter = 0;

  busyDeviceId = signal<PeerId | null>(null);
  busyGroupId = signal<number | null>(null);
  confirmingBlockDeviceId = signal<PeerId | null>(null);

  /** Id of the order group currently shown in the full-detail modal, if any. */
  selectedGroupId = signal<number | null>(null);

  /** Group currently targeted by the reject confirmation dialog, if any. */
  rejectGroupTarget = signal<OrderGroup | null>(null);
  /** Optional reason ("raison") entered by the cashier for the pending cancellation. */
  rejectReason = signal('');

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

  /** Derived from the live pending/paid lists, so it stays in sync (or clears itself) when a push
   *  from the server changes or removes the underlying group. */
  selectedGroup = computed<OrderGroup | null>(() => {
    const id = this.selectedGroupId();
    if (id === null) return null;
    return (
      this.orders.pendingGroups().find((g) => g.groupId === id) ??
      this.orders.paidGroups().find((g) => g.groupId === id) ??
      null
    );
  });

  /** Distinct counter usernames present in the paid history, sorted alphabetically. */
  historiqueUsernames = computed(() => {
    const names = new Set(
      this.orders
        .paidGroups()
        .map((g) => g.counterUsername)
        .filter(Boolean),
    );
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  });

  /** Selected counter filter; falls back to "all" when that counter no longer has paid orders. */
  selectedHistoriqueUser = computed(() => {
    const user = this.historiqueUserChoice();
    return user === HISTORIQUE_ALL_COUNTERS || this.historiqueUsernames().includes(user)
      ? user
      : HISTORIQUE_ALL_COUNTERS;
  });

  /** Paid history filtered to the currently selected counter, if any. */
  filteredHistoriqueGroups = computed(() => {
    const user = this.selectedHistoriqueUser();
    const groups = this.orders.paidGroups();
    return user === HISTORIQUE_ALL_COUNTERS
      ? groups
      : groups.filter((g) => g.counterUsername === user);
  });

  /** Sum of the currently filtered history — the running total a cashier checks first. */
  historiqueTotalAmount = computed(() =>
    this.filteredHistoriqueGroups().reduce((sum, g) => sum + g.totalAmount, 0),
  );

  /**
   * Filtered history split into day buckets (most recent day first, groups within a day
   * already newest-first), each carrying its own count and subtotal for quick scanning.
   */
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

  requestBlockDevice(id: PeerId): void {
    this.confirmingBlockDeviceId.set(id);
  }

  cancelBlockDevice(): void {
    this.confirmingBlockDeviceId.set(null);
  }

  notify(msg: string): void {
    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    this.notifications.update((list) =>
      [...list, { id: ++this.notificationIdCounter, message: msg, time }].slice(-30),
    );
  }

  private isToday(iso: string): boolean {
    return formatIsoDate(new Date(iso)) === formatIsoDate(new Date());
  }
}
