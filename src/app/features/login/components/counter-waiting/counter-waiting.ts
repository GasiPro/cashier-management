import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-counter-waiting',
  standalone: true,
  templateUrl: './counter-waiting.html',
})
export class CounterWaiting {
  /** False: waiting for the cashier's approval. True: the request was refused, blocked or failed. */
  readonly rejected = input(false);
  readonly username = input('');
  readonly wsUrl = input('');
  readonly error = input('');

  readonly cancelled = output<void>();
  readonly retry = output<void>();
}
