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
  hasNewNotifications = signal(false);
  private clockInterval?: ReturnType<typeof setInterval>;
  private autoHideTimeout?: ReturnType<typeof setTimeout>;
  private previousNotificationsLength = 0;
  private static readonly AUTO_HIDE_DELAY_MS = 5000;
  ngOnInit(): void {
    this.tick();
    this.clockInterval = setInterval(() => this.tick(), 1000);
    this.previousNotificationsLength = this.notifications.length;
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['notifications'] && !changes['notifications'].firstChange) {
      if (this.notifications.length > this.previousNotificationsLength) {
        this.hasNewNotifications.set(true);
        this.showLatestNotification();
      }
    }
    this.previousNotificationsLength = this.notifications.length;
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
    const count = this.notifications.length;
    return count > 99 ? '99+' : String(count);
  }
  get latestNotification(): BottomBarNotification | undefined {
    return this.notifications[this.notifications.length - 1];
  }
  get reversedNotifications(): BottomBarNotification[] {
    return [...this.notifications].reverse();
  }
  onNotificationsClick(): void {
    this.clearAutoHide();
    this.hasNewNotifications.set(false);
    this.notificationsPanelOpen.update((open) => !open);
    if (!this.notificationsPanelOpen()) {
      this.notificationsExpanded.set(false);
    }
    this.notificationsClick.emit();
  }
  closeNotificationsPanel(): void {
    this.clearAutoHide();
    this.hasNewNotifications.set(false);
    this.notificationsPanelOpen.set(false);
    this.notificationsExpanded.set(false);
  }
  toggleNotificationsExpanded(): void {
    this.clearAutoHide();
    this.notificationsExpanded.update((expanded) => !expanded);
  }
  private showLatestNotification(): void {
    this.notificationsPanelOpen.set(true);
    if (!this.notificationsExpanded()) {
      this.scheduleAutoHide();
    }
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
