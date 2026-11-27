import { Injectable, computed, signal } from '@angular/core';
import { errorMessage } from '../../core/error/error-messages';
import { getPricingMatrix } from './pricing.api';
import type { ServiceItem } from './pricing.model';
import { translate } from '../../core/i18n/translate';
import { activeLocale } from '../../core/i18n/locale';
@Injectable({ providedIn: 'root' })
export class PricingStore {
  readonly items = signal<ServiceItem[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly categories = computed<string[]>(() => {
    const set = new Set(this.items().map((i) => i.category).filter((c) => c.trim().length > 0));
    return Array.from(set).sort((a, b) => a.localeCompare(b, activeLocale()));
  });
  readonly serviceCount = computed(() => this.items().filter((i) => i.type === 'service').length);
  readonly productCount = computed(() => this.items().filter((i) => i.type === 'product').length);
  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      this.items.set(await getPricingMatrix());
    } catch (e) {
      console.error('failed to load pricing matrix', e);
      this.loadError.set(errorMessage(e, translate('Impossible de charger la grille tarifaire.')));
    } finally {
      this.loading.set(false);
    }
  }
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
