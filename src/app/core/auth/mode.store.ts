import { Injectable, signal } from '@angular/core';
import { getMode, setMode } from '../../data/settings/settings.api';
import { AppMode } from '../../data/settings/settings.model';
@Injectable({ providedIn: 'root' })
export class ModeStore {
  readonly mode = signal<AppMode | null>(null);
  /** The mode is permanent once chosen, so a defined value is read from the backend only once. */
  async load(): Promise<AppMode | null> {
    if (this.mode()) return this.mode();
    try {
      this.mode.set(await getMode());
    } catch (e) {
      console.error('failed to read app mode', e);
    }
    return this.mode();
  }
  async choose(value: AppMode): Promise<void> {
    this.mode.set(await setMode(value));
  }
}
