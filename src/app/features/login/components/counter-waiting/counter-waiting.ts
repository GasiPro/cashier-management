import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
@Component({
  imports: [TranslatePipe],
  selector: 'app-counter-waiting',
  standalone: true,
  templateUrl: './counter-waiting.html',
})
export class CounterWaiting {
  readonly rejected = input(false);
  readonly username = input('');
  readonly wsUrl = input('');
  readonly error = input('');
  readonly cancelled = output<void>();
  readonly retry = output<void>();
}
