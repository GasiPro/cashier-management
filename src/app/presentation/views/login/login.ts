import { Component, OnInit, OnDestroy, HostListener, signal } from '@angular/core';
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
const LS_DISPLAY_NAME = 'gasipro:displayName';
const LS_CASHIER_URL = 'gasipro:cashierWsUrl';
const DEFAULT_WS = '127.0.0.1:8080';
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_DIGIT = /\d/;
interface AuthResult<T> {
  success: boolean;
  account: T | null;
  error: string | null;
}
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
  counterPassword = '';
  counterWsUrl = '';
  /** Toggles the counter password field between masked and plain text. */
  showCounterPassword = signal(false);
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
  showAdminModal = signal(false);
  adminUsername = '';
  adminPassword = '';
  showAdminPassword = signal(false);
  authenticatingAdmin = signal(false);
  adminError = signal('');
  /** Ctrl+Alt+A on the login screen reveals a hidden admin login popup. */
  @HostListener('document:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.openAdminModal();
    }
  }
  openAdminModal(): void {
    if (this.showAdminModal()) return;
    this.adminUsername = '';
    this.adminPassword = '';
    this.showAdminPassword.set(false);
    this.adminError.set('');
    this.showAdminModal.set(true);
  }
  closeAdminModal(): void {
    if (this.authenticatingAdmin()) return;
    this.showAdminModal.set(false);
    this.adminUsername = '';
    this.adminPassword = '';
    this.adminError.set('');
  }
  toggleAdminPasswordVisibility(): void {
    this.showAdminPassword.update((v) => !v);
  }
  /** Verifies the credentials belong to an admin account before leaving the login screen. */
  async submitAdminLogin(): Promise<void> {
    if (this.authenticatingAdmin()) return;
    const username = this.adminUsername.trim();
    const password = this.adminPassword;
    if (!username || !password) {
      this.adminError.set('Identifiant et mot de passe requis.');
      return;
    }
    this.adminError.set('');
    this.authenticatingAdmin.set(true);
    try {
      const result = await invoke<AuthResult<{ user_type: string; display_name: string }>>(
        'authenticate_admin',
        { username, password },
      );
      if (!result.success || !result.account) {
        this.adminError.set(result.error ?? 'Identifiants invalides.');
        return;
      }
      if (result.account.user_type !== 'admin') {
        this.adminError.set('Ce compte n\'a pas les droits administrateur.');
        return;
      }
      localStorage.setItem(LS_USERNAME, username);
      localStorage.setItem(LS_DISPLAY_NAME, result.account.display_name ?? '');
      this.showAdminModal.set(false);
      this.router.navigate(['/admin']);
    } catch (e) {
      console.error('authenticate_admin failed', e);
      const message = typeof e === 'string' ? e : 'Identifiants invalides.';
      this.adminError.set(message);
    } finally {
      this.authenticatingAdmin.set(false);
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
  selectCashier(): void {
    this.cashierPassword = '';
    this.showCashierPassword.set(false);
    this.cashierError.set('');
    this.step.set('cashier-setup');
    this.loadCashierWsAddress();
  }
  selectCounter(): void {
    this.counterPassword = '';
    this.showCounterPassword.set(false);
    this.counterError.set('');
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
  toggleCashierPasswordVisibility(): void {
    this.showCashierPassword.update((v) => !v);
  }
  private validateCredentials(username: string, password: string): string {
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
    const formError = this.validateCredentials(username, password);
    if (formError) {
      this.cashierError.set(formError);
      return;
    }
    this.cashierError.set('');
    this.authenticatingCashier.set(true);
    try {
      const account = await invoke<{ display_name: string }>('authenticate_cashier', { username, password });
      localStorage.setItem(LS_USERNAME, username);
      localStorage.setItem(LS_DISPLAY_NAME, account.display_name ?? '');
      this.router.navigate(['/caissier']);
    } catch (e) {
      console.error('authenticate_cashier failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la connexion. Réessayez.';
      this.cashierError.set(message);
    } finally {
      this.authenticatingCashier.set(false);
    }
  }
  copyWsAddress(): void {
    navigator.clipboard.writeText(this.wsAddress()).catch(() => {});
  }
  toggleCounterPasswordVisibility(): void {
    this.showCounterPassword.update((v) => !v);
  }
  onCounterWsUrlChanged(): void {
    this.addressCheck.set('idle');
  }
  async checkCounterWsUrl(): Promise<void> {
    const raw = this.counterWsUrl.trim();
    if (!raw) {
      this.addressCheck.set('idle');
      return;
    }
    this.addressCheck.set('checking');
    const fullUrl = raw.startsWith('ws://') ? raw : `ws://${raw}`;
    const reachable = await this.ws.checkAddress(fullUrl);
    if (this.counterWsUrl.trim() !== raw) return;
    this.addressCheck.set(reachable ? 'reachable' : 'unreachable');
  }
  connectAsCounter(): void {
    if (!this.counterUsername.trim() || !this.counterWsUrl.trim() || !this.counterPassword) return;
    const username = this.counterUsername.trim();
    const password = this.counterPassword;
    const formError = this.validateCredentials(username, password);
    if (formError) {
      this.counterError.set(formError);
      return;
    }
    this.counterError.set('');
    this.step.set('counter-waiting');
    const wsUrl = this.counterWsUrl.trim();
    const fullUrl = wsUrl.startsWith('ws://') ? wsUrl : `ws://${wsUrl}`;
    this.ws.setCounterCredentials(username, password);
    this.ws.connect(fullUrl);
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
        this.ws.clearCounterCredentials();
        this.counterError.set("Nom d'utilisateur ou mot de passe incorrect, ou connexion refusée par la caisse.");
        this.counterPassword = '';
        this.step.set('counter-rejected');
      }
    });
    const sendRequest = () => {
      this.ws.send({ type: 'request_connection', username, password });
    };
    if (this.ws.isOpen()) {
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
    this.counterPassword = '';
    this.counterError.set('');
    this.step.set('role');
  }
}