import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CounterStore } from '../../counter.store';
@Component({
  selector: 'app-account-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  host: { class: 'contents' },
  templateUrl: './account-panel.html',
})
export class AccountPanel {
  constructor(public store: CounterStore) {}
}
