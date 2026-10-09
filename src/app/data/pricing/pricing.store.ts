import { Injectable, computed, signal } from '@angular/core';
import { errorMessage } from '../../core/error/error-messages';
import { getPricingMatrix } from './pricing.api';
import type { ServiceItem } from './pricing.model';

@Injectable({ providedIn: 'root' })
export class PricingStore {
  readonly items = signal<ServiceItem[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');

  readonly categories = computed<string[]>(() => {
    const set = new Set(this.items().map((i) => i.category).filter((c) => c.trim().length > 0));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  });
  readonly serviceCount = computed(() => this.items().filter((i) => i.type === 'service').length);
  readonly productCount = computed(() => this.items().filter((i) => i.type === 'product').length);

  /** Admin side: loads the catalogue through the Tauri command. */
  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      this.items.set(await getPricingMatrix());
    } catch (e) {
      console.error('failed to load pricing matrix', e);
      this.loadError.set(errorMessage(e, 'Impossible de charger la grille tarifaire.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Counter side: the catalogue arrives from the cashier's server over the WebSocket (`pricing`). */
  applyPricing(items: ServiceItem[]): void {
    this.items.set(items);
  }

  addItem(item: ServiceItem): void {
    this.items.update((list) => [item, ...list]);
  }

  replaceItem(item: ServiceItem): void {
    this.items.update((list) => list.map((i) => (i.id === item.id ? item : i)));
  }

  removeItem(id: string): void {
    this.items.update((list) => list.filter((i) => i.id !== id));
  }
}
