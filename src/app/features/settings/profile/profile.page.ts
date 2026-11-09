import { Component, OnDestroy, OnInit, Signal, WritableSignal, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAX_DISPLAY_NAME_LEN, MIN_PASSWORD_LEN } from '../../../core/config/app.constants';
import { SessionStore } from '../../../core/auth/session.store';
import { errorMessage } from '../../../core/error/error-messages';
import { getStoredDisplayName, getStoredUsername, setStoredDisplayName } from '../../../core/storage/local-storage';
import * as accountApi from '../../../data/account/account.api';
import { CounterStore } from '../../counter/counter.store';
import { BottomBar, BottomBarNotification } from '../../../layouts/main-layout/bottom-bar/bottom-bar';
import { LeftSidebar } from '../../../layouts/main-layout/sidebar/sidebar';
import { Navbar } from '../../../layouts/main-layout/navbar/navbar';
import { PasswordInput } from '../../../shared/ui/password-input/password-input';
import { passwordRuleError } from '../../../shared/utils/validators';
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, Navbar, LeftSidebar, BottomBar, PasswordInput],
  providers: [CounterStore],
  templateUrl: './profile.page.html',
})
export class ProfilePage implements OnInit, OnDestroy {
  private readonly session = inject(SessionStore);
  /** Counter accounts are edited through the cashier connection (WebSocket), which CounterStore owns. */
  private readonly counter = this.session.role() === 'comptoir' ? inject(CounterStore) : null;
  readonly viewRole: 'cashier' | 'counter' = this.counter ? 'counter' : 'cashier';
  readonly username = getStoredUsername() ?? (this.counter ? 'Comptoir' : 'Caisse');
  readonly maxDisplayNameLen = MAX_DISPLAY_NAME_LEN;
  readonly minPasswordLen = MIN_PASSWORD_LEN;
  // ── Cashier account state (talks to the local `account` command) ───────────
  private readonly cashierSavedName = signal(getStoredDisplayName() ?? '');
  private readonly cashierName = signal(getStoredDisplayName() ?? '');
  private readonly cashierPassword = signal('');
  private readonly cashierPasswordConfirm = signal('');
  private readonly cashierShowPassword = signal(false);
  private readonly cashierSaving = signal(false);
  private readonly cashierError = signal('');
  private readonly cashierNotifications = signal<BottomBarNotification[]>([]);
  private notificationId = 0;
  private readonly cashierFormError = computed(() => {
    if (this.cashierName().trim().length > MAX_DISPLAY_NAME_LEN) {
      return `Le nom affiché ne peut pas dépasser ${MAX_DISPLAY_NAME_LEN} caractères.`;
    }
    const password = this.cashierPassword();
    const confirm = this.cashierPasswordConfirm();
    if (password.length === 0 && confirm.length === 0) return '';
    const ruleError = passwordRuleError(password);
    if (ruleError) return ruleError;
    return password === confirm ? '' : 'Les mots de passe ne correspondent pas.';
  });
  private readonly cashierCanSubmit = computed(() => !this.cashierSaving() && this.cashierFormError() === '');
  private readonly cashierLabel = computed(() => this.cashierSavedName().trim() || this.username);
  // ── State used by the template (same shape for both roles) ─────────────────
  readonly editDisplayName: WritableSignal<string> = this.counter?.editDisplayName ?? this.cashierName;
  readonly editPassword: WritableSignal<string> = this.counter?.editPassword ?? this.cashierPassword;
  readonly editPasswordConfirm: WritableSignal<string> =
    this.counter?.editPasswordConfirm ?? this.cashierPasswordConfirm;
  readonly showPassword: WritableSignal<boolean> = this.counter?.showEditPassword ?? this.cashierShowPassword;
  readonly saving: Signal<boolean> = this.counter?.savingAccount ?? this.cashierSaving;
  readonly error: Signal<string> = this.counter?.editAccountError ?? this.cashierError;
  readonly canSubmit: Signal<boolean> = this.counter?.canSubmitEditAccount ?? this.cashierCanSubmit;
  readonly displayLabel: Signal<string> = this.counter?.displayLabel ?? this.cashierLabel;
  readonly notifications: Signal<BottomBarNotification[]> =
    this.counter?.notifications ?? this.cashierNotifications;
  readonly connected: Signal<boolean> = this.counter?.wsConnected ?? signal(true);
  constructor() {
    const counter = this.counter;
    if (counter) {
      // The account is only readable once the cashier has approved the connection.
      effect(() => {
        if (counter.wsConnected()) untracked(() => counter.openAccountPanel());
      });
    }
  }
  ngOnInit(): void {
    this.counter?.start();
  }
  ngOnDestroy(): void {
    this.counter?.stop();
  }
  save(): void {
    if (this.counter) {
      this.counter.saveAccountSettings();
    } else {
      void this.saveCashierAccount();
    }
  }
  private async saveCashierAccount(): Promise<void> {
    if (this.cashierSaving()) return;
    const formError = this.cashierFormError();
    if (formError) {
      this.cashierError.set(formError);
      return;
    }
    this.cashierError.set('');
    this.cashierSaving.set(true);
    try {
      const updated = await accountApi.updateAccount({
        username: this.username,
        display_name: this.cashierName().trim(),
        user_type: 'caissier',
        password: this.cashierPassword(),
      });
      setStoredDisplayName(updated.display_name);
      this.cashierSavedName.set(updated.display_name);
      this.cashierName.set(updated.display_name);
      this.cashierPassword.set('');
      this.cashierPasswordConfirm.set('');
      this.notify('Compte mis à jour.');
    } catch (e) {
      console.error('account update failed', e);
      this.cashierError.set(errorMessage(e, 'Échec de la mise à jour du compte. Réessayez.'));
    } finally {
      this.cashierSaving.set(false);
    }
  }
  private notify(message: string): void {
    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    this.cashierNotifications.update((list) =>
      [...list, { id: ++this.notificationId, message, time }].slice(-30),
    );
  }
}
