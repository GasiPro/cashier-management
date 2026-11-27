import { Component, ElementRef, OnInit, signal, computed, ViewChild } from '@angular/core';
import { localeDate } from '../../../core/display/datetime-settings';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MAX_DISPLAY_NAME_LEN,
  MIN_USERNAME_LEN,
  MAX_USERNAME_LEN,
  MIN_PASSWORD_LEN,
  PASSWORD_HAS_LETTER,
  PASSWORD_HAS_DIGIT,
} from '../../../core/config/app.constants';
import { errorMessage } from '../../../core/error/error-messages';
import { getStoredUsername } from '../../../core/storage/local-storage';
import * as accountApi from '../../../data/account/account.api';
import { AccountActivity, AccountHistoryEntry, AccountView, USER_TYPES, UserType } from '../../../data/account/account.model';
import * as deviceApi from '../../../data/device/device.api';
import {
  BlacklistEntry,
  BlacklistEntryType,
  MAX_ALLOWED_CONNECTED_DEVICES,
  MAX_BLACKLIST_ADDR_LEN,
  MAX_BLACKLIST_REASON_LEN,
  PeerId,
} from '../../../data/device/device.model';
import { isValidIp } from '../../../shared/utils/validators';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { translate } from '../../../core/i18n/translate';
interface BlacklistTypeChoice {
  value: BlacklistEntryType;
  label: string;
  field: string;
  placeholder: string;
  emptyError: string;
}
const BLACKLIST_TYPES: BlacklistTypeChoice[] = [
  {
    value: 'ip',
    label: 'Adresse IP',
    field: 'Adresse IP',
    placeholder: 'ex : 192.168.1.42',
    emptyError: 'Saisissez une adresse IP.',
  },
  {
    value: 'account',
    label: 'Compte',
    field: "Identifiant ou nom d'utilisateur",
    placeholder: 'ex : caisse2',
    emptyError: "Saisissez un identifiant ou un nom d'utilisateur.",
  },
  {
    value: 'device',
    label: 'Appareil',
    field: "Identifiant de l'appareil",
    placeholder: "Identifiant de l'appareil",
    emptyError: "Saisissez un identifiant d'appareil.",
  },
];
@Component({
  selector: 'app-admin-accounts',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './accounts.page.html'
})
export class AccountsPage implements OnInit {
  readonly userTypes = USER_TYPES;
  readonly minUsernameLen = MIN_USERNAME_LEN;
  readonly maxUsernameLen = MAX_USERNAME_LEN;
  readonly minPasswordLen = MIN_PASSWORD_LEN;
  readonly maxDisplayNameLen = MAX_DISPLAY_NAME_LEN;
  readonly blacklistTypes = BLACKLIST_TYPES;
  readonly maxBlacklistAddrLen = MAX_BLACKLIST_ADDR_LEN;
  readonly maxBlacklistReasonLen = MAX_BLACKLIST_REASON_LEN;
  readonly maxAllowedConnectedDevices = MAX_ALLOWED_CONNECTED_DEVICES;
  @ViewChild('newAccountUsernameInput') private newAccountUsernameInput?: ElementRef<HTMLInputElement>;
  ngOnInit(): void {
    this.loadAccounts();
    this.loadActivities();
    this.loadBlacklist();
    this.loadDevicesSetting();
  }
  accounts = signal<AccountView[]>([]);
  loadingAccounts = signal(true);
  searchTerm = signal('');
  readonly filteredAccounts = computed<AccountView[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.accounts();
    return this.accounts().filter(
      (a) =>
        a.username.toLowerCase().includes(term) ||
        a.display_name.toLowerCase().includes(term) ||
        this.userTypeLabel(a.user_type).toLowerCase().includes(term),
    );
  });
  private readonly currentUsername = (getStoredUsername() ?? '').trim().toLowerCase();
  /** The signed-in admin cannot suspend or delete their own account from this screen. */
  isSelf(account: AccountView): boolean {
    return this.currentUsername.length > 0 && account.username.toLowerCase() === this.currentUsername;
  }
  expandedUsername = signal<string | null>(null);
  private async loadAccounts(): Promise<void> {
    this.loadingAccounts.set(true);
    try {
      const accounts = await accountApi.listAccounts();
      this.accounts.set(accounts);
    } catch (e) {
      console.error('failed to load accounts', e);
      this.setAccountStatus(errorMessage(e, translate('Impossible de charger la liste des comptes.')), true);
    } finally {
      this.loadingAccounts.set(false);
    }
  }
  async copyAccountId(account: AccountView): Promise<void> {
    try {
      await navigator.clipboard.writeText(account.id);
      this.setAccountStatus(translate('Identifiant copié.'), false);
    } catch (e) {
      console.error('failed to copy account id', e);
      this.setAccountStatus(translate('Impossible de copier l\'identifiant.'), true);
    }
  }
  isExpanded(username: string): boolean {
    return this.expandedUsername() === username;
  }
  toggleExpand(account: AccountView): void {
    this.expandedUsername.set(this.isExpanded(account.username) ? null : account.username);
  }
  userTypeLabel(type: UserType): string {
    return translate(this.userTypes.find((t) => t.value === type)?.label ?? type);
  }
  historyLabel(entry: AccountHistoryEntry): string {
    switch (entry.kind) {
      case 'created':
        return translate('Compte créé');
      case 'suspended':
        return entry.reason ? translate('Suspendu — {reason}', { reason: entry.reason }) : translate('Suspendu');
      case 'reactivated':
        return translate('Réactivé');
      case 'modified':
        return translate('Modifié');
      default:
        return entry.kind;
    }
  }
  formatAccountDate(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    return localeDate(date, {
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
  togglingStatusUsername = signal<string | null>(null);
  async suspendAccount(account: AccountView): Promise<void> {
    if (this.togglingStatusUsername() || this.isSelf(account)) return;
    this.togglingStatusUsername.set(account.username);
    this.setAccountStatus('', false);
    try {
      const updated = await accountApi.suspendAccount(account.username);
      this.accounts.update((list) => list.map((a) => (a.username === updated.username ? updated : a)));
      this.setAccountStatus(translate('Compte « {username} » suspendu.', { username: updated.username }), false);
      void this.loadActivities(true);
    } catch (e) {
      console.error('suspend_account failed', e);
      const message = errorMessage(e, translate('Échec de la suspension du compte. Réessayez.'));
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
      const updated = await accountApi.reactivateAccount(account.username);
      this.accounts.update((list) => list.map((a) => (a.username === updated.username ? updated : a)));
      this.setAccountStatus(translate('Compte « {username} » réactivé.', { username: updated.username }), false);
      void this.loadActivities(true);
    } catch (e) {
      console.error('reactivate_account failed', e);
      const message = errorMessage(e, translate('Échec de la réactivation du compte. Réessayez.'));
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
  editPassword = signal('');
  editPasswordConfirm = signal('');
  showEditPassword = signal(false);
  toggleEditPasswordVisibility(): void {
    this.showEditPassword.update((v) => !v);
  }
  /** The password is optional when editing: left empty, the current one is kept. */
  canSubmitEditAccount = computed(() => {
    if (this.savingEditAccount()) return false;
    if (this.editDisplayName().trim().length > this.maxDisplayNameLen) return false;
    const password = this.editPassword();
    if (password.length === 0 && this.editPasswordConfirm().length === 0) return true;
    return (
      password.length >= this.minPasswordLen &&
      PASSWORD_HAS_LETTER.test(password) &&
      PASSWORD_HAS_DIGIT.test(password) &&
      password === this.editPasswordConfirm()
    );
  });
  startEditAccount(account: AccountView): void {
    this.confirmingDeleteUsername.set(null);
    this.editingUsername.set(account.username);
    this.editDisplayName.set(account.display_name);
    this.editUserType.set(account.user_type);
    this.editPassword.set('');
    this.editPasswordConfirm.set('');
    this.showEditPassword.set(false);
    this.editAccountError.set('');
    setTimeout(() => {
      document.getElementById(`edit-display-name-${account.username}`)?.focus();
    });
  }
  cancelEditAccount(): void {
    const username = this.editingUsername();
    this.editingUsername.set(null);
    this.editPassword.set('');
    this.editPasswordConfirm.set('');
    this.showEditPassword.set(false);
    if (username) {
      document.getElementById(`account-edit-btn-${username}`)?.focus();
    }
  }
  private validateEditAccountForm(): string {
    if (this.editDisplayName().trim().length > this.maxDisplayNameLen) {
      return translate('Le nom affiché ne peut pas dépasser {maxDisplayNameLen} caractères.', { maxDisplayNameLen: this.maxDisplayNameLen });
    }
    const password = this.editPassword();
    if (password.length > 0 || this.editPasswordConfirm().length > 0) {
      if (password.length < this.minPasswordLen) {
        return translate('Le mot de passe doit contenir au moins {minPasswordLen} caractères.', { minPasswordLen: this.minPasswordLen });
      }
      if (!PASSWORD_HAS_LETTER.test(password) || !PASSWORD_HAS_DIGIT.test(password)) {
        return translate('Le mot de passe doit contenir au moins une lettre et un chiffre.');
      }
      if (password !== this.editPasswordConfirm()) {
        return translate('Les mots de passe ne correspondent pas.');
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
      const newPassword = this.editPassword();
      const updated = await accountApi.updateAccount({
        username,
        display_name: displayName,
        user_type: this.editUserType(),
        ...(newPassword.length > 0 ? { password: newPassword } : {}),
      });
      this.accounts.update((list) => list.map((a) => (a.username === updated.username ? updated : a)));
      this.editingUsername.set(null);
      this.editPassword.set('');
      this.editPasswordConfirm.set('');
      this.showEditPassword.set(false);
      this.setAccountStatus(
        newPassword.length > 0
          ? translate('Compte « {username} » mis à jour, mot de passe modifié.', { username: updated.username })
          : translate('Compte « {username} » mis à jour.', { username: updated.username }),
        false,
      );
      void this.loadActivities(true);
      document.getElementById(`account-edit-btn-${updated.username}`)?.focus();
    } catch (e) {
      console.error('update_account failed', e);
      const message = errorMessage(e, translate('Échec de la mise à jour du compte. Réessayez.'));
      this.editAccountError.set(message);
    } finally {
      this.savingEditAccount.set(false);
    }
  }
  confirmingDeleteUsername = signal<string | null>(null);
  deletingAccount = signal(false);
  deleteAccountError = signal('');
  requestDeleteAccount(account: AccountView): void {
    if (this.isSelf(account)) return;
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
    if (this.deletingAccount() || this.isSelf(account)) return;
    this.deletingAccount.set(true);
    this.deleteAccountError.set('');
    try {
      await accountApi.deleteAccount(account.username);
      this.accounts.update((list) => list.filter((a) => a.username !== account.username));
      this.confirmingDeleteUsername.set(null);
      this.setAccountStatus(translate('Compte « {username} » supprimé définitivement.', { username: account.username }), false);
      void this.loadActivities(true);
    } catch (e) {
      console.error('delete_account failed', e);
      const message = errorMessage(e, translate('Échec de la suppression du compte. Réessayez.'));
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
      return translate('Le nom d\'utilisateur doit contenir au moins {minUsernameLen} caractères.', { minUsernameLen: this.minUsernameLen });
    }
    if (username.length > this.maxUsernameLen) {
      return translate('Le nom d\'utilisateur ne peut pas dépasser {maxUsernameLen} caractères.', { maxUsernameLen: this.maxUsernameLen });
    }
    if (this.accounts().some((a) => a.username.toLowerCase() === username.toLowerCase())) {
      return translate('Ce nom d\'utilisateur est déjà utilisé.');
    }
    if (this.newPassword().length < this.minPasswordLen) {
      return translate('Le mot de passe doit contenir au moins {minPasswordLen} caractères.', { minPasswordLen: this.minPasswordLen });
    }
    if (!PASSWORD_HAS_LETTER.test(this.newPassword()) || !PASSWORD_HAS_DIGIT.test(this.newPassword())) {
      return translate('Le mot de passe doit contenir au moins une lettre et un chiffre.');
    }
    if (this.newPassword() !== this.newPasswordConfirm()) {
      return translate('Les mots de passe ne correspondent pas.');
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
      const created = await accountApi.createAccount({
        username: this.trimmedNewUsername(),
        password: this.newPassword(),
        display_name: this.newDisplayName().trim(),
        user_type: this.newUserType(),
      });
      this.accounts.update((list) => [created, ...list]);
      this.setAccountStatus(translate('Compte « {username} » créé.', { username: created.username }), false);
      this.closeCreatePanel();
      void this.loadActivities(true);
    } catch (e) {
      console.error('create_account failed', e);
      const message = errorMessage(e, translate('Échec de la création du compte. Réessayez.'));
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
  private async loadActivities(silent = false): Promise<void> {
    if (!silent) this.loadingActivities.set(true);
    try {
      const activities = await accountApi.listAccountActivities();
      this.activities.set(activities);
    } catch (e) {
      console.error('failed to load account activities', e);
      if (!silent) {
        this.setAccountStatus(errorMessage(e, translate('Impossible de charger l\'activité des comptes.')), true);
      }
    } finally {
      this.loadingActivities.set(false);
    }
  }
  blacklist = signal<BlacklistEntry[]>([]);
  loadingBlacklist = signal(true);
  newBlacklistType = signal<BlacklistEntryType>('ip');
  newBlacklistValue = signal('');
  newBlacklistReason = signal('');
  addingBlacklistEntry = signal(false);
  blacklistFormError = signal('');
  blacklistStatusMessage = signal('');
  blacklistStatusIsError = signal(false);
  confirmingRemoveBlacklistId = signal<PeerId | null>(null);
  removingBlacklistId = signal<PeerId | null>(null);
  removeBlacklistError = signal('');
  readonly selectedBlacklistType = computed<BlacklistTypeChoice>(
    () => this.blacklistTypes.find((t) => t.value === this.newBlacklistType()) ?? this.blacklistTypes[0],
  );
  private readonly trimmedBlacklistValue = computed(() => this.newBlacklistValue().trim());
  canSubmitBlacklist = computed(() => {
    const value = this.trimmedBlacklistValue();
    return (
      value.length > 0 &&
      value.length <= this.maxBlacklistAddrLen &&
      !this.addingBlacklistEntry() &&
      !this.blacklistHas(this.newBlacklistType(), value)
    );
  });
  private setBlacklistStatus(message: string, isError: boolean): void {
    this.blacklistStatusMessage.set(message);
    this.blacklistStatusIsError.set(isError);
  }
  private blacklistHas(type: BlacklistEntryType, value: string): boolean {
    return this.blacklist().some((b) => b.type === type && b.value.toLowerCase() === value.toLowerCase());
  }
  blacklistTypeLabel(type: BlacklistEntryType): string {
    return translate(this.blacklistTypes.find((t) => t.value === type)?.label ?? type);
  }
  setBlacklistType(type: BlacklistEntryType): void {
    this.newBlacklistType.set(type);
    this.blacklistFormError.set('');
  }
  private async loadBlacklist(): Promise<void> {
    this.loadingBlacklist.set(true);
    try {
      this.blacklist.set(await deviceApi.listBlacklist());
    } catch (e) {
      console.error('failed to load blacklist', e);
      this.setBlacklistStatus(errorMessage(e, translate('Impossible de charger la liste noire.')), true);
    } finally {
      this.loadingBlacklist.set(false);
    }
  }
  private validateBlacklistForm(): string {
    const type = this.newBlacklistType();
    const value = this.trimmedBlacklistValue();
    if (value.length === 0) return translate(this.selectedBlacklistType().emptyError);
    if (type === 'ip' && !isValidIp(value)) return translate('Adresse IP invalide (ex : 192.168.1.42).');
    if (value.length > this.maxBlacklistAddrLen) {
      return translate('Cette valeur ne peut pas dépasser {maxBlacklistAddrLen} caractères.', { maxBlacklistAddrLen: this.maxBlacklistAddrLen });
    }
    if (this.blacklistHas(type, value)) return translate('Cette entrée est déjà dans la liste noire.');
    return '';
  }
  async addBlacklistEntry(): Promise<void> {
    if (this.addingBlacklistEntry()) return;
    const formError = this.validateBlacklistForm();
    if (formError) {
      this.blacklistFormError.set(formError);
      return;
    }
    this.blacklistFormError.set('');
    this.addingBlacklistEntry.set(true);
    try {
      await deviceApi.addBlacklistEntry(
        this.newBlacklistType(),
        this.trimmedBlacklistValue(),
        this.newBlacklistReason().trim() || null,
      );
      this.blacklist.set(await deviceApi.listBlacklist());
      this.newBlacklistValue.set('');
      this.newBlacklistReason.set('');
      this.setBlacklistStatus(translate('Entrée ajoutée à la liste noire.'), false);
    } catch (e) {
      console.error('add_blacklist_entry failed', e);
      this.blacklistFormError.set(errorMessage(e, translate('Échec de l\'ajout. Réessayez.')));
    } finally {
      this.addingBlacklistEntry.set(false);
    }
  }
  requestRemoveBlacklistEntry(entry: BlacklistEntry): void {
    this.confirmingRemoveBlacklistId.set(entry.id);
    this.removeBlacklistError.set('');
  }
  cancelRemoveBlacklistEntry(): void {
    this.confirmingRemoveBlacklistId.set(null);
    this.removeBlacklistError.set('');
  }
  async confirmRemoveBlacklistEntry(entry: BlacklistEntry): Promise<void> {
    if (this.removingBlacklistId()) return;
    this.removingBlacklistId.set(entry.id);
    this.removeBlacklistError.set('');
    try {
      await deviceApi.removeBlacklistEntry(entry.id);
      this.blacklist.update((list) => list.filter((b) => b.id !== entry.id));
      this.confirmingRemoveBlacklistId.set(null);
      this.setBlacklistStatus(translate('Entrée retirée de la liste noire.'), false);
    } catch (e) {
      console.error('remove_blacklist_entry failed', e);
      this.removeBlacklistError.set(errorMessage(e, translate('Échec de la suppression. Réessayez.')));
    } finally {
      this.removingBlacklistId.set(null);
    }
  }
  maxConnectedDevices = signal(0);
  maxConnectedDevicesDraft = signal(0);
  connectedDevicesCount = signal(0);
  loadingDevicesSetting = signal(true);
  savingDevicesSetting = signal(false);
  devicesStatusMessage = signal('');
  devicesStatusIsError = signal(false);
  devicesSettingDirty = computed(() => this.maxConnectedDevicesDraft() !== this.maxConnectedDevices());
  atDevicesCapacity = computed(
    () => this.maxConnectedDevices() > 0 && this.connectedDevicesCount() >= this.maxConnectedDevices(),
  );
  private setDevicesStatus(message: string, isError: boolean): void {
    this.devicesStatusMessage.set(message);
    this.devicesStatusIsError.set(isError);
  }
  private async loadDevicesSetting(): Promise<void> {
    this.loadingDevicesSetting.set(true);
    try {
      const [max, connected] = await Promise.all([deviceApi.getMaxDevices(), deviceApi.countConnectedDevices()]);
      this.maxConnectedDevices.set(max);
      this.maxConnectedDevicesDraft.set(max);
      this.connectedDevicesCount.set(connected);
    } catch (e) {
      console.error('failed to load device settings', e);
      this.setDevicesStatus(errorMessage(e, translate('Impossible de charger les réglages des appareils.')), true);
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
    this.maxConnectedDevicesDraft.set(Math.min(this.maxAllowedConnectedDevices, Math.max(0, Math.round(parsed))));
  }
  resetMaxConnectedDevicesDraft(): void {
    this.maxConnectedDevicesDraft.set(this.maxConnectedDevices());
    this.setDevicesStatus('', false);
  }
  async saveMaxConnectedDevices(): Promise<void> {
    if (!this.devicesSettingDirty() || this.savingDevicesSetting()) return;
    this.savingDevicesSetting.set(true);
    this.setDevicesStatus('', false);
    try {
      const applied = await deviceApi.setMaxDevices(this.maxConnectedDevicesDraft());
      this.maxConnectedDevices.set(applied);
      this.maxConnectedDevicesDraft.set(applied);
      this.setDevicesStatus(
        applied === 0
          ? translate('Nombre d\'appareils illimité enregistré.')
          : translate('Limite enregistrée : {applied} appareil{applied2} maximum.', { applied: applied, applied2: applied > 1 ? 's' : '' }),
        false,
      );
    } catch (e) {
      console.error('devices_max_set failed', e);
      this.setDevicesStatus(errorMessage(e, translate('Échec de l\'enregistrement. Réessayez.')), true);
    } finally {
      this.savingDevicesSetting.set(false);
    }
  }
}
