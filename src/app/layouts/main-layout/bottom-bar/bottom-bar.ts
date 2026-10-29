import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
export type BottomBarRole = 'cashier' | 'counter';
export interface BottomBarNotification {
  id: number;
  message: string;
  time?: string;
}
@Component({
  selector: 'app-bottom-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bottom-bar.html',
})
export class BottomBar implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) role!: BottomBarRole;
  @Input() notifications: BottomBarNotification[] = [];
  @Input() notificationLabel?: string;
  @Input() connected = true;
  @Output() notificationsClick = new EventEmitter<void>();
  currentDate = signal('');
  currentTime = signal('');
  notificationsPanelOpen = signal(false);
  notificationsExpanded = signal(false);
  /** Notifications that arrived since the person last clicked the bell. */
  unreadCount = signal(0);
  private clockInterval?: ReturnType<typeof setInterval>;
  private autoHideTimeout?: ReturnType<typeof setTimeout>;
  private lastSeenId = 0;
  private static readonly AUTO_HIDE_DELAY_MS = 5000;
  ngOnInit(): void {
    this.tick();
    this.clockInterval = setInterval(() => this.tick(), 1000);
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['notifications']) {
      const added = this.notifications.filter((n) => n.id > this.lastSeenId).length;
      if (added > 0 && !changes['notifications'].firstChange) {
        this.onNewNotifications(added);
      }
      this.lastSeenId = this.notifications[this.notifications.length - 1]?.id ?? 0;
    }
  }
  ngOnDestroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
    this.clearAutoHide();
  }
  private tick(): void {
    const now = new Date();
    this.currentDate.set(now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
    this.currentTime.set(
      now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    );
  }
  get roleLabel(): string {
    return this.role === 'cashier' ? 'Caisse' : 'Comptoir';
  }
  get resolvedNotificationLabel(): string {
    if (this.notificationLabel) return this.notificationLabel;
    return 'Notifications';
  }
  get displayNotificationCount(): string {
    const count = this.unreadCount();
    return count > 99 ? '99+' : String(count);
  }
  get latestNotification(): BottomBarNotification | undefined {
    return this.notifications[this.notifications.length - 1];
  }
  get reversedNotifications(): BottomBarNotification[] {
    return [...this.notifications].reverse();
  }
  onNotificationsClick(): void {
    if (this.notificationsPanelOpen() && this.notificationsExpanded()) {
      this.closeNotificationsPanel();
      return;
    }
    this.clearAutoHide();
    this.unreadCount.set(0);
    this.notificationsExpanded.set(true);
    this.notificationsPanelOpen.set(true);
    this.notificationsClick.emit();
  }
  closeNotificationsPanel(): void {
    this.clearAutoHide();
    this.notificationsPanelOpen.set(false);
    this.notificationsExpanded.set(false);
  }
  toggleNotificationsExpanded(): void {
    this.notificationsExpanded.update((expanded) => !expanded);
    if (this.notificationsExpanded()) {
      this.clearAutoHide();
    } else {
      this.scheduleAutoHide();
    }
  }
  private onNewNotifications(added: number): void {
    if (this.notificationsExpanded()) return;
    this.unreadCount.update((count) => count + added);
    this.notificationsPanelOpen.set(true);
    this.scheduleAutoHide();
  }
  private scheduleAutoHide(): void {
    this.clearAutoHide();
    this.autoHideTimeout = setTimeout(() => {
      if (!this.notificationsExpanded()) {
        this.notificationsPanelOpen.set(false);
      }
    }, BottomBar.AUTO_HIDE_DELAY_MS);
  }
  private clearAutoHide(): void {
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = undefined;
    }
  }
}
