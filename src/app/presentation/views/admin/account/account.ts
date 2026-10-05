import { Component, ElementRef, OnInit, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
const MAX_DISPLAY_NAME_LEN = 40;
const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_DIGIT = /\d/;
type AccountStatus = 'active' | 'suspended';
type UserType = 'admin' | 'caissier' | 'comptoir';
interface UserTypeChoice {
  value: UserType;
  label: string;
}
const USER_TYPES: UserTypeChoice[] = [
  { value: 'admin', label: 'Administrateur' },
  { value: 'caissier', label: 'Caissier' },
  { value: 'comptoir', label: 'Comptoir' },
];
interface AccountHistoryEntry {
  kind: 'created' | 'suspended' | 'reactivated' | 'modified';
  at: string;
  reason?: string | null;
}
interface AccountView {
  id: number;
  username: string;
  display_name: string;
  user_type: UserType;
  status: AccountStatus;
  created_at: string;
  last_sign_in_at?: string | null;
  history: AccountHistoryEntry[];
}
type ActivityAction = 'Création' | 'Suspension' | 'Réactivation' | 'Modification';
interface AccountActivity {
  id: number;
  account_username: string;
  action: ActivityAction;
  detail: string;
  at: string;
}
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account.html',
  styleUrl: './account.css',
})
export class Account implements OnInit {
  readonly userTypes = USER_TYPES;
  readonly minUsernameLen = MIN_USERNAME_LEN;
  readonly maxUsernameLen = MAX_USERNAME_LEN;
  readonly minPasswordLen = MIN_PASSWORD_LEN;
  readonly maxDisplayNameLen = MAX_DISPLAY_NAME_LEN;
  @ViewChild('newAccountUsernameInput') private newAccountUsernameInput?: ElementRef<HTMLInputElement>;
  ngOnInit(): void {
    this.loadAccounts();
    this.loadActivities();
  }
  accounts = signal<AccountView[]>([]);
  loadingAccounts = signal(true);
  expandedUsername = signal<string | null>(null);
  private async loadAccounts(): Promise<void> {
    this.loadingAccounts.set(true);
    try {
      const accounts = await invoke<AccountView[]>('account', { command: { method: 'list' } });
      this.accounts.set(accounts);
    } catch (e) {
      console.error('failed to load accounts', e);
      this.setAccountStatus(this.errorMessage(e, 'Impossible de charger la liste des comptes.'), true);
    } finally {
      this.loadingAccounts.set(false);
    }
  }
  isExpanded(username: string): boolean {
    return this.expandedUsername() === username;
  }
  toggleExpand(account: AccountView): void {
    this.expandedUsername.set(this.isExpanded(account.username) ? null : account.username);
  }
  userTypeLabel(type: UserType): string {
    return this.userTypes.find((t) => t.value === type)?.label ?? type;
  }
  historyLabel(entry: AccountHistoryEntry): string {
    switch (entry.kind) {
      case 'created':
        return 'Compte créé';
      case 'suspended':
        return entry.reason ? `Suspendu — ${entry.reason}` : 'Suspendu';
      case 'reactivated':
        return 'Réactivé';
      case 'modified':
        return 'Modifié';
      default:
        return entry.kind;
    }
  }
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
  accountStatusMessage = signal('');
  accountStatusIsError = signal(false);
  private setAccountStatus(message: string, isError: boolean): void {
    this.accountStatusMessage.set(message);
    this.accountStatusIsError.set(isError);
  }
  /** Tauri rejects with `unknown` — usually a string, sometimes an Error or a
   *  serialized object. Extract something readable, or fall back to `fallback`. */
  private errorMessage(e: unknown, fallback: string): string {
    if (typeof e === 'string') return e.trim() || fallback;
    if (e instanceof Error) return e.message.trim() || fallback;
    if (e && typeof e === 'object' && 'message' in e) {
      const message = String((e as { message: unknown }).message).trim();
      if (message) return message;
    }
    if (e === null || e === undefined) return fallback;
    const text = String(e).trim();
    return text && text !== '[object Object]' ? text : fallback;
  }
  togglingStatusUsername = signal<string | null>(null);
  async suspendAccount(account: AccountView): Promise<void> {
    if (this.togglingStatusUsername()) return;
    this.togglingStatusUsername.set(account.username);
    this.setAccountStatus('', false);
    try {
      const updated = await invoke<AccountView>('account', {
        command: { method: 'suspend', username: account.username },
      });
      this.accounts.update((list) => list.map((a) => (a.username === updated.username ? updated : a)));
      this.setAccountStatus(`Compte « ${updated.username} » suspendu.`, false);
    } catch (e) {
      console.error('suspend_account failed', e);
      const message = this.errorMessage(e, 'Échec de la suspension du compte. Réessayez.');
      this.setAccountStatus(message, true);
    } finally {
      this.togglingStatusUsername.set(null);
    }
  }
  async reactivateAccount(account: AccountView): Promise<void> {
    if (this.togglingStatusUsername()) return;
    this.togglingStatusUsername.set(account.username);
    this.setAccountStatus('', false);
    try {
      const updated = await invoke<AccountView>('account', {
        command: { method: 'reactivate', username: account.username },
      });
      this.accounts.update((list) => list.map((a) => (a.username === updated.username ? updated : a)));
      this.setAccountStatus(`Compte « ${updated.username} » réactivé.`, false);
    } catch (e) {
      console.error('reactivate_account failed', e);
      const message = this.errorMessage(e, 'Échec de la réactivation du compte. Réessayez.');
      this.setAccountStatus(message, true);
    } finally {
      this.togglingStatusUsername.set(null);
    }
  }
  editingUsername = signal<string | null>(null);
  editDisplayName = signal('');
  editUserType = signal<UserType>('caissier');
  savingEditAccount = signal(false);
  editAccountError = signal('');
  /** The `update` method also accepts an optional password, but this form only sends
   *  the display name and the user type. */
  canSubmitEditAccount = computed(() => {
    if (this.savingEditAccount()) return false;
    return this.editDisplayName().trim().length <= this.maxDisplayNameLen;
  });
  startEditAccount(account: AccountView): void {
    this.confirmingDeleteUsername.set(null);
    this.editingUsername.set(account.username);
    this.editDisplayName.set(account.display_name);
    this.editUserType.set(account.user_type);
    this.editAccountError.set('');
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
  private validateEditAccountForm(): string {
    if (this.editDisplayName().trim().length > this.maxDisplayNameLen) {
      return `Le nom affiché ne peut pas dépasser ${this.maxDisplayNameLen} caractères.`;
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
      const updated = await invoke<AccountView>('account', {
        command: {
          method: 'update',
          username,
          display_name: displayName,
          user_type: this.editUserType(),
        },
      });
      this.accounts.update((list) => list.map((a) => (a.username === updated.username ? updated : a)));
      this.editingUsername.set(null);
      this.setAccountStatus(`Compte « ${updated.username} » mis à jour.`, false);
      document.getElementById(`account-edit-btn-${updated.username}`)?.focus();
    } catch (e) {
      console.error('update_account failed', e);
      const message = this.errorMessage(e, 'Échec de la mise à jour du compte. Réessayez.');
      this.editAccountError.set(message);
    } finally {
      this.savingEditAccount.set(false);
    }
  }
  confirmingDeleteUsername = signal<string | null>(null);
  deletingAccount = signal(false);
  deleteAccountError = signal('');
  requestDeleteAccount(account: AccountView): void {
    this.editingUsername.set(null);
    this.confirmingDeleteUsername.set(account.username);
    this.deleteAccountError.set('');
    setTimeout(() => {
      document.getElementById(`account-delete-confirm-btn-${account.username}`)?.focus();
    });
  }
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
  async confirmDeleteAccount(account: AccountView): Promise<void> {
    if (this.deletingAccount()) return;
    this.deletingAccount.set(true);
    this.deleteAccountError.set('');
    try {
      await invoke<void>('account', {
        command: { method: 'delete', username: account.username },
      });
      this.accounts.update((list) => list.filter((a) => a.username !== account.username));
      this.confirmingDeleteUsername.set(null);
      this.setAccountStatus(`Compte « ${account.username} » supprimé définitivement.`, false);
    } catch (e) {
      console.error('delete_account failed', e);
      const message = this.errorMessage(e, 'Échec de la suppression du compte. Réessayez.');
      this.deleteAccountError.set(message);
    } finally {
      this.deletingAccount.set(false);
    }
  }
  showCreatePanel = signal(false);
  newUsername = signal('');
  newDisplayName = signal('');
  newUserType = signal<UserType>('caissier');
  newPassword = signal('');
  newPasswordConfirm = signal('');
  showNewPassword = signal(false);
  creatingAccount = signal(false);
  accountFormError = signal('');
  private readonly trimmedNewUsername = computed(() => this.newUsername().trim());
  /** Client-side shape check only — the server is still the source of truth for
   *  uniqueness, so the button stays enabled even if this passes; the real
   *  rejection (if any) comes back from `create_account`. */
  canSubmitAccount = computed(() => {
    const username = this.trimmedNewUsername();
    const password = this.newPassword();
    const confirm = this.newPasswordConfirm();
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
  openCreatePanel(): void {
    this.showCreatePanel.set(true);
    this.accountFormError.set('');
    setTimeout(() => this.newAccountUsernameInput?.nativeElement.focus());
  }
  closeCreatePanel(): void {
    this.showCreatePanel.set(false);
    this.resetAccountForm();
  }
  toggleNewPasswordVisibility(): void {
    this.showNewPassword.update((v) => !v);
  }
  private validateAccountForm(): string {
    const username = this.trimmedNewUsername();
    if (username.length < this.minUsernameLen) {
      return `Le nom d'utilisateur doit contenir au moins ${this.minUsernameLen} caractères.`;
    }
    if (username.length > this.maxUsernameLen) {
      return `Le nom d'utilisateur ne peut pas dépasser ${this.maxUsernameLen} caractères.`;
    }
    if (this.accounts().some((a) => a.username.toLowerCase() === username.toLowerCase())) {
      return "Ce nom d'utilisateur est déjà utilisé.";
    }
    if (this.newPassword().length < this.minPasswordLen) {
      return `Le mot de passe doit contenir au moins ${this.minPasswordLen} caractères.`;
    }
    if (!PASSWORD_HAS_LETTER.test(this.newPassword()) || !PASSWORD_HAS_DIGIT.test(this.newPassword())) {
      return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    }
    if (this.newPassword() !== this.newPasswordConfirm()) {
      return 'Les mots de passe ne correspondent pas.';
    }
    return '';
  }
  async createAccount(): Promise<void> {
    if (this.creatingAccount()) return;
    const formError = this.validateAccountForm();
    if (formError) {
      this.accountFormError.set(formError);
      return;
    }
    this.accountFormError.set('');
    this.creatingAccount.set(true);
    try {
      const created = await invoke<AccountView>('account', {
        command: {
          method: 'create',
          username: this.trimmedNewUsername(),
          password: this.newPassword(),
          display_name: this.newDisplayName().trim(),
          user_type: this.newUserType(),
        },
      });
      this.accounts.update((list) => [created, ...list]);
      this.setAccountStatus(`Compte « ${created.username} » créé.`, false);
      this.closeCreatePanel();
    } catch (e) {
      console.error('create_account failed', e);
      const message = this.errorMessage(e, 'Échec de la création du compte. Réessayez.');
      this.accountFormError.set(message);
    } finally {
      this.creatingAccount.set(false);
    }
  }
  private resetAccountForm(): void {
    this.newUsername.set('');
    this.newDisplayName.set('');
    this.newUserType.set('caissier');
    this.newPassword.set('');
    this.newPasswordConfirm.set('');
    this.showNewPassword.set(false);
    this.accountFormError.set('');
  }
  // ── Account activity ─────────────────────────────────────────────────────
  activities = signal<AccountActivity[]>([]);
  loadingActivities = signal(true);
  private async loadActivities(): Promise<void> {
    this.loadingActivities.set(true);
    try {
      const activities = await invoke<AccountActivity[]>('account', {
        command: { method: 'activities' },
      });
      this.activities.set(activities);
    } catch (e) {
      console.error('failed to load account activities', e);
      this.setAccountStatus(this.errorMessage(e, "Impossible de charger l'activité des comptes."), true);
    } finally {
      this.loadingActivities.set(false);
    }
  }
}
