import { Injectable, computed, signal } from '@angular/core';
import { errorMessage } from '../../core/error/error-messages';
import { publishNotice } from '../notice/notice.api';
import { translate } from '../../core/i18n/translate';
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
  readonly applying = signal(false);
  readonly error = signal('');
  /** True when edits were staged since the pending list was last opened. */
  readonly hasNew = signal(false);
  private readonly savedKeys = signal<string[]>([]);
  readonly count = computed(() => this.changes().length);
  readonly phase = computed<PendingPhase>(() =>
    this.count() > 0 && this.changes().every((c) => this.savedKeys().includes(c.key)) ? 'saved' : 'editing',
  );
  get<T>(key: string): PendingChange<T> | undefined {
    return this.changes().find((c) => c.key === key) as PendingChange<T> | undefined;
  }
  isSaved(key: string): boolean {
    return this.savedKeys().includes(key);
  }
  has(prefix: string): boolean {
    return this.changes().some((c) => c.key.startsWith(prefix));
  }
  stage(change: PendingChange): void {
    if (this.applying()) return;
    this.changes.update((list) => [...list.filter((c) => c.key !== change.key), change]);
    this.savedKeys.update((keys) => keys.filter((k) => k !== change.key));
    this.hasNew.set(true);
    this.error.set('');
  }
  unstage(key: string): void {
    if (this.applying()) return;
    this.changes.update((list) => list.filter((c) => c.key !== key));
    this.savedKeys.update((keys) => keys.filter((k) => k !== key));
    if (this.count() === 0) this.hasNew.set(false);
  }
  /** Marks one edit (or all of them when no key is given) as saved. */
  save(key?: string): void {
    if (this.applying()) return;
    const keys = key ? [key] : this.changes().map((c) => c.key);
    this.savedKeys.update((list) => [...new Set([...list, ...keys])]);
  }
  markSeen(): void {
    this.hasNew.set(false);
  }
  discard(): void {
    if (this.applying()) return;
    this.changes.set([]);
    this.savedKeys.set([]);
    this.hasNew.set(false);
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
      this.error.set(errorMessage(e, translate('Échec de l\'application des modifications. Réessayez.')));
    }
    if (done.length > 0) {
      this.changes.update((list) => list.filter((c) => !done.includes(c)));
      this.savedKeys.update((keys) => keys.filter((k) => this.changes().some((c) => c.key === k)));
      if (this.count() === 0) this.hasNew.set(false);
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
