import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterStore } from '../../counter.store';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
@Component({
  selector: 'app-order-detail-modal',
  standalone: true,
  imports: [CommonModule, MoneyPipe],
  host: { class: 'contents' },
  templateUrl: './order-detail-modal.html',
})
export class OrderDetailModal {
  constructor(public store: CounterStore) {}
}
