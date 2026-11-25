import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { WsClient } from '../../../core/realtime/ws-client';
import { TranslatePipe } from '../../pipes/translate.pipe';
const NOTICE_DELAY_MS = 6000;
const MAX_VISIBLE_LINES = 6;
@Component({
  imports: [TranslatePipe],
  selector: 'app-notice-splash',
  standalone: true,
  templateUrl: './notice-splash.html',
})
export class NoticeSplash implements OnInit, OnDestroy {
  readonly lines = signal<string[]>([]);
  readonly visibleLines = computed(() => this.lines().slice(0, MAX_VISIBLE_LINES));
  readonly hiddenCount = computed(() => Math.max(0, this.lines().length - MAX_VISIBLE_LINES));
  private subscription?: Subscription;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private ws: WsClient) {}
  ngOnInit(): void {
    this.subscription = this.ws.getMessages().subscribe((msg) => {
      if (msg.type === 'notice' && Array.isArray(msg.data)) this.show(msg.data);
    });
  }
  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
  }
  private show(incoming: string[]): void {
    const fresh = incoming.filter((line) => typeof line === 'string' && line.trim().length > 0);
    if (fresh.length === 0) return;
    this.lines.update((current) => [...new Set([...current, ...fresh])]);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lines.set([]);
    }, NOTICE_DELAY_MS);
  }
}
