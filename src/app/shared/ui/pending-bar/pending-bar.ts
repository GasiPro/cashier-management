import { Component, inject, output } from '@angular/core';
import { PendingStore } from '../../../data/pending/pending.store';
@Component({
  selector: 'app-pending-bar',
  standalone: true,
  templateUrl: './pending-bar.html',
})
export class PendingBar {
  readonly store = inject(PendingStore);
  readonly applied = output<void>();
  async apply(): Promise<void> {
    if (await this.store.apply()) this.applied.emit();
  }
}
