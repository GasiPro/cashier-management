import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CounterStore } from '../../counter.store';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
@Component({
  selector: 'app-account-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  host: { class: 'contents' },
  templateUrl: './account-panel.html',
})
export class AccountPanel {
  constructor(public store: CounterStore) {}
}
