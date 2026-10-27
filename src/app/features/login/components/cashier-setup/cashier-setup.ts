import { Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { withRetryCountdown } from '../../../../shared/utils/retry-countdown';
@Component({
  selector: 'app-cashier-setup',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './cashier-setup.html',
})
export class CashierSetup {
  readonly username = model('');
  readonly password = model('');
  /** Toggles the password field between masked and plain text. */
  readonly showPassword = model(false);
  /** Inline validation or server error, announced via aria-live. */
  readonly error = input('');
  /** Server error, with "dans N seconde(s)" lock messages counting down live. */
  readonly errorText = withRetryCountdown(this.error);
  readonly loadingAddress = input(false);
  /** Address to share with the counters. */
  readonly address = input('');
  readonly authenticating = input(false);
  readonly back = output<void>();
  readonly submitted = output<void>();
  readonly copyAddress = output<void>();
  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }
}
