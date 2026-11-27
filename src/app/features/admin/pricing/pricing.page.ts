import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { clockNow, localeDate, localeDateTime } from '../../../core/display/datetime-settings';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/error/error-messages';
import { PendingStore } from '../../../data/pending/pending.store';
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
import { PendingFab } from '../../../shared/ui/pending-fab/pending-fab';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { translate } from '../../../core/i18n/translate';
import { activeLocale } from '../../../core/i18n/locale';
type PricingTab = 'price' | 'currency' | 'money' | 'journal';
interface JournalEntry {
  key: string;
  at: string;
  item_id: string;
  service_type: string;
  kind: PriceAdjustmentKind | null;
  history: PriceHistoryEntry | null;
  log: PriceLogEntry | null;
}
interface MorDetails {
  rate: string;
  start: string;
  end: string;
  orders: string;
}
interface MorDraft {
  rate: number | null;
  days: number | null;
  max_orders: number | null;
}
type MorDrafts = Record<PriceAdjustmentKind, MorDraft | null>;
interface CurrencyPatch {
  code: string;
  name: string | null;
}
interface DenominationPatch {
  values: number[];
}
interface PricePatch {
  price: number;
  price_editable: boolean;
  rules: Record<PriceAdjustmentKind, MorInput | null>;
  drops: PriceAdjustmentKind[];
  at: string;
}
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
const RULE_STATUS = {
  active: { label: 'En cours', tone: 'success' },
  expired: { label: 'Expirée', tone: 'danger' },
} as const satisfies Record<string, { label: string; tone: BadgeTone }>;
const RULE_MATCH_TOLERANCE_MS = 5000;
function timeOf(iso: string): number {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? 0 : time;
}
const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'service', label: 'Services' },
  { value: 'product', label: 'Produits' },
];
const CURRENCY_KEY = 'currency';
const DENOMINATIONS_KEY = 'denominations';
const MAX_DENOMINATION = 1_000_000_000;
const CURRENCY_CODE_PATTERN = /^[A-Za-z]{2,6}$/;
const MAX_CURRENCY_NAME_LEN = 40;
const COPIED_FEEDBACK_MS = 1500;
@Component({
  selector: 'app-admin-pricing',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, Badge, PendingFab, TranslatePipe],
  templateUrl: './pricing.page.html',
})
export class PricingPage implements OnInit, OnDestroy {
  readonly typeFilters = TYPE_FILTERS;
  readonly kindBadges = KIND_BADGES;
  readonly peakBadges = PEAK_BADGES;
  readonly morKinds = MOR_KINDS;
  readonly morLabels = MOR_LABELS;
  readonly maxCurrencyNameLen = MAX_CURRENCY_NAME_LEN;
  private readonly pending = inject(PendingStore);
  items = signal<ServiceItem[]>([]);
  readonly viewItems = computed<ServiceItem[]>(() => this.items().map((item) => this.project(item)));
  history = signal<PriceHistoryEntry[]>([]);
  log = signal<PriceLogEntry[]>([]);
  currencyInfo = signal<CurrencyInfo | null>(null);
  denominations = signal<number[]>([]);
  loading = signal(true);
  loadError = signal('');
  tab = signal<PricingTab>('price');
  statusMessage = signal('');
  statusIsError = signal(false);
  copied = signal<string | null>(null);
  private copiedTimer?: ReturnType<typeof setTimeout>;
  readonly currency = computed(() => this.currencyInfo()?.selected ?? '');
  readonly tabs = computed<{ value: PricingTab; label: string; count: string }[]>(() => [
    { value: 'price', label: translate('Prix'), count: String(this.items().length) },
    { value: 'currency', label: translate('Devise'), count: this.currency() },
    { value: 'money', label: translate('Monnaie'), count: String(this.shownDenominations().length) },
    { value: 'journal', label: translate('Journal'), count: String(this.journal().length) },
  ]);
  readonly journal = computed<JournalEntry[]>(() => {
    const fromHistory: JournalEntry[] = this.history().map((h) => ({
      key: 'h' + h.id,
      at: h.at,
      item_id: h.item_id,
      service_type: h.service_type,
      kind: h.kind,
      history: h,
      log: null,
    }));
    const fromLog: JournalEntry[] = this.log().map((l) => ({
      key: 'l' + l.id,
      at: l.at,
      item_id: l.item_id,
      service_type: l.service_type,
      kind: l.kind,
      history: null,
      log: l,
    }));
    return [...fromHistory, ...fromLog].sort((a, b) => timeOf(b.at) - timeOf(a.at));
  });
  expandedKey = signal<string | null>(null);
  ngOnInit(): void {
    void this.load();
  }
  ngOnDestroy(): void {
    clearTimeout(this.copiedTimer);
    this.pending.discard();
  }
  reload(): void {
    void this.load();
  }
  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const [items, history, log, currency, denominations] = await Promise.all([
        pricingApi.getPricingMatrix(),
        pricingApi.getPriceHistory(),
        pricingApi.getPriceLog(),
        pricingApi.getCurrency(),
        pricingApi.getDenominations(),
      ]);
      this.items.set(items);
      this.history.set(history);
      this.log.set(log);
      this.currencyInfo.set(currency);
      this.currencyChoice.set(currency.selected);
      this.denominations.set(denominations);
    } catch (e) {
      console.error('failed to load pricing', e);
      this.loadError.set(errorMessage(e, translate('Impossible de charger la grille tarifaire.')));
    } finally {
      this.loading.set(false);
    }
  }
  private async refreshJournal(): Promise<void> {
    try {
      const [items, history, log] = await Promise.all([
        pricingApi.getPricingMatrix(),
        pricingApi.getPriceHistory(),
        pricingApi.getPriceLog(),
      ]);
      this.items.set(items);
      this.history.set(history);
      this.log.set(log);
    } catch (e) {
      console.error('failed to refresh journal', e);
    }
  }
  private async refreshCurrency(): Promise<void> {
    try {
      const info = await pricingApi.getCurrency();
      this.currencyInfo.set(info);
      this.currencyChoice.set(info.selected);
    } catch (e) {
      console.error('failed to refresh currency', e);
    }
  }
  private async refreshDenominations(): Promise<void> {
    try {
      this.denominations.set(await pricingApi.getDenominations());
    } catch (e) {
      console.error('failed to refresh denominations', e);
    }
  }
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }
  setTab(tab: PricingTab): void {
    this.tab.set(tab);
    this.editingId.set(null);
    this.expandedKey.set(null);
    this.denominationError.set('');
    this.setStatus('', false);
    if (tab === 'journal') void this.refreshJournal();
  }
  toggleEntry(key: string): void {
    this.expandedKey.update((current) => (current === key ? null : key));
  }
  async copy(key: string, value: string | number): Promise<void> {
    try {
      await navigator.clipboard.writeText(String(value));
      this.copied.set(key);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(null), COPIED_FEEDBACK_MS);
    } catch (e) {
      console.error('failed to copy id', e);
      this.setStatus(translate('Impossible de copier l\'ID.'), true);
    }
  }
  money(value: number): string {
    return value.toLocaleString(activeLocale());
  }
  formatAt(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return localeDateTime(date, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  logLabel(entry: PriceLogEntry): string {
    if (entry.action === 'currency_changed') {
      return translate('Devise : {before_code} → {after_code}', { before_code: entry.before_code ?? '—', after_code: entry.after_code ?? '—' });
    }
    if (entry.action === 'price_changed') {
      return translate('Prix : {money} → {money2} {currency}', { money: this.money(entry.before ?? 0), money2: this.money(entry.after ?? 0), currency: this.currency() });
    }
    const kind = entry.kind ? translate(MOR_LABELS[entry.kind]) : 'MOR';
    return entry.before === null
      ? translate('Ajout {kind} : {after} %', { kind: kind, after: entry.after ?? 0 })
      : translate('Modification {kind} : {before} % → {after} %', { kind: kind, before: entry.before, after: entry.after ?? 0 });
  }
  limitPrice(price: number, rate: number, kind: PriceAdjustmentKind): number {
    const delta = Math.round((price * rate) / 100);
    return kind === 'majoration' ? price + delta : Math.max(0, price - delta);
  }
  private ruleEnd(rule: PriceRule): Date | null {
    if (rule.days === null) return null;
    const end = new Date(new Date(rule.created_at).getTime() + rule.days * DAY_MS);
    return Number.isNaN(end.getTime()) ? null : end;
  }
  ruleInfo(rule: PriceRule): string {
    const parts: string[] = [];
    if (rule.max_orders !== null) parts.push(`${rule.used_orders}/${rule.max_orders} commande(s)`);
    if (rule.days !== null) {
      const end = this.ruleEnd(rule);
      parts.push(translate('jusqu\'au {localeDate}', { localeDate: end ? localeDate(end) : '—' }));
    }
    return parts.length ? parts.join(' · ') : translate('Sans limite');
  }
  private matchingRule(entry: JournalEntry): PriceRule | null {
    if (!entry.kind) return null;
    const rule = this.items().find((i) => i.id === entry.item_id)?.[entry.kind] ?? null;
    if (!rule) return null;
    return timeOf(rule.created_at) > timeOf(entry.at) + RULE_MATCH_TOLERANCE_MS ? null : rule;
  }
  ruleStatus(entry: JournalEntry): { label: string; tone: BadgeTone } | null {
    if (!entry.kind) return null;
    const rule = this.matchingRule(entry);
    if (!rule) return RULE_STATUS.expired;
    const byOrders = rule.max_orders !== null && rule.used_orders >= rule.max_orders;
    const end = this.ruleEnd(rule);
    const byDays = end !== null && clockNow().getTime() >= end.getTime();
    return byOrders || byDays ? RULE_STATUS.expired : RULE_STATUS.active;
  }
  morDetails(entry: JournalEntry): MorDetails | null {
    const rule = this.matchingRule(entry);
    if (!rule) return null;
    const end = this.ruleEnd(rule);
    return {
      rate: `${rule.rate} %`,
      start: this.formatAt(rule.created_at),
      end: end ? this.formatAt(end.toISOString()) : translate('Sans limite'),
      orders: rule.max_orders !== null ? `${rule.used_orders}/${rule.max_orders}` : translate('Illimitées'),
    };
  }
  typeLabel(type: PricingItemType): string {
    return type === 'service' ? translate('Service') : translate('Produit');
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
    return Array.from(set).sort((a, b) => a.localeCompare(b, activeLocale()));
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
    const list = this.viewItems().filter((item) => {
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
          return a.label.localeCompare(b.label, activeLocale());
        case 'category':
        default:
          return a.category.localeCompare(b.category, activeLocale()) || a.label.localeCompare(b.label, activeLocale());
      }
    });
  });
  editingId = signal<string | null>(null);
  editPrice = signal<number | null>(null);
  editPriceEditable = signal(false);
  drafts = signal<MorDrafts>({ majoration: null, reduction: null });
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
    const label = translate(MOR_LABELS[kind]);
    const { rate, days, max_orders } = draft;
    if (rate === null || !Number.isInteger(rate) || rate < 1 || rate > MAX_RATE) {
      return translate('Taux de {label} : entier entre 1 et {MAX_RATE} %.', { label: label, MAX_RATE: MAX_RATE });
    }
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_DAYS)) {
      return translate('Durée de {label} : entier entre 1 et {MAX_DAYS} jours, ou vide.', { label: label, MAX_DAYS: MAX_DAYS });
    }
    if (max_orders !== null && (!Number.isInteger(max_orders) || max_orders < 1 || max_orders > MAX_ORDERS)) {
      return translate('Commandes de {label} : entier entre 1 et {toLocaleString}, ou vide.', { label: label, toLocaleString: MAX_ORDERS.toLocaleString(activeLocale()) });
    }
    return '';
  }
  private sameRule(rule: PriceRule | null, draft: MorDraft): boolean {
    return !!rule && rule.rate === draft.rate && rule.days === draft.days && rule.max_orders === draft.max_orders;
  }
  private project(item: ServiceItem): ServiceItem {
    const patch = this.pending.get<PricePatch>(`price:${item.id}`)?.payload;
    if (!patch) return item;
    const rule = (kind: PriceAdjustmentKind): PriceRule | null => {
      if (!patch.price_editable) return null;
      const input = patch.rules[kind];
      if (input) return { id: 'pending', ...input, created_at: patch.at, used_orders: 0 };
      return patch.drops.includes(kind) ? null : item[kind];
    };
    return {
      ...item,
      price: patch.price,
      price_editable: patch.price_editable,
      majoration: rule('majoration'),
      reduction: rule('reduction'),
    };
  }
  isPending(id: string): boolean {
    return this.pending.get(`price:${id}`) !== undefined;
  }
  onApplied(): void {
    this.editingId.set(null);
    void this.refreshJournal();
    void this.refreshCurrency();
    void this.refreshDenominations();
    this.setStatus(translate('Modifications appliquées.'), false);
  }
  cancelEdit(): void {
    const id = this.editingId();
    this.editingId.set(null);
    this.editError.set('');
    if (id) document.getElementById(`pricing-edit-btn-${id}`)?.focus();
  }
  saveEdit(item: ServiceItem): void {
    const real = this.items().find((i) => i.id === item.id);
    if (!real) return;
    const price = this.editPrice();
    if (price === null || Number.isNaN(price)) {
      this.editError.set(translate('Le prix est obligatoire.'));
      return;
    }
    if (price < 0) {
      this.editError.set(translate('Le prix ne peut pas être négatif.'));
      return;
    }
    if (!Number.isInteger(price)) {
      this.editError.set(translate('Le prix doit être un nombre entier.'));
      return;
    }
    const editable = this.editPriceEditable();
    const drafts = this.drafts();
    const rules: Record<PriceAdjustmentKind, MorInput | null> = { majoration: null, reduction: null };
    const drops: PriceAdjustmentKind[] = [];
    if (editable) {
      for (const kind of MOR_KINDS) {
        const draft = drafts[kind];
        if (!draft) {
          if (real[kind]) drops.push(kind);
          continue;
        }
        const error = this.draftError(kind, draft);
        if (error) {
          this.editError.set(error);
          return;
        }
        if (!this.sameRule(real[kind], draft)) {
          rules[kind] = { rate: draft.rate as number, days: draft.days, max_orders: draft.max_orders };
        }
      }
    }
    const key = `price:${real.id}`;
    const { counter, cashier } = this.briefing(real, price, editable, rules, drops);
    if (counter.length === 0) {
      this.pending.unstage(key);
    } else {
      const patch: PricePatch = { price, price_editable: editable, rules, drops, at: clockNow().toISOString() };
      this.pending.stage({
        key,
        payload: patch,
        counter,
        cashier,
        apply: async () => {
          await pricingApi.updatePricingItem(real.id, {
            price,
            price_editable: editable,
            majoration: rules.majoration,
            reduction: rules.reduction,
          });
          for (const kind of drops) await pricingApi.deleteMor(real.id, kind);
        },
      });
    }
    this.editError.set('');
    this.setStatus('', false);
    this.editingId.set(null);
    document.getElementById(`pricing-edit-btn-${real.id}`)?.focus();
  }
  private briefing(
    real: ServiceItem,
    price: number,
    editable: boolean,
    rules: Record<PriceAdjustmentKind, MorInput | null>,
    drops: PriceAdjustmentKind[],
  ): { counter: string[]; cashier: string[] } {
    const priceLines =
      price !== real.price
        ? [`${real.label} : ${this.money(real.price)} → ${this.money(price)} ${this.currency()}`]
        : [];
    const counter = [...priceLines];
    if (editable !== real.price_editable) {
      counter.push(translate('{label} : prix {mode} au comptoir', { label: real.label, mode: editable ? translate('modifiable') : translate('verrouillé') }));
    }
    for (const kind of MOR_KINDS) {
      const rule = rules[kind];
      if (rule) counter.push(`${real.label} : ${translate(MOR_LABELS[kind])} ${rule.rate} %`);
      else if (drops.includes(kind)) counter.push(translate('{label} : {kind} retirée', { label: real.label, kind: translate(MOR_LABELS[kind]) }));
    }
    return { counter, cashier: priceLines };
  }
  currencyChoice = signal('');
  customCode = signal('');
  customName = signal('');
  currencyError = signal('');
  readonly pendingCurrency = computed(() => this.pending.get<CurrencyPatch>(CURRENCY_KEY)?.payload ?? null);
  validateCurrency(): void {
    const code = this.currencyChoice();
    if (!code) return;
    this.stageCurrency(code, null);
  }
  addCustomCurrency(): void {
    const code = this.customCode().trim();
    const name = this.customName().trim();
    if (!CURRENCY_CODE_PATTERN.test(code)) {
      this.currencyError.set(translate('Code invalide : 2 à 6 lettres attendues (ex. : USD, EUR, CNY).'));
      return;
    }
    if (name.length > MAX_CURRENCY_NAME_LEN) {
      this.currencyError.set(translate('Le nom de la devise est trop long.'));
      return;
    }
    this.stageCurrency(code.toUpperCase(), name || null);
    this.customCode.set('');
    this.customName.set('');
  }
  private stageCurrency(code: string, name: string | null): void {
    this.currencyError.set('');
    this.setStatus('', false);
    const from = this.currency();
    if (code === from) {
      this.pending.unstage(CURRENCY_KEY);
      return;
    }
    const line = translate('Devise : {from} → {code}', { from: from, code: code });
    const patch: CurrencyPatch = { code, name };
    this.pending.stage({
      key: CURRENCY_KEY,
      payload: patch,
      counter: [line],
      cashier: [line],
      apply: async () => {
        await pricingApi.setCurrency(code, name);
      },
    });
  }
  denominationInput = signal<number | null>(null);
  denominationError = signal('');
  readonly shownDenominations = computed<number[]>(
    () => this.pending.get<DenominationPatch>(DENOMINATIONS_KEY)?.payload.values ?? this.denominations(),
  );
  readonly pendingDenominations = computed(() => this.pending.get<DenominationPatch>(DENOMINATIONS_KEY) !== undefined);
  addDenomination(): void {
    const value = this.denominationInput();
    if (value === null || !Number.isInteger(value) || value < 1 || value > MAX_DENOMINATION) {
      this.denominationError.set(translate('Valeur : entier entre 1 et {money}.', { money: this.money(MAX_DENOMINATION) }));
      return;
    }
    if (this.shownDenominations().includes(value)) {
      this.denominationError.set(translate('Cette valeur existe déjà.'));
      return;
    }
    this.denominationInput.set(null);
    this.stageDenominations([...this.shownDenominations(), value]);
  }
  removeDenomination(value: number): void {
    this.stageDenominations(this.shownDenominations().filter((v) => v !== value));
  }
  private stageDenominations(next: number[]): void {
    this.denominationError.set('');
    this.setStatus('', false);
    const values = [...next].sort((a, b) => b - a);
    const saved = this.denominations();
    const added = values.filter((v) => !saved.includes(v));
    const removed = saved.filter((v) => !values.includes(v));
    if (added.length === 0 && removed.length === 0) {
      this.pending.unstage(DENOMINATIONS_KEY);
      return;
    }
    const code = this.currency();
    const lines = [
      ...added.map((v) => translate('Monnaie : ajout de {money} {code}', { money: this.money(v), code: code })),
      ...removed.map((v) => translate('Monnaie : retrait de {money} {code}', { money: this.money(v), code: code })),
    ];
    const patch: DenominationPatch = { values };
    this.pending.stage({
      key: DENOMINATIONS_KEY,
      payload: patch,
      counter: lines,
      cashier: lines,
      apply: async () => {
        await pricingApi.setDenominations(values);
      },
    });
  }
}
