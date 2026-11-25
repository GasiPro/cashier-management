import { Component } from '@angular/core';
import { CounterStore } from '../../counter.store';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
@Component({
  imports: [TranslatePipe],
  selector: 'app-connection-overlay',
  standalone: true,
  host: { class: 'contents' },
  templateUrl: './connection-overlay.html',
})
export class ConnectionOverlay {
  constructor(public store: CounterStore) {}
}
