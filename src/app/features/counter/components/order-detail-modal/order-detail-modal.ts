import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterStore } from '../../counter.store';
@Component({
  selector: 'app-order-detail-modal',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'contents' },
  templateUrl: './order-detail-modal.html',
})
export class OrderDetailModal {
  constructor(public store: CounterStore) {}
}
