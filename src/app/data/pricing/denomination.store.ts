import { Injectable, signal } from '@angular/core';
import { getDenominations } from './pricing.api';
@Injectable({ providedIn: 'root' })
export class DenominationStore {
  readonly values = signal<number[]>([]);
  async load(): Promise<void> {
    try {
      this.values.set(await getDenominations());
    } catch (e) {
      console.error('failed to load denominations', e);
    }
  }
}
