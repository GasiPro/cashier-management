
import { Component, ElementRef, OnInit, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
const LS_USERNAME = 'gasipro:username';
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
const MAX_DISPLAY_NAME_LEN = 40;
const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_DIGIT = /\d/;
interface AdminNavItem {
  id: string;
  label: string;
}
const NAV_ITEMS: AdminNavItem[] = [
  { id: 'comptes', label: 'Comptes' },
  { id: 'appareils', label: 'Appareils & connexions' },
  { id: 'grille-tarifaire', label: 'Grille tarifaire' },
  { id: 'commandes', label: 'Commandes' },
  { id: 'rapport', label: 'Rapport' },
];
type AccountStatus = 'active' | 'suspended';
interface CashierAccountView {
  username: string;
  display_name: string;
  created_at: string;
  status: AccountStatus;
}
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class Admin implements OnInit {
  readonly navItems = NAV_ITEMS;
  readonly username = localStorage.getItem(LS_USERNAME) ?? 'Admin';
  readonly minUsernameLen = MIN_USERNAME_LEN;
  readonly maxUsernameLen = MAX_USERNAME_LEN;
  readonly minPasswordLen = MIN_PASSWORD_LEN;
  readonly maxDisplayNameLen = MAX_DISPLAY_NAME_LEN;
  @ViewChild('newAccountUsernameInput') private newAccountUsernameInput?: ElementRef<HTMLInputElement>;
  activeSection = signal<string>('accueil');
  selectSection(id: string): void {
    this.activeSection.set(id);
  }
  isActive(id: string): boolean {
    return this.activeSection() === id;
  }
  navItemClass(id: string): string {
    const base = 'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors';
    return this.isActive(id)
      ? `${base} bg-[#EFF4FA] text-[#1E3A5F] font-medium`
      : `${base} text-gray-700 hover:bg-gray-50`;
  }
  activeLabel(): string {
    if (this.activeSection() === 'accueil') return 'Accueil';
    return this.navItems.find((item) => item.id === this.activeSection())?.label ?? '';
  }
  ngOnInit(): void {
    this.loadAccounts();
  }
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
}
