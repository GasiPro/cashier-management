import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CounterStore } from '../../counter.store';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
@Component({
  selector: 'app-order-history',
  standalone: true,
  imports: [CommonModule, FormsModule, MoneyPipe],
  host: { class: 'contents' },
  templateUrl: './order-history.html',
})
export class OrderHistory {
  constructor(public store: CounterStore) {}
}
