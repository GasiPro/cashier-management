import { Component, ElementRef, OnInit, OnDestroy, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { Navbar } from '../../shared/navbar/navbar';
import { LeftSidebar } from '../../shared/sidebar/left-sidebar/left-sidebar';
import { BottomBar } from '../../shared/bottom-bar/bottom-bar';
const MAX_ALLOWED_CONNECTED_DEVICES = 50;
const CONNECTED_DEVICES_POLL_MS = 5000;
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
const MAX_DISPLAY_NAME_LEN = 40;
const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_DIGIT = /\d/;
const LS_USERNAME = 'gasipro:username';
const LS_DISPLAY_NAME = 'gasipro:displayName';
type AccountStatus = 'active' | 'suspended';
interface CashierAccountView {
  username: string;
  display_name: string;
  created_at: string;
  status: AccountStatus;
}
@Component({
  selector: 'app-setting',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar, LeftSidebar, BottomBar],
  templateUrl: './setting.html',
  styleUrl: './setting.css',
})
export class Setting implements OnInit, OnDestroy {
  readonly maxAllowedConnectedDevices = MAX_ALLOWED_CONNECTED_DEVICES;
  readonly minUsernameLen = MIN_USERNAME_LEN;
  readonly maxUsernameLen = MAX_USERNAME_LEN;
  readonly minPasswordLen = MIN_PASSWORD_LEN;
  readonly maxDisplayNameLen = MAX_DISPLAY_NAME_LEN;
  @ViewChild('newAccountUsernameInput') private newAccountUsernameInput?: ElementRef<HTMLInputElement>;
  username = localStorage.getItem(LS_USERNAME) ?? 'Caisse';
  private displayName = localStorage.getItem(LS_DISPLAY_NAME) ?? '';
  /** Name shown in the navbar — the account display name when one exists, otherwise the username. */
  get displayLabel(): string {
    return this.displayName.trim() ? this.displayName : this.username;
  }
  currentTime = signal('');
  private clockInterval?: ReturnType<typeof setInterval>;
  maxConnectedDevices = signal(0);
  maxConnectedDevicesDraft = signal(0);
  connectedDevicesCount = signal(0);
  loadingDevicesSetting = signal(true);
  savingDevicesSetting = signal(false);
  devicesSettingDirty = computed(() => this.maxConnectedDevicesDraft() !== this.maxConnectedDevices());
  atDevicesCapacity = computed(
    () => this.maxConnectedDevices() > 0 && this.connectedDevicesCount() >= this.maxConnectedDevices(),
  );
  statusMessage = signal('');
  statusIsError = signal(false);
  // ── Cashier accounts ──────────────────────────────────────────────────────
  accounts = signal<CashierAccountView[]>([]);
  loadingAccounts = signal(true);
  newAccountUsername = signal('');
  newAccountPassword = signal('');
  newAccountPasswordConfirm = signal('');
  /** Toggles the password/confirm fields between masked and plain text. */
  showAccountPassword = signal(false);
  creatingAccount = signal(false);
  /** Inline validation error for the account form, announced via aria-live. */
  accountFormError = signal('');
  /** Result feedback (success or server error) for the account form, announced via aria-live. */
  accountStatusMessage = signal('');
  accountStatusIsError = signal(false);
  private readonly trimmedNewAccountUsername = computed(() => this.newAccountUsername().trim());
  /** Client-side shape check only — the server is still the source of truth for
   *  uniqueness, so the button stays enabled even if this passes; the real
   *  rejection (if any) comes back from `create_cashier_account`. */
  canSubmitAccount = computed(() => {
    const username = this.trimmedNewAccountUsername();
    const password = this.newAccountPassword();
    const confirm = this.newAccountPasswordConfirm();
    return (
      username.length >= this.minUsernameLen &&
      username.length <= this.maxUsernameLen &&
      password.length >= this.minPasswordLen &&
      PASSWORD_HAS_LETTER.test(password) &&
      PASSWORD_HAS_DIGIT.test(password) &&
      password === confirm &&
      !this.creatingAccount()
    );
  });
  private connectedDevicesPollId: ReturnType<typeof setInterval> | null = null;
  constructor(private router: Router) {}
  ngOnInit(): void {
    this.loadDevicesSetting();
    this.loadAccounts();
    this.tick();
    this.clockInterval = setInterval(() => this.tick(), 1000);
    // Keep the "currently connected" count fresh while this page is open — it can
    // change from elsewhere (a comptoir connecting/dropping) at any time.
    this.connectedDevicesPollId = setInterval(() => this.refreshConnectedDevicesCount(), CONNECTED_DEVICES_POLL_MS);
  }
  ngOnDestroy(): void {
    if (this.connectedDevicesPollId !== null) {
      clearInterval(this.connectedDevicesPollId);
      this.connectedDevicesPollId = null;
    }
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
  }
  private tick(): void {
    const now = new Date();
    this.currentTime.set(
      now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    );
  }
  /** Re-fetches just the connected-devices count (not the configured limit, which this
   *  page itself owns) — used by the background poll started in `ngOnInit`. Silently
   *  ignored on failure so a transient IPC hiccup doesn't spam the status region. */
  private async refreshConnectedDevicesCount(): Promise<void> {
    try {
      const connected = await invoke<number>('get_connected_devices_count');
      this.connectedDevicesCount.set(connected);
    } catch (e) {
      console.error('failed to refresh connected devices count', e);
    }
  }
  private async loadDevicesSetting(): Promise<void> {
    this.loadingDevicesSetting.set(true);
    try {
      const [max, connected] = await Promise.all([
        invoke<number>('get_max_connected_devices'),
        invoke<number>('get_connected_devices_count'),
      ]);
      this.maxConnectedDevices.set(max);
      this.maxConnectedDevicesDraft.set(max);
      this.connectedDevicesCount.set(connected);
    } catch (e) {
      console.error('failed to load device settings', e);
      this.setStatus('Impossible de charger les réglages des appareils.', true);
    } finally {
      this.loadingDevicesSetting.set(false);
    }
  }
  decrementMaxConnectedDevices(): void {
    this.maxConnectedDevicesDraft.update((v) => Math.max(0, v - 1));
  }
  incrementMaxConnectedDevices(): void {
    this.maxConnectedDevicesDraft.update((v) => Math.min(this.maxAllowedConnectedDevices, v + 1));
  }
  onMaxConnectedDevicesInput(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(this.maxAllowedConnectedDevices, Math.max(0, Math.round(parsed)));
    this.maxConnectedDevicesDraft.set(clamped);
  }
  resetMaxConnectedDevicesDraft(): void {
    this.maxConnectedDevicesDraft.set(this.maxConnectedDevices());
    this.setStatus('', false);
  }
  async saveMaxConnectedDevices(): Promise<void> {
    if (!this.devicesSettingDirty() || this.savingDevicesSetting()) return;
    this.savingDevicesSetting.set(true);
    this.setStatus('', false);
    try {
      const applied = await invoke<number>('set_max_connected_devices', {
        value: this.maxConnectedDevicesDraft(),
      });
      this.maxConnectedDevices.set(applied);
      this.maxConnectedDevicesDraft.set(applied);
      this.setStatus(
        applied === 0
          ? "Nombre d'appareils illimité enregistré."
          : `Limite enregistrée : ${applied} appareil${applied > 1 ? 's' : ''} maximum.`,
        false,
      );
    } catch (e) {
      console.error('set_max_connected_devices failed', e);
      this.setStatus("Échec de l'enregistrement. Réessayez.", true);
    } finally {
      this.savingDevicesSetting.set(false);
    }
  }
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }
  private async loadAccounts(): Promise<void> {
    this.loadingAccounts.set(true);
    try {
      const accounts = await invoke<CashierAccountView[]>('list_cashier_accounts');
      this.accounts.set(accounts);
    } catch (e) {
      console.error('failed to load cashier accounts', e);
      this.setAccountStatus('Impossible de charger la liste des comptes caissier.', true);
    } finally {
      this.loadingAccounts.set(false);
    }
  }
  toggleAccountPasswordVisibility(): void {
    this.showAccountPassword.update((v) => !v);
  }
  private validateAccountForm(): string {
    const username = this.trimmedNewAccountUsername();
    if (username.length < this.minUsernameLen) {
      return `Le nom d'utilisateur doit contenir au moins ${this.minUsernameLen} caractères.`;
    }
    if (username.length > this.maxUsernameLen) {
      return `Le nom d'utilisateur ne peut pas dépasser ${this.maxUsernameLen} caractères.`;
    }
    if (this.accounts().some((a) => a.username.toLowerCase() === username.toLowerCase())) {
      return 'Ce nom d\'utilisateur est déjà utilisé.';
    }
    if (this.newAccountPassword().length < this.minPasswordLen) {
      return `Le mot de passe doit contenir au moins ${this.minPasswordLen} caractères.`;
    }
    if (!PASSWORD_HAS_LETTER.test(this.newAccountPassword()) || !PASSWORD_HAS_DIGIT.test(this.newAccountPassword())) {
      return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    }
    if (this.newAccountPassword() !== this.newAccountPasswordConfirm()) {
      return 'Les mots de passe ne correspondent pas.';
    }
    return '';
  }
  async createAccount(): Promise<void> {
    if (this.creatingAccount()) return;
    const formError = this.validateAccountForm();
    if (formError) {
      this.accountFormError.set(formError);
      this.setAccountStatus('', false);
      return;
    }
    this.accountFormError.set('');
    this.creatingAccount.set(true);
    this.setAccountStatus('', false);
    try {
      const created = await invoke<CashierAccountView>('create_cashier_account', {
        username: this.trimmedNewAccountUsername(),
        password: this.newAccountPassword(),
      });
      this.accounts.update((list) => [created, ...list]);
      this.setAccountStatus(`Compte « ${created.username} » créé.`, false);
      this.resetAccountForm();
      this.newAccountUsernameInput?.nativeElement.focus();
    } catch (e) {
      console.error('create_cashier_account failed', e);
      const message = typeof e === 'string' ? e : "Échec de la création du compte. Réessayez.";
      this.setAccountStatus(message, true);
    } finally {
      this.creatingAccount.set(false);
    }
  }
  private resetAccountForm(): void {
    this.newAccountUsername.set('');
    this.newAccountPassword.set('');
    this.newAccountPasswordConfirm.set('');
    this.showAccountPassword.set(false);
  }
  /** Formats an ISO/RFC3339 timestamp for display; falls back to the raw value if parsing fails. */
  formatAccountDate(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  private setAccountStatus(message: string, isError: boolean): void {
    this.accountStatusMessage.set(message);
    this.accountStatusIsError.set(isError);
  }
  editingUsername = signal<string | null>(null);
  editDisplayName = signal('');
  editPassword = signal('');
  editPasswordConfirm = signal('');
  /** Toggles the edit password/confirm fields between masked and plain text. */
  showEditPassword = signal(false);
  savingEditAccount = signal(false);
  /** Inline validation or server error for the edit form, announced via aria-live. */
  editAccountError = signal('');
  /** An empty new-password pair is valid — it means "leave the password unchanged". */
  canSubmitEditAccount = computed(() => {
    if (this.savingEditAccount()) return false;
    if (this.editDisplayName().trim().length > this.maxDisplayNameLen) return false;
    const password = this.editPassword();
    const confirm = this.editPasswordConfirm();
    if (password.length === 0 && confirm.length === 0) return true;
    return (
      password.length >= this.minPasswordLen &&
      PASSWORD_HAS_LETTER.test(password) &&
      PASSWORD_HAS_DIGIT.test(password) &&
      password === confirm
    );
  });
  startEditAccount(account: CashierAccountView): void {
    this.confirmingDeleteUsername.set(null);
    this.editingUsername.set(account.username);
    this.editDisplayName.set(account.display_name);
    this.editPassword.set('');
    this.editPasswordConfirm.set('');
    this.showEditPassword.set(false);
    this.editAccountError.set('');
    // Move focus into the panel once it's rendered, so keyboard/screen-reader
    setTimeout(() => {
      document.getElementById(`edit-display-name-${account.username}`)?.focus();
    });
  }
  cancelEditAccount(): void {
    const username = this.editingUsername();
    this.editingUsername.set(null);
    if (username) {
      document.getElementById(`account-edit-btn-${username}`)?.focus();
    }
  }
  toggleEditPasswordVisibility(): void {
    this.showEditPassword.update((v) => !v);
  }
  private validateEditAccountForm(): string {
    if (this.editDisplayName().trim().length > this.maxDisplayNameLen) {
      return `Le nom affiché ne peut pas dépasser ${this.maxDisplayNameLen} caractères.`;
    }
    const password = this.editPassword();
    const confirm = this.editPasswordConfirm();
    if (password.length > 0 || confirm.length > 0) {
      if (password.length < this.minPasswordLen) {
        return `Le mot de passe doit contenir au moins ${this.minPasswordLen} caractères.`;
      }
      if (!PASSWORD_HAS_LETTER.test(password) || !PASSWORD_HAS_DIGIT.test(password)) {
        return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
      }
      if (password !== confirm) {
        return 'Les mots de passe ne correspondent pas.';
      }
    }
    return '';
  }
  async saveEditAccount(): Promise<void> {
    const username = this.editingUsername();
    if (!username || this.savingEditAccount()) return;
    const formError = this.validateEditAccountForm();
    if (formError) {
      this.editAccountError.set(formError);
      return;
    }
    this.editAccountError.set('');
    this.savingEditAccount.set(true);
    try {
      const displayName = this.editDisplayName().trim();
      const password = this.editPassword().length > 0 ? this.editPassword() : null;
      const updated = await invoke<CashierAccountView>('update_cashier_account', {
        username,
        displayName,
        password,
      });
      this.accounts.update((list) => list.map((a) => (a.username === updated.username ? updated : a)));
      this.editingUsername.set(null);
      this.setAccountStatus(`Compte « ${updated.username} » mis à jour.`, false);
      document.getElementById(`account-edit-btn-${updated.username}`)?.focus();
    } catch (e) {
      console.error('update_cashier_account failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la mise à jour du compte. Réessayez.';
      this.editAccountError.set(message);
    } finally {
      this.savingEditAccount.set(false);
    }
  }
  togglingStatusUsername = signal<string | null>(null);
  confirmingDeleteUsername = signal<string | null>(null);
  deletingAccount = signal(false);
  deleteAccountError = signal('');
  /** Reversibly blocks an account from logging in. Kept separate from
   *  permanent deletion so an admin can temporarily take a cashier offline
   *  (e.g. between shifts) without losing the account or its history. */
  async suspendAccount(account: CashierAccountView): Promise<void> {
    if (this.togglingStatusUsername()) return;
    this.togglingStatusUsername.set(account.username);
    this.setAccountStatus('', false);
    try {
      const updated = await invoke<CashierAccountView>('suspend_cashier_account', {
        username: account.username,
      });
      this.accounts.update((list) => list.map((a) => (a.username === updated.username ? updated : a)));
      this.setAccountStatus(`Compte « ${updated.username} » suspendu.`, false);
    } catch (e) {
      console.error('suspend_cashier_account failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la suspension du compte. Réessayez.';
      this.setAccountStatus(message, true);
    } finally {
      this.togglingStatusUsername.set(null);
    }
  }
  async reactivateAccount(account: CashierAccountView): Promise<void> {
    if (this.togglingStatusUsername()) return;
    this.togglingStatusUsername.set(account.username);
    this.setAccountStatus('', false);
    try {
      const updated = await invoke<CashierAccountView>('reactivate_cashier_account', {
        username: account.username,
      });
      this.accounts.update((list) => list.map((a) => (a.username === updated.username ? updated : a)));
      this.setAccountStatus(`Compte « ${updated.username} » réactivé.`, false);
    } catch (e) {
      console.error('reactivate_cashier_account failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la réactivation du compte. Réessayez.';
      this.setAccountStatus(message, true);
    } finally {
      this.togglingStatusUsername.set(null);
    }
  }
  requestDeleteAccount(account: CashierAccountView): void {
    this.editingUsername.set(null);
    this.confirmingDeleteUsername.set(account.username);
    this.deleteAccountError.set('');
    setTimeout(() => {
      document.getElementById(`account-delete-confirm-btn-${account.username}`)?.focus();
    });
  }
  /** Closes the confirmation step and returns focus to the row's delete button. */
  cancelDeleteAccount(): void {
    const username = this.confirmingDeleteUsername();
    this.confirmingDeleteUsername.set(null);
    this.deleteAccountError.set('');
    if (username) {
      document.getElementById(`account-delete-btn-${username}`)?.focus();
    }
  }
  /** Permanently removes the account — irreversible, unlike `suspendAccount`. Only
   *  reachable after `requestDeleteAccount`'s confirmation step. */
  async confirmDeleteAccount(account: CashierAccountView): Promise<void> {
    if (this.deletingAccount()) return;
    this.deletingAccount.set(true);
    this.deleteAccountError.set('');
    try {
      await invoke<void>('delete_cashier_account', { username: account.username });
      this.accounts.update((list) => list.filter((a) => a.username !== account.username));
      this.confirmingDeleteUsername.set(null);
      this.setAccountStatus(`Compte « ${account.username} » supprimé définitivement.`, false);
      this.newAccountUsernameInput?.nativeElement.focus();
    } catch (e) {
      console.error('delete_cashier_account failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la suppression du compte. Réessayez.';
      this.deleteAccountError.set(message);
    } finally {
      this.deletingAccount.set(false);
    }
  }
  goBack(): void {
    this.router.navigate(['/caissier']);
  }
  goToDisplaySettings(): void {
    this.router.navigate(['/affichage']);
  }
}
