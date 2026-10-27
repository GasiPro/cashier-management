import { Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { withRetryCountdown } from '../../../../shared/utils/retry-countdown';
@Component({
  selector: 'app-admin-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './admin-modal.html',
})
export class AdminModal {
  readonly username = model('');
  readonly password = model('');
  readonly showPassword = model(false);
  readonly error = input('');
  /** Server error, with "dans N seconde(s)" lock messages counting down live. */
  readonly errorText = withRetryCountdown(this.error);
  readonly authenticating = input(false);
  readonly closed = output<void>();
  readonly submitted = output<void>();
  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }
}
