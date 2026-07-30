// src/app/presentation/vews/login/login.ts
import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { WebsocketService } from '../../../core/service/websocket.service';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';

type Step =
  | 'role'
  | 'cashier-setup'
  | 'counter-setup'
  | 'counter-waiting'
  | 'counter-rejected';

const LS_USERNAME = 'gasipro:username';
const LS_CASHIER_URL = 'gasipro:cashierWsUrl';
const DEFAULT_WS = '127.0.0.1:8080';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
})
export class LoginComponent implements OnInit, OnDestroy {
  step = signal<Step>('role');
  currentDateTime = '';

  // Cashier fields
  cashierUsername = '';
  wsAddress = signal('');

  // Counter fields
  counterUsername = '';
  counterWsUrl = '';

  // State flags
  loadingWsAddress = signal(false);
  counterError = signal('');

  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  private navigatingToCounter = false;

  constructor(
    private router: Router,
    private ws: WebsocketService,
  ) {}

  ngOnInit(): void {
    this.updateClock();
    this.clockInterval = setInterval(() => this.updateClock(), 60_000);

    // Pre-fill from previous session
    this.cashierUsername = localStorage.getItem(LS_USERNAME) ?? '';
    this.counterUsername = localStorage.getItem(LS_USERNAME) ?? '';
    this.counterWsUrl = localStorage.getItem(LS_CASHIER_URL) ?? DEFAULT_WS;
  }

  ngOnDestroy(): void {
    if (this.clockInterval) clearInterval(this.clockInterval);
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    // Only disconnect WS if we're NOT handing it off to the counter view.
    if (!this.navigatingToCounter) {
      this.ws.disconnect();
    }
  }

  private updateClock(): void {
    const now = new Date();
    this.currentDateTime =
      now.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }) +
      ' · ' +
      now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Role selection ─────────────────────────────────────────────────────────

  selectCashier(): void {
    this.step.set('cashier-setup');
    this.loadCashierWsAddress();
  }

  selectCounter(): void {
    this.step.set('counter-setup');
  }

  private async loadCashierWsAddress(): Promise<void> {
    this.loadingWsAddress.set(true);
    try {
      const addr = await invoke<string>('get_ws_address');
      this.wsAddress.set(addr);
    } catch {
      this.wsAddress.set('ws://127.0.0.1:8080');
    } finally {
      this.loadingWsAddress.set(false);
    }
  }

  // ── Cashier flow ───────────────────────────────────────────────────────────

  enterAsCashier(): void {
    if (!this.cashierUsername.trim()) return;
    const username = this.cashierUsername.trim();
    localStorage.setItem(LS_USERNAME, username);
    this.router.navigate(['/caissier']);
  }

  copyWsAddress(): void {
    navigator.clipboard.writeText(this.wsAddress()).catch(() => {});
  }

  // ── Counter flow ───────────────────────────────────────────────────────────

  connectAsCounter(): void {
    if (!this.counterUsername.trim() || !this.counterWsUrl.trim()) return;

    this.counterError.set('');
    this.step.set('counter-waiting');

    const username = this.counterUsername.trim();
    const wsUrl = this.counterWsUrl.trim();
    const fullUrl = wsUrl.startsWith('ws://') ? wsUrl : `ws://${wsUrl}`;

    // Connect to cashier WS
    this.ws.connect(fullUrl);

    // Subscribe to messages FIRST so we don't miss the approval message
    this.wsSubscription = this.ws.getMessages().subscribe((msg) => {
      if (msg.type === 'connection_approved') {
        localStorage.setItem(LS_USERNAME, username);
        localStorage.setItem(LS_CASHIER_URL, wsUrl);
        this.navigatingToCounter = true;
        this.wsSubscription?.unsubscribe();
        this.openSubscription?.unsubscribe();
        this.router.navigate(['/comptoir']);
      } else if (msg.type === 'connection_rejected') {
        this.wsSubscription?.unsubscribe();
        this.ws.disconnect();
        this.step.set('counter-rejected');
      }
    });

    // Send request_connection once the socket opens
    const sendRequest = () => {
      this.ws.send({ type: 'request_connection', username });
    };

    if (this.ws.isOpen()) {
      // Already open (reconnect scenario)
      sendRequest();
    } else {
      this.openSubscription = this.ws.onOpened().pipe(take(1)).subscribe(() => {
        sendRequest();
      });
    }
  }

  retryConnection(): void {
    this.step.set('counter-setup');
    this.counterError.set('');
  }

  goBack(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
    this.step.set('role');
  }
}
