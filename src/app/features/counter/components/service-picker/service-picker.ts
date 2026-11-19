import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterStore } from '../../counter.store';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
@Component({
  selector: 'app-service-picker',
  standalone: true,
  imports: [CommonModule, MoneyPipe],
  host: { class: 'contents' },
  templateUrl: './service-picker.html',
})
export class ServicePicker {
  constructor(public store: CounterStore) {}
}
