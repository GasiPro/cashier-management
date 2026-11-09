import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MAX_DISPLAY_NAME_LEN, MIN_PASSWORD_LEN } from '../../../core/config/app.constants';
import { errorMessage } from '../../../core/error/error-messages';
import { getStoredDisplayName, getStoredUsername, setStoredDisplayName } from '../../../core/storage/local-storage';
import * as accountApi from '../../../data/account/account.api';
import { PasswordInput } from '../../../shared/ui/password-input/password-input';
import { passwordRuleError } from '../../../shared/utils/validators';
@Component({
  selector: 'app-admin-profile',
  standalone: true,
  imports: [FormsModule, RouterLink, PasswordInput],
  templateUrl: './profile.page.html',
})
export class AdminProfilePage {
  readonly username = getStoredUsername() ?? 'Admin';
  readonly maxDisplayNameLen = MAX_DISPLAY_NAME_LEN;
  readonly minPasswordLen = MIN_PASSWORD_LEN;
  readonly editDisplayName = signal(getStoredDisplayName() ?? '');
  readonly editPassword = signal('');
  readonly editPasswordConfirm = signal('');
  readonly showPassword = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  private readonly formError = computed(() => {
    if (this.editDisplayName().trim().length > MAX_DISPLAY_NAME_LEN) {
      return `Le nom affiché ne peut pas dépasser ${MAX_DISPLAY_NAME_LEN} caractères.`;
    }
    const password = this.editPassword();
    const confirm = this.editPasswordConfirm();
    if (password.length === 0 && confirm.length === 0) return '';
    const ruleError = passwordRuleError(password);
    if (ruleError) return ruleError;
    return password === confirm ? '' : 'Les mots de passe ne correspondent pas.';
  });
  readonly canSubmit = computed(() => !this.saving() && this.formError() === '');
  async save(): Promise<void> {
    if (this.saving()) return;
    const formError = this.formError();
    if (formError) {
      this.error.set(formError);
      return;
    }
    this.error.set('');
    this.success.set('');
    this.saving.set(true);
    try {
      const updated = await accountApi.updateAccount({
        username: this.username,
        display_name: this.editDisplayName().trim(),
        user_type: 'admin',
        password: this.editPassword(),
      });
      setStoredDisplayName(updated.display_name);
      this.editDisplayName.set(updated.display_name);
      this.editPassword.set('');
      this.editPasswordConfirm.set('');
      this.success.set('Compte mis à jour.');
    } catch (e) {
      console.error('account update failed', e);
      this.error.set(errorMessage(e, 'Échec de la mise à jour du compte. Réessayez.'));
    } finally {
      this.saving.set(false);
    }
  }
}
