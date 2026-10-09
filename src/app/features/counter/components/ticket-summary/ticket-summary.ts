import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CounterStore } from '../../counter.store';
@Component({
  selector: 'app-ticket-summary',
  standalone: true,
  imports: [CommonModule, FormsModule],
  host: { class: 'contents' },
  templateUrl: './ticket-summary.html',
})
export class TicketSummary {
  constructor(public store: CounterStore) {}
}
