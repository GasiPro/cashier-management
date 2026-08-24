import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export type BottomBarRole = 'cashier' | 'counter';

@Component({
  selector: 'app-bottom-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bottom-bar.html',
})
export class BottomBar implements OnInit, OnDestroy {
  /** Which view hosts the bar — drives the notification button's default label. */
  @Input({ required: true }) role!: BottomBarRole;
  /** Number of unread notifications to badge on the bell. Meaning is defined by the caller (pending requests, alerts, …). */
  @Input() notificationCount = 0;
  /** Optional override for the notification button's accessible/tooltip label. */
  @Input() notificationLabel?: string;
  /** Whether the underlying connection is currently up — tints the status dot next to the bell. */
  @Input() connected = true;
  @Output() notificationsClick = new EventEmitter<void>();

  currentDate = signal('');
  currentTime = signal('');

  private clockInterval?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.tick();
    this.clockInterval = setInterval(() => this.tick(), 1000);
  }

  ngOnDestroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
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
    return this.role === 'cashier' ? 'Notifications de la caisse' : 'Notifications du comptoir';
  }

  get displayNotificationCount(): string {
    return this.notificationCount > 99 ? '99+' : String(this.notificationCount);
  }

  onNotificationsClick(): void {
    this.notificationsClick.emit();
  }
}
