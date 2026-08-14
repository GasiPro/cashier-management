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

/** Kept in sync with the bounds in src-tauri/src/config/accounts.rs. */
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
/** Password must contain at least one letter and one digit ("word + number"),
 *  mirroring the format check in `accounts::validate_password`. */
const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_DIGIT = /\d/;

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
  cashierPassword = '';
  wsAddress = signal('');

  /** Toggles the cashier password field between masked and plain text. */
  showCashierPassword = signal(false);
  /** True while a login attempt is in flight — disables the form to prevent a
   *  double submit on a slow round trip. */
  authenticatingCashier = signal(false);
  /** Inline validation or server error for the cashier login form, announced
   *  via aria-live. */
  cashierError = signal('');

  // Counter fields
  counterUsername = '';
  counterWsUrl = '';

  // State flags
  loadingWsAddress = signal(false);
  counterError = signal('');

  /** Result of probing counterWsUrl for a running server, shown as a hint/warning. */
  addressCheck = signal<'idle' | 'checking' | 'reachable' | 'unreachable'>('idle');

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
    this.cashierPassword = '';
    this.showCashierPassword.set(false);
    this.cashierError.set('');
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
      this.wsAddress.set(DEFAULT_WS);
    } finally {
      this.loadingWsAddress.set(false);
    }
  }

  // ── Cashier flow ───────────────────────────────────────────────────────────

  toggleCashierPasswordVisibility(): void {
    this.showCashierPassword.update((v) => !v);
  }

  /** Client-side check, mirroring the server-side validation in accounts.rs, so
   *  an obviously invalid entry gets immediate feedback instead of waiting on a
   *  round trip. The real authoritative check — including whether the account
   *  actually exists and the password matches — still happens server-side in
   *  `authenticate_cashier`. Returns a message, or '' if the form looks valid. */
  private validateCashierCredentials(username: string, password: string): string {
    if (username.length < MIN_USERNAME_LEN) {
      return `Le nom d'utilisateur doit contenir au moins ${MIN_USERNAME_LEN} caractères.`;
    }
    if (username.length > MAX_USERNAME_LEN) {
      return `Le nom d'utilisateur ne peut pas dépasser ${MAX_USERNAME_LEN} caractères.`;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LEN} caractères.`;
    }
    if (!PASSWORD_HAS_LETTER.test(password) || !PASSWORD_HAS_DIGIT.test(password)) {
      return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    }
    return '';
  }

  async enterAsCashier(): Promise<void> {
    if (this.authenticatingCashier()) return;

    const username = this.cashierUsername.trim();
    const password = this.cashierPassword;

    const formError = this.validateCashierCredentials(username, password);
    if (formError) {
      this.cashierError.set(formError);
      return;
    }
    this.cashierError.set('');

    this.authenticatingCashier.set(true);
    try {
      await invoke('authenticate_cashier', { username, password });
      localStorage.setItem(LS_USERNAME, username);
      this.router.navigate(['/caissier']);
    } catch (e) {
      console.error('authenticate_cashier failed', e);
      // Wrong username/password, account format, and suspended-account errors
      // all come back as plain strings from the Tauri command.
      const message = typeof e === 'string' ? e : 'Échec de la connexion. Réessayez.';
      this.cashierError.set(message);
    } finally {
      this.authenticatingCashier.set(false);
    }
  }

  copyWsAddress(): void {
    navigator.clipboard.writeText(this.wsAddress()).catch(() => {});
  }

  // ── Counter flow ───────────────────────────────────────────────────────────

  /** Resets the address check hint — called whenever the address field is edited. */
  onCounterWsUrlChanged(): void {
    this.addressCheck.set('idle');
  }

  /** Probes counterWsUrl for a running server and updates addressCheck accordingly. */
  async checkCounterWsUrl(): Promise<void> {
    const raw = this.counterWsUrl.trim();
    if (!raw) {
      this.addressCheck.set('idle');
      return;
    }
    this.addressCheck.set('checking');
    const fullUrl = raw.startsWith('ws://') ? raw : `ws://${raw}`;
    const reachable = await this.ws.checkAddress(fullUrl);
    // Ignore a stale result if the field changed while we were checking.
    if (this.counterWsUrl.trim() !== raw) return;
    this.addressCheck.set(reachable ? 'reachable' : 'unreachable');
  }

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
    this.addressCheck.set('idle');
  }

  goBack(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
    this.cashierPassword = '';
    this.cashierError.set('');
    this.step.set('role');
  }
}
