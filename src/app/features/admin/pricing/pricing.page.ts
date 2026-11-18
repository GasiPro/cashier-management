import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/error/error-messages';
import * as pricingApi from '../../../data/pricing/pricing.api';
import type {
  CurrencyInfo,
  MorInput,
  PriceAdjustmentKind,
  PriceHistoryEntry,
  PriceLogEntry,
  PricePeak,
  PriceRule,
  PricingItemType,
  ServiceItem,
} from '../../../data/pricing/pricing.model';
import { Badge, BadgeTone } from '../../../shared/ui/badge/badge';
type PricingTab = 'price' | 'history' | 'log' | 'currency';
interface MorDraft {
  rate: number | null;
  days: number | null;
  max_orders: number | null;
}
type MorDrafts = Record<PriceAdjustmentKind, MorDraft | null>;
const MOR_KINDS: PriceAdjustmentKind[] = ['majoration', 'reduction'];
const MOR_LABELS: Record<PriceAdjustmentKind, string> = { majoration: 'majoration', reduction: 'réduction' };
const MAX_RATE = 100;
const MAX_DAYS = 3650;
const MAX_ORDERS = 1_000_000;
const DAY_MS = 86_400_000;
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
  readonly morKinds = MOR_KINDS;
  readonly morLabels = MOR_LABELS;
  readonly maxCurrencyNameLen = MAX_CURRENCY_NAME_LEN;
  items = signal<ServiceItem[]>([]);
  history = signal<PriceHistoryEntry[]>([]);
  log = signal<PriceLogEntry[]>([]);
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
    { value: 'log', label: 'Journal', count: String(this.log().length) },
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
      const [items, history, log, currency] = await Promise.all([
        pricingApi.getPricingMatrix(),
        pricingApi.getPriceHistory(),
        pricingApi.getPriceLog(),
        pricingApi.getCurrency(),
      ]);
      this.items.set(items);
      this.history.set(history);
      this.log.set(log);
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
  private async refreshLog(): Promise<void> {
    try {
      this.log.set(await pricingApi.getPriceLog());
    } catch (e) {
      console.error('failed to refresh price log', e);
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
    if (tab === 'log') void this.refreshLog();
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
  logLabel(entry: PriceLogEntry): string {
    if (entry.action === 'price_changed') {
      return `Prix : ${this.money(entry.before ?? 0)} → ${this.money(entry.after ?? 0)} ${this.currency()}`;
    }
    const kind = entry.kind ? MOR_LABELS[entry.kind] : 'MOR';
    return entry.before === null
      ? `Ajout ${kind} : ${entry.after} %`
      : `Modification ${kind} : ${entry.before} % → ${entry.after} %`;
  }
  limitPrice(price: number, rate: number, kind: PriceAdjustmentKind): number {
    const delta = Math.round((price * rate) / 100);
    return kind === 'majoration' ? price + delta : Math.max(0, price - delta);
  }
  ruleInfo(rule: PriceRule): string {
    const parts: string[] = [];
    if (rule.max_orders !== null) parts.push(`${rule.used_orders}/${rule.max_orders} commande(s)`);
    if (rule.days !== null) {
      const end = new Date(new Date(rule.created_at).getTime() + rule.days * DAY_MS);
      parts.push(`jusqu'au ${Number.isNaN(end.getTime()) ? '—' : end.toLocaleDateString('fr-FR')}`);
    }
    return parts.length ? parts.join(' · ') : 'Sans limite';
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
  editPriceEditable = signal(false);
  drafts = signal<MorDrafts>({ majoration: null, reduction: null });
  savingId = signal<string | null>(null);
  editError = signal('');
  startEdit(item: ServiceItem): void {
    this.editingId.set(item.id);
    this.editPrice.set(item.price);
    this.editPriceEditable.set(item.price_editable);
    this.drafts.set({ majoration: this.draftOf(item.majoration), reduction: this.draftOf(item.reduction) });
    this.editError.set('');
    setTimeout(() => document.getElementById(`pricing-price-${item.id}`)?.focus());
  }
  private draftOf(rule: PriceRule | null): MorDraft | null {
    return rule ? { rate: rule.rate, days: rule.days, max_orders: rule.max_orders } : null;
  }
  toggleEditable(): void {
    this.editPriceEditable.update((value) => !value);
  }
  addDraft(kind: PriceAdjustmentKind): void {
    this.drafts.update((d) => ({ ...d, [kind]: { rate: null, days: null, max_orders: null } }));
    setTimeout(() => document.getElementById(`pricing-${kind}-rate`)?.focus());
  }
  removeDraft(kind: PriceAdjustmentKind): void {
    this.drafts.update((d) => ({ ...d, [kind]: null }));
  }
  setDraft(kind: PriceAdjustmentKind, field: keyof MorDraft, value: number | null): void {
    this.drafts.update((d) => {
      const current = d[kind];
      return current ? { ...d, [kind]: { ...current, [field]: value ?? null } } : d;
    });
  }
  private draftError(kind: PriceAdjustmentKind, draft: MorDraft): string {
    const label = MOR_LABELS[kind];
    const { rate, days, max_orders } = draft;
    if (rate === null || !Number.isInteger(rate) || rate < 1 || rate > MAX_RATE) {
      return `Taux de ${label} : entier entre 1 et ${MAX_RATE} %.`;
    }
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_DAYS)) {
      return `Durée de ${label} : entier entre 1 et ${MAX_DAYS} jours, ou vide.`;
    }
    if (max_orders !== null && (!Number.isInteger(max_orders) || max_orders < 1 || max_orders > MAX_ORDERS)) {
      return `Commandes de ${label} : entier entre 1 et ${MAX_ORDERS.toLocaleString('fr-FR')}, ou vide.`;
    }
    return '';
  }
  private sameRule(rule: PriceRule | null, draft: MorDraft): boolean {
    return !!rule && rule.rate === draft.rate && rule.days === draft.days && rule.max_orders === draft.max_orders;
  }
  async deleteRule(item: ServiceItem, kind: PriceAdjustmentKind): Promise<void> {
    if (this.savingId()) return;
    this.savingId.set(item.id);
    this.setStatus('', false);
    try {
      const updated = await pricingApi.deleteMor(item.id, kind);
      this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
      this.drafts.update((d) => ({ ...d, [kind]: null }));
      this.setStatus(`Tarif « ${updated.label} » : ${MOR_LABELS[kind]} supprimée.`, false);
    } catch (e) {
      console.error('mor_delete failed', e);
      this.editError.set(errorMessage(e, 'Échec de la suppression. Réessayez.'));
    } finally {
      this.savingId.set(null);
    }
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
    const editable = this.editPriceEditable();
    const drafts = this.drafts();
    const inputs: Record<PriceAdjustmentKind, MorInput | null> = { majoration: null, reduction: null };
    if (editable) {
      for (const kind of MOR_KINDS) {
        const draft = drafts[kind];
        if (!draft) continue;
        const error = this.draftError(kind, draft);
        if (error) {
          this.editError.set(error);
          return;
        }
        if (!this.sameRule(item[kind], draft)) {
          inputs[kind] = { rate: draft.rate as number, days: draft.days, max_orders: draft.max_orders };
        }
      }
    }
    this.editError.set('');
    this.savingId.set(item.id);
    this.setStatus('', false);
    try {
      let updated = await pricingApi.updatePricingItem(item.id, {
        price,
        price_editable: editable,
        majoration: inputs.majoration,
        reduction: inputs.reduction,
      });
      if (editable) {
        for (const kind of MOR_KINDS) {
          if (!drafts[kind] && updated[kind]) updated = await pricingApi.deleteMor(item.id, kind);
        }
      }
      this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
      this.editingId.set(null);
      this.setStatus(`Tarif « ${updated.label} » mis à jour.`, false);
      void this.refreshLog();
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
