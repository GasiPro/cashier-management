import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterStore } from '../../counter.store';
@Component({
  selector: 'app-service-picker',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'contents' },
  templateUrl: './service-picker.html',
})
export class ServicePicker {
  constructor(public store: CounterStore) {}
}
