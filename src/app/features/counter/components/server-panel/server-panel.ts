import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CounterStore } from '../../counter.store';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
@Component({
  selector: 'app-server-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  host: { class: 'contents' },
  templateUrl: './server-panel.html',
})
export class ServerPanel {
  constructor(public store: CounterStore) {}
}
