import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CounterStore } from '../../counter.store';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
@Component({
  selector: 'app-order-history-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MoneyPipe, TranslatePipe],
  host: { class: 'contents' },
  templateUrl: './order-history-panel.html',
})
export class OrderHistoryPanel {
  constructor(public store: CounterStore) {}
}
