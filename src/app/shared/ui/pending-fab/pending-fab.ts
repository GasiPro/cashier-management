import { Component, inject, input, output, signal } from '@angular/core';
import { PendingStore } from '../../../data/pending/pending.store';
import { Badge } from '../badge/badge';
import { TranslatePipe } from '../../pipes/translate.pipe';
@Component({
  selector: 'app-pending-fab',
  standalone: true,
  imports: [Badge, TranslatePipe],
  templateUrl: './pending-fab.html',
})
export class PendingFab {
  readonly store = inject(PendingStore);
  readonly slot = input<1 | 2>(1);
  readonly applied = output<void>();
  readonly open = signal(false);
  show(): void {
    this.open.set(true);
    this.store.markSeen();
    setTimeout(() => document.getElementById('pending-primary-btn')?.focus());
  }
  close(): void {
    if (this.store.applying()) return;
    this.open.set(false);
    setTimeout(() => document.getElementById('pending-fab-btn')?.focus());
  }
  remove(key: string): void {
    this.store.unstage(key);
    this.closeIfEmpty();
  }
  discardAll(): void {
    this.store.discard();
    this.closeIfEmpty();
  }
  async submit(): Promise<void> {
    if (this.store.phase() === 'editing') {
      this.store.save();
      return;
    }
    if (await this.store.apply()) this.applied.emit();
    this.closeIfEmpty();
  }
  private closeIfEmpty(): void {
    if (this.store.count() === 0) this.open.set(false);
  }
}
