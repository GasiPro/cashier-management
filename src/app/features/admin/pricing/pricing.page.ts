import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/error/error-messages';
import * as pricingApi from '../../../data/pricing/pricing.api';
import type {
  CurrencyInfo,
  PriceAdjustmentKind,
  PriceHistoryEntry,
  PricePeak,
  PricingItemType,
  ServiceItem,
} from '../../../data/pricing/pricing.model';
import { Badge, BadgeTone } from '../../../shared/ui/badge/badge';
type PricingTab = 'price' | 'history' | 'currency';
type TypeFilter = 'all' | PricingItemType;
type SortKey = 'category' | 'label' | 'price-asc' | 'price-desc';
const KIND_BADGES: Record<PriceAdjustmentKind, { label: string; tone: BadgeTone }> = {
  majoration: { label: 'Majoration', tone: 'warning' },
  reduction: { label: 'Réduction', tone: 'info' },
};
const PEAK_BADGES: Record<PricePeak, { label: string; tone: BadgeTone }> = {
  highest: { label: 'Pic le plus haut', tone: 'danger' },
  lowest: { label: 'Pic le plus bas', tone: 'success' },
};
const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'service', label: 'Services' },
  { value: 'product', label: 'Produits' },
];
const CURRENCY_CODE_PATTERN = /^[A-Za-z]{2,6}$/;
const MAX_CURRENCY_NAME_LEN = 40;
const COPIED_FEEDBACK_MS = 1500;
@Component({
  selector: 'app-admin-pricing',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, Badge],
  templateUrl: './pricing.page.html',
})
export class PricingPage implements OnInit, OnDestroy {
  readonly typeFilters = TYPE_FILTERS;
  readonly kindBadges = KIND_BADGES;
  readonly peakBadges = PEAK_BADGES;
  readonly maxCurrencyNameLen = MAX_CURRENCY_NAME_LEN;
  items = signal<ServiceItem[]>([]);
  history = signal<PriceHistoryEntry[]>([]);
  currencyInfo = signal<CurrencyInfo | null>(null);
  loading = signal(true);
  loadError = signal('');
  tab = signal<PricingTab>('price');
  statusMessage = signal('');
  statusIsError = signal(false);
  copied = signal<string | null>(null);
  private copiedTimer?: ReturnType<typeof setTimeout>;
  readonly currency = computed(() => this.currencyInfo()?.selected ?? '');
  readonly tabs = computed<{ value: PricingTab; label: string; count: string }[]>(() => [
    { value: 'price', label: 'Prix', count: String(this.items().length) },
    { value: 'history', label: 'Historique', count: String(this.history().length) },
    { value: 'currency', label: 'Devise', count: this.currency() },
  ]);
  ngOnInit(): void {
    void this.load();
  }
  ngOnDestroy(): void {
    clearTimeout(this.copiedTimer);
  }
  reload(): void {
    void this.load();
  }
  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const [items, history, currency] = await Promise.all([
        pricingApi.getPricingMatrix(),
        pricingApi.getPriceHistory(),
        pricingApi.getCurrency(),
      ]);
      this.items.set(items);
      this.history.set(history);
      this.currencyInfo.set(currency);
      this.currencyChoice.set(currency.selected);
    } catch (e) {
      console.error('failed to load pricing', e);
      this.loadError.set(errorMessage(e, 'Impossible de charger la grille tarifaire.'));
    } finally {
      this.loading.set(false);
    }
  }
  private async refreshHistory(): Promise<void> {
    try {
      this.history.set(await pricingApi.getPriceHistory());
    } catch (e) {
      console.error('failed to refresh price history', e);
    }
  }
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }
  setTab(tab: PricingTab): void {
    this.tab.set(tab);
    this.editingId.set(null);
    this.setStatus('', false);
    if (tab === 'history') void this.refreshHistory();
  }
  async copy(key: string, value: string | number): Promise<void> {
    try {
      await navigator.clipboard.writeText(String(value));
      this.copied.set(key);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(null), COPIED_FEEDBACK_MS);
    } catch (e) {
      console.error('failed to copy id', e);
      this.setStatus("Impossible de copier l'ID.", true);
    }
  }
  money(value: number): string {
    return value.toLocaleString('fr-FR');
  }
  formatAt(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  typeLabel(type: PricingItemType): string {
    return type === 'service' ? 'Service' : 'Produit';
  }
  typeTone(type: PricingItemType): BadgeTone {
    return type === 'service' ? 'brand' : 'success';
  }
  deltaLabel(entry: PriceHistoryEntry): string {
    const delta = entry.applied_price - entry.normal_price;
    return `${delta > 0 ? '+' : ''}${this.money(delta)}`;
  }
  typeFilter = signal<TypeFilter>('all');
  categoryFilter = signal<string>('all');
  searchTerm = signal('');
  sortKey = signal<SortKey>('category');
  readonly visibleCategories = computed<string[]>(() => {
    const type = this.typeFilter();
    const set = new Set(
      this.items()
        .filter((i) => type === 'all' || i.type === type)
        .map((i) => i.category)
        .filter((c) => c.trim().length > 0),
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  });
  private readonly effectiveCategory = computed<string>(() => {
    const category = this.categoryFilter();
    return category === 'all' || this.visibleCategories().includes(category) ? category : 'all';
  });
  readonly serviceCount = computed(() => this.items().filter((i) => i.type === 'service').length);
  readonly productCount = computed(() => this.items().filter((i) => i.type === 'product').length);
  setTypeFilter(type: TypeFilter): void {
    this.typeFilter.set(type);
    this.categoryFilter.set('all');
  }
  isTypeFilterActive(type: TypeFilter): boolean {
    return this.typeFilter() === type;
  }
  setCategoryFilter(category: string): void {
    this.categoryFilter.set(category);
  }
  isCategoryFilterActive(category: string): boolean {
    return this.effectiveCategory() === category;
  }
  readonly filtersActive = computed(
    () => this.typeFilter() !== 'all' || this.effectiveCategory() !== 'all' || this.searchTerm().trim().length > 0,
  );
  resetFilters(): void {
    this.typeFilter.set('all');
    this.categoryFilter.set('all');
    this.searchTerm.set('');
  }
  readonly filteredItems = computed<ServiceItem[]>(() => {
    const type = this.typeFilter();
    const category = this.effectiveCategory();
    const term = this.searchTerm().trim().toLowerCase();
    const sort = this.sortKey();
    const list = this.items().filter((item) => {
      if (type !== 'all' && item.type !== type) return false;
      if (category !== 'all' && item.category !== category) return false;
      if (term && !item.label.toLowerCase().includes(term) && !item.category.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'price-asc':
          return a.price - b.price;
        case 'price-desc':
          return b.price - a.price;
        case 'label':
          return a.label.localeCompare(b.label, 'fr');
        case 'category':
        default:
          return a.category.localeCompare(b.category, 'fr') || a.label.localeCompare(b.label, 'fr');
      }
    });
  });
  editingId = signal<string | null>(null);
  editPrice = signal<number | null>(null);
  editMajoration = signal(true);
  editReduction = signal(true);
  editPriceEditable = signal(true);
  savingId = signal<string | null>(null);
  editError = signal('');
  startEdit(item: ServiceItem): void {
    this.editingId.set(item.id);
    this.editPrice.set(item.price);
    this.editMajoration.set(item.allow_majoration);
    this.editReduction.set(item.allow_reduction);
    this.editPriceEditable.set(item.price_editable);
    this.editError.set('');
    setTimeout(() => document.getElementById(`pricing-price-${item.id}`)?.focus());
  }
  toggleEdit(key: 'majoration' | 'reduction' | 'editable'): void {
    const target =
      key === 'majoration' ? this.editMajoration : key === 'reduction' ? this.editReduction : this.editPriceEditable;
    target.update((value) => !value);
  }
  cancelEdit(): void {
    const id = this.editingId();
    this.editingId.set(null);
    this.editError.set('');
    if (id) document.getElementById(`pricing-edit-btn-${id}`)?.focus();
  }
  async saveEdit(item: ServiceItem): Promise<void> {
    if (this.savingId()) return;
    const price = this.editPrice();
    if (price === null || Number.isNaN(price)) {
      this.editError.set('Le prix est obligatoire.');
      return;
    }
    if (price < 0) {
      this.editError.set('Le prix ne peut pas être négatif.');
      return;
    }
    if (!Number.isInteger(price)) {
      this.editError.set('Le prix doit être un nombre entier.');
      return;
    }
    this.editError.set('');
    this.savingId.set(item.id);
    this.setStatus('', false);
    try {
      const updated = await pricingApi.updatePricingItem(item.id, {
        price,
        allow_majoration: this.editMajoration(),
        allow_reduction: this.editReduction(),
        price_editable: this.editPriceEditable(),
      });
      this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
      this.editingId.set(null);
      this.setStatus(`Tarif « ${updated.label} » mis à jour.`, false);
      document.getElementById(`pricing-edit-btn-${updated.id}`)?.focus();
    } catch (e) {
      console.error('item_update failed', e);
      this.editError.set(errorMessage(e, 'Échec de la mise à jour du tarif. Réessayez.'));
    } finally {
      this.savingId.set(null);
    }
  }
  currencyChoice = signal('');
  customCode = signal('');
  customName = signal('');
  savingCurrency = signal(false);
  currencyError = signal('');
  async saveCurrency(): Promise<void> {
    const code = this.currencyChoice();
    if (!code || code === this.currency()) return;
    await this.applyCurrency(code, null);
  }
  async addCustomCurrency(): Promise<void> {
    const code = this.customCode().trim();
    const name = this.customName().trim();
    if (!CURRENCY_CODE_PATTERN.test(code)) {
      this.currencyError.set('Code invalide : 2 à 6 lettres attendues (ex. : USD, EUR, MGA).');
      return;
    }
    if (name.length > MAX_CURRENCY_NAME_LEN) {
      this.currencyError.set('Le nom de la devise est trop long.');
      return;
    }
    if (await this.applyCurrency(code.toUpperCase(), name || null)) {
      this.customCode.set('');
      this.customName.set('');
    }
  }
  private async applyCurrency(code: string, name: string | null): Promise<boolean> {
    if (this.savingCurrency()) return false;
    this.currencyError.set('');
    this.savingCurrency.set(true);
    this.setStatus('', false);
    try {
      const info = await pricingApi.setCurrency(code, name);
      this.currencyInfo.set(info);
      this.currencyChoice.set(info.selected);
      this.setStatus(`Devise « ${info.selected} » enregistrée.`, false);
      return true;
    } catch (e) {
      console.error('currency_set failed', e);
      this.currencyError.set(errorMessage(e, 'Échec de l\'enregistrement de la devise. Réessayez.'));
      return false;
    } finally {
      this.savingCurrency.set(false);
    }
  }
}
