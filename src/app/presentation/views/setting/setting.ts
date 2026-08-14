// src/app/presentation/vews/setting/setting.ts
import { Component, ElementRef, OnInit, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';

/** Kept in sync with `MAX_ALLOWED_CONNECTED_DEVICES` in src-tauri/src/config/settings.rs. */
const MAX_ALLOWED_CONNECTED_DEVICES = 50;

/** Kept in sync with the bounds in src-tauri/src/config/accounts.rs. */
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 6;
const MAX_DISPLAY_NAME_LEN = 40;

/** Mirrors `CashierAccountView` returned by the Tauri backend — never carries a password. */
interface CashierAccountView {
  username: string;
  display_name: string;
  created_at: string;
}

@Component({
  selector: 'app-setting',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './setting.html',
  styleUrl: './setting.css',
})
export class Setting implements OnInit {
  readonly maxAllowedConnectedDevices = MAX_ALLOWED_CONNECTED_DEVICES;
  readonly minUsernameLen = MIN_USERNAME_LEN;
  readonly maxUsernameLen = MAX_USERNAME_LEN;
  readonly minPasswordLen = MIN_PASSWORD_LEN;
  readonly maxDisplayNameLen = MAX_DISPLAY_NAME_LEN;

  @ViewChild('newAccountUsernameInput') private newAccountUsernameInput?: ElementRef<HTMLInputElement>;

  // ── Max connected devices ─────────────────────────────────────────────────
  /** Value currently applied on the server. */
  maxConnectedDevices = signal(0);
  /** Value shown in the input — kept separate so typing/stepping doesn't save until confirmed. */
  maxConnectedDevicesDraft = signal(0);
  /** How many comptoirs are connected right now (from the same peer tracking as the Appareils panel). */
  connectedDevicesCount = signal(0);
  loadingDevicesSetting = signal(true);
  savingDevicesSetting = signal(false);
  devicesSettingDirty = computed(() => this.maxConnectedDevicesDraft() !== this.maxConnectedDevices());
  /** True once the currently-applied limit is already reached — informs the cashier why new requests may be turned away. */
  atDevicesCapacity = computed(
    () => this.maxConnectedDevices() > 0 && this.connectedDevicesCount() >= this.maxConnectedDevices(),
  );

  // ── Save feedback, announced to screen readers via aria-live ─────────────────
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
      password === confirm &&
      !this.creatingAccount()
    );
  });

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.loadDevicesSetting();
    this.loadAccounts();
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

  // ── Stepper / input helpers ──────────────────────────────────────────────────

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

  /** Discards unsaved edits, restoring the last value applied on the server. */
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

  // ── Cashier accounts ──────────────────────────────────────────────────────

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

  /** Client-side check, mirroring the server-side validation in accounts.rs, so the
   *  cashier gets immediate feedback instead of waiting on a round trip for an
   *  obviously invalid entry. Returns a message, or '' if the form looks valid. */
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
      // Ready for the next entry — helps when creating several accounts in a row.
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

  // ── Cashier accounts: modify (display name / password) ─────────────────────

  /** Username of the account currently being edited, or null if none — only one
   *  row is editable at a time so the form and its validation stay unambiguous. */
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
    return password.length >= this.minPasswordLen && password === confirm;
  });

  startEditAccount(account: CashierAccountView): void {
    this.editingUsername.set(account.username);
    this.editDisplayName.set(account.display_name);
    this.editPassword.set('');
    this.editPasswordConfirm.set('');
    this.showEditPassword.set(false);
    this.editAccountError.set('');
    // Move focus into the panel once it's rendered, so keyboard/screen-reader
    // users land straight on the first editable field instead of the button.
    setTimeout(() => {
      document.getElementById(`edit-display-name-${account.username}`)?.focus();
    });
  }

  /** Closes the edit panel and returns focus to the row's "Modifier" button. */
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

  /** Client-side check, mirroring the server-side validation in accounts.rs. */
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

  goBack(): void {
    this.router.navigate(['/caissier']);
  }
}