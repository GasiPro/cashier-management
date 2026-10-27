import { Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { withRetryCountdown } from '../../../../shared/utils/retry-countdown';
@Component({
  selector: 'app-counter-setup',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './counter-setup.html',
})
export class CounterSetup {
  readonly username = model('');
  readonly password = model('');
  readonly wsUrl = model('');
  /** Toggles the password field between masked and plain text. */
  readonly showPassword = model(false);
  /** Inline validation or server error, announced via aria-live. */
  readonly error = input('');
  /** Server error, with "dans N seconde(s)" lock messages counting down live. */
  readonly errorText = withRetryCountdown(this.error);
  /** Result of probing the cashier address for a running server, shown as a hint/warning. */
  readonly addressCheck = input<'idle' | 'checking' | 'reachable' | 'unreachable'>('idle');
  readonly connecting = input(false);
  readonly back = output<void>();
  readonly submitted = output<void>();
  readonly urlChanged = output<void>();
  readonly urlBlurred = output<void>();
  readonly pingRequested = output<void>();
  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }
}
