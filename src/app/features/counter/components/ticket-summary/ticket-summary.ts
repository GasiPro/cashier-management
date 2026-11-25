import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CounterStore } from '../../counter.store';
import { CurrencyStore } from '../../../../data/pricing/currency.store';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
@Component({
  selector: 'app-ticket-summary',
  standalone: true,
  imports: [CommonModule, FormsModule, MoneyPipe, TranslatePipe],
  host: { class: 'contents' },
  templateUrl: './ticket-summary.html',
})
export class TicketSummary {
  constructor(public store: CounterStore, public currency: CurrencyStore) {}
}
