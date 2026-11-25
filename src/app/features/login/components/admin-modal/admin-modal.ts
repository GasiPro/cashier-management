import { Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { withRetryCountdown } from '../../../../shared/utils/retry-countdown';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
@Component({
  selector: 'app-admin-modal',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './admin-modal.html',
})
export class AdminModal {
  readonly username = model('');
  readonly password = model('');
  readonly showPassword = model(false);
  readonly error = input('');
  readonly errorText = withRetryCountdown(this.error);
  readonly authenticating = input(false);
  readonly closed = output<void>();
  readonly submitted = output<void>();
  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }
}
