import { Injectable, computed, signal } from '@angular/core';
import { errorMessage } from '../../core/error/error-messages';
import { publishNotice } from '../notice/notice.api';
export interface PendingChange<T = unknown> {
  key: string;
  payload: T;
  counter: string[];
  cashier: string[];
  apply: () => Promise<void>;
}
export type PendingPhase = 'editing' | 'saved';
@Injectable({ providedIn: 'root' })
export class PendingStore {
  readonly changes = signal<PendingChange[]>([]);
  readonly phase = signal<PendingPhase>('editing');
  readonly applying = signal(false);
  readonly error = signal('');
  readonly count = computed(() => this.changes().length);
  readonly briefing = computed(() => [...new Set(this.changes().flatMap((c) => [...c.counter, ...c.cashier]))]);
  get<T>(key: string): PendingChange<T> | undefined {
    return this.changes().find((c) => c.key === key) as PendingChange<T> | undefined;
  }
  has(prefix: string): boolean {
    return this.changes().some((c) => c.key.startsWith(prefix));
  }
  stage(change: PendingChange): void {
    if (this.applying()) return;
    this.changes.update((list) => [...list.filter((c) => c.key !== change.key), change]);
    this.phase.set('editing');
    this.error.set('');
  }
  unstage(key: string): void {
    if (this.applying()) return;
    this.changes.update((list) => list.filter((c) => c.key !== key));
    if (this.changes().length === 0) this.phase.set('editing');
  }
  save(): void {
    if (this.count() > 0 && !this.applying()) this.phase.set('saved');
  }
  discard(): void {
    if (this.applying()) return;
    this.changes.set([]);
    this.phase.set('editing');
    this.error.set('');
  }
  async apply(): Promise<boolean> {
    if (this.applying() || this.phase() !== 'saved' || this.count() === 0) return false;
    this.applying.set(true);
    this.error.set('');
    const done: PendingChange[] = [];
    try {
      for (const change of this.changes()) {
        await change.apply();
        done.push(change);
      }
    } catch (e) {
      console.error('pending apply failed', e);
      this.error.set(errorMessage(e, "Échec de l'application des modifications. Réessayez."));
    }
    if (done.length > 0) {
      this.changes.update((list) => list.filter((c) => !done.includes(c)));
      if (this.changes().length === 0) this.phase.set('editing');
      try {
        await publishNotice(
          done.flatMap((c) => c.counter),
          done.flatMap((c) => c.cashier),
        );
      } catch (e) {
        console.error('notice publish failed', e);
      }
    }
    this.applying.set(false);
    return done.length > 0;
  }
}
