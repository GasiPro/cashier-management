import { Component, OnInit, OnDestroy, HostListener, signal } from '@angular/core';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { DEFAULT_WS } from '../../core/config/app.constants';
import { errorMessage } from '../../core/error/error-messages';
import { SessionStore } from '../../core/auth/session.store';
import { WsClient } from '../../core/realtime/ws-client';
import {
  getStoredCashierWsUrl,
  getStoredUsername,
  setStoredCashierWsUrl,
  setStoredDisplayName,
  setStoredUsername,
} from '../../core/storage/local-storage';
import { getServerAddress } from '../../data/device/device.api';
import { credentialsRuleError } from '../../shared/utils/validators';
import { AdminModal } from './components/admin-modal/admin-modal';
import { CashierSetup } from './components/cashier-setup/cashier-setup';
import { CounterSetup } from './components/counter-setup/counter-setup';
import { CounterWaiting } from './components/counter-waiting/counter-waiting';
import { RolePicker } from './components/role-picker/role-picker';
type Step =
  | 'role'
  | 'cashier-setup'
  | 'counter-setup'
  | 'counter-waiting'
  | 'counter-rejected';
interface AuthAccount {
  user_type: string;
  display_name: string;
}
interface AuthResult<T> {
  success: boolean;
  account?: T | null;
  error?: string | null;
  session_token?: string | null;
}
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RolePicker, CashierSetup, CounterSetup, CounterWaiting, AdminModal],
  templateUrl: './login.page.html',
})
export class LoginPage implements OnInit, OnDestroy {
  step = signal<Step>('role');
  currentDateTime = '';
  // Cashier fields
  cashierUsername = signal('');
  cashierPassword = signal('');
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
  counterUsername = signal('');
  counterPassword = signal('');
  counterWsUrl = signal('');
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
    private ws: WsClient,
    private session: SessionStore,
  ) {}
  ngOnInit(): void {
    this.updateClock();
    this.clockInterval = setInterval(() => this.updateClock(), 60_000);
    this.cashierUsername.set(getStoredUsername() ?? '');
    this.counterUsername.set(getStoredUsername() ?? '');
    this.counterWsUrl.set(getStoredCashierWsUrl() ?? DEFAULT_WS);
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
  adminUsername = signal('');
  adminPassword = signal('');
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
    this.adminUsername.set('');
    this.adminPassword.set('');
    this.showAdminPassword.set(false);
    this.adminError.set('');
    this.showAdminModal.set(true);
  }
  closeAdminModal(): void {
    if (this.authenticatingAdmin()) return;
    this.showAdminModal.set(false);
    this.adminUsername.set('');
    this.adminPassword.set('');
    this.adminError.set('');
  }
  /** Verifies the credentials belong to an admin account before leaving the login screen. */
  async submitAdminLogin(): Promise<void> {
    if (this.authenticatingAdmin()) return;
    const username = this.adminUsername().trim();
    const password = this.adminPassword();
    if (!username || !password) {
      this.adminError.set('Identifiant et mot de passe requis.');
      return;
    }
    this.adminError.set('');
    this.authenticatingAdmin.set(true);
    try {
      const result = await invoke<AuthResult<AuthAccount>>('auth', {
        command: { method: 'admin', username, password },
      });
      if (!result.success || !result.account) {
        this.adminError.set(result.error ?? 'Identifiants invalides.');
        return;
      }
      if (result.account.user_type !== 'admin') {
        this.adminError.set('Ce compte n\'a pas les droits administrateur.');
        return;
      }
      setStoredUsername(username);
      setStoredDisplayName(result.account.display_name ?? '');
      if (result.session_token) {
        this.session.setSessionToken(result.session_token);
      }
      this.showAdminModal.set(false);
      this.router.navigate(['/admin']);
    } catch (e) {
      console.error('auth failed', e);
      const message = errorMessage(e, 'Identifiants invalides.');
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
    this.cashierPassword.set('');
    this.showCashierPassword.set(false);
    this.cashierError.set('');
    this.step.set('cashier-setup');
    this.loadCashierWsAddress();
  }
  selectCounter(): void {
    this.counterPassword.set('');
    this.showCounterPassword.set(false);
    this.counterError.set('');
    this.step.set('counter-setup');
  }
  private async loadCashierWsAddress(): Promise<void> {
    this.loadingWsAddress.set(true);
    try {
      const addr = await getServerAddress();
      this.wsAddress.set(addr);
    } catch {
      this.wsAddress.set(DEFAULT_WS);
    } finally {
      this.loadingWsAddress.set(false);
    }
  }
  async enterAsCashier(): Promise<void> {
    if (this.authenticatingCashier()) return;
    const username = this.cashierUsername().trim();
    const password = this.cashierPassword();
    const formError = credentialsRuleError(username, password);
    if (formError) {
      this.cashierError.set(formError);
      return;
    }
    this.cashierError.set('');
    this.authenticatingCashier.set(true);
    try {
      const result = await invoke<AuthResult<AuthAccount>>('auth', {
        command: { method: 'cashier', username, password },
      });
      if (!result.success || !result.account) {
        this.cashierError.set(result.error ?? 'Identifiants invalides.');
        return;
      }
      if (result.account.user_type !== 'caissier') {
        this.cashierError.set("Ce compte n'a pas accès à la caisse.");
        return;
      }
      setStoredUsername(username);
      setStoredDisplayName(result.account.display_name ?? '');
      if (result.session_token) {
        this.session.setSessionToken(result.session_token);
      }
      this.router.navigate(['/caissier']);
    } catch (e) {
      console.error('auth failed', e);
      const message = errorMessage(e, 'Échec de la connexion. Réessayez.');
      this.cashierError.set(message);
    } finally {
      this.authenticatingCashier.set(false);
    }
  }
  copyWsAddress(): void {
    navigator.clipboard.writeText(this.wsAddress()).catch(() => {});
  }
  onCounterWsUrlChanged(): void {
    this.addressCheck.set('idle');
  }
  async checkCounterWsUrl(): Promise<void> {
    const raw = this.counterWsUrl().trim();
    if (!raw) {
      this.addressCheck.set('idle');
      return;
    }
    this.addressCheck.set('checking');
    const fullUrl = raw.startsWith('ws://') ? raw : `ws://${raw}`;
    const reachable = await this.ws.checkAddress(fullUrl);
    if (this.counterWsUrl().trim() !== raw) return;
    this.addressCheck.set(reachable ? 'reachable' : 'unreachable');
  }
  connectAsCounter(): void {
    if (!this.counterUsername().trim() || !this.counterWsUrl().trim() || !this.counterPassword()) return;
    const username = this.counterUsername().trim();
    const password = this.counterPassword();
    const formError = credentialsRuleError(username, password);
    if (formError) {
      this.counterError.set(formError);
      return;
    }
    this.counterError.set('');
    this.step.set('counter-waiting');
    const wsUrl = this.counterWsUrl().trim();
    const fullUrl = wsUrl.startsWith('ws://') ? wsUrl : `ws://${wsUrl}`;
    this.session.setCounterCredentials(username, password);
    this.ws.connect(fullUrl);
    this.wsSubscription = this.ws.getMessages().subscribe((msg) => {
      if (msg.type === 'connection_approved') {
        setStoredUsername(username);
        setStoredCashierWsUrl(wsUrl);
        this.navigatingToCounter = true;
        this.wsSubscription?.unsubscribe();
        this.openSubscription?.unsubscribe();
        this.router.navigate(['/comptoir']);
      } else if (msg.type === 'connection_rejected') {
        this.wsSubscription?.unsubscribe();
        this.ws.disconnect();
        this.session.clearCounterCredentials();
        this.counterError.set("Nom d'utilisateur ou mot de passe incorrect, ou connexion refusée par la caisse.");
        this.counterPassword.set('');
        this.step.set('counter-rejected');
      } else if (msg.type === 'connection_blocked') {
        this.wsSubscription?.unsubscribe();
        this.ws.disconnect();
        this.session.clearCounterCredentials();
        this.counterError.set('Cet appareil ou ce nom d\'utilisateur est bloqué par la caisse.');
        this.counterPassword.set('');
        this.step.set('counter-rejected');
      } else if (msg.type === 'error_protocol') {
        this.wsSubscription?.unsubscribe();
        this.ws.disconnect();
        this.session.clearCounterCredentials();
        this.counterError.set(typeof msg.data === 'string' && msg.data.trim() ? msg.data : 'Erreur de protocole. Réessayez.');
        this.counterPassword.set('');
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
    this.cashierPassword.set('');
    this.cashierError.set('');
    this.counterPassword.set('');
    this.counterError.set('');
    this.step.set('role');
  }
}
