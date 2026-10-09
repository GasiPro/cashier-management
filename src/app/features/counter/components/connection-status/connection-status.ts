import { Component } from '@angular/core';
import { CounterStore } from '../../counter.store';
@Component({
  selector: 'app-connection-status',
  standalone: true,
  host: { class: 'contents' },
  templateUrl: './connection-status.html',
})
export class ConnectionStatus {
  constructor(public store: CounterStore) {}
}
