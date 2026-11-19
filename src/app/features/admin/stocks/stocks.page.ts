import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/error/error-messages';
import { getStoredUsername } from '../../../core/storage/local-storage';
import { formatGroupId } from '../../../data/order/order.utils';
import { PendingStore } from '../../../data/pending/pending.store';
import { CurrencyStore } from '../../../data/pricing/currency.store';
import type { PricingItemType } from '../../../data/pricing/pricing.model';
import * as stockApi from '../../../data/stock/stock.api';
import type { StockAction, StockHistoryEntry, StockItem, StockItemFields } from '../../../data/stock/stock.model';
import { Badge, BadgeTone } from '../../../shared/ui/badge/badge';
import { PendingFab } from '../../../shared/ui/pending-fab/pending-fab';
type StockTab = 'product' | 'service' | 'journal';
const ACTION_BADGES: Record<StockAction, { label: string; tone: BadgeTone }> = {
  availability: { label: 'Disponibilité', tone: 'info' },
  quantity: { label: 'Quantité', tone: 'brand' },
  empty: { label: 'Rupture de stock', tone: 'danger' },
};
const COPIED_FEEDBACK_MS = 1500;
const MAX_LABEL_LEN = 60;
const MAX_CATEGORY_LEN = 40;
const TYPE_OPTIONS: { value: PricingItemType; label: string }[] = [
  { value: 'product', label: 'Produit' },
  { value: 'service', label: 'Service' },
];
@Component({
  selector: 'app-admin-stocks',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, Badge, PendingFab],
  templateUrl: './stocks.page.html',
})
export class StocksPage implements OnInit, OnDestroy {
  readonly actionBadges = ACTION_BADGES;
  readonly typeOptions = TYPE_OPTIONS;
  readonly maxLabelLen = MAX_LABEL_LEN;
  readonly maxCategoryLen = MAX_CATEGORY_LEN;
  readonly formatGroupId = formatGroupId;
  private readonly username = getStoredUsername() ?? '';
  private readonly pending = inject(PendingStore);
  readonly currency = inject(CurrencyStore);
  items = signal<StockItem[]>([]);
  readonly viewItems = computed<StockItem[]>(() => this.items().map((item) => this.project(item)));
  history = signal<StockHistoryEntry[]>([]);
  loading = signal(true);
  loadError = signal('');
  tab = signal<StockTab>('product');
  searchTerm = signal('');
  statusMessage = signal('');
  statusIsError = signal(false);
  editingId = signal<string | null>(null);
  editQuantity = signal<number | null>(null);
  editError = signal('');
  showCreate = signal(false);
  creating = signal(false);
  createError = signal('');
  newType = signal<PricingItemType>('product');
  newLabel = signal('');
  newCategory = signal('');
  newPrice = signal<number | null>(null);
  newQuantity = signal<number | null>(null);
  itemEditingId = signal<string | null>(null);
  itemEditError = signal('');
  editLabel = signal('');
  editCategory = signal('');
  editType = signal<PricingItemType>('product');
  copied = signal<string | null>(null);
  expandedId = signal<number | null>(null);
  private copiedTimer?: ReturnType<typeof setTimeout>;
  readonly tabs = computed<{ value: StockTab; label: string; count: number }[]>(() => [
    { value: 'product', label: 'Produit', count: this.viewItems().filter((i) => i.type === 'product').length },
    { value: 'service', label: 'Service', count: this.viewItems().filter((i) => i.type === 'service').length },
    { value: 'journal', label: 'Journal', count: this.history().length },
  ]);
  readonly visibleItems = computed<StockItem[]>(() => {
    const tab = this.tab();
    if (tab === 'journal') return [];
    const term = this.searchTerm().trim().toLowerCase();
    return this.viewItems()
      .filter(
        (item) =>
          item.type === tab &&
          (!term || item.label.toLowerCase().includes(term) || item.category.toLowerCase().includes(term)),
      )
      .sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.label.localeCompare(b.label, 'fr'));
  });
  readonly categories = computed<string[]>(() =>
    [...new Set(this.viewItems().map((i) => i.category))].sort((a, b) => a.localeCompare(b, 'fr')),
  );
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
  private async load(silent = false): Promise<void> {
    if (!silent) {
      this.loading.set(true);
      this.loadError.set('');
    }
    try {
      const [items, history] = await Promise.all([stockApi.getStockItems(), stockApi.getStockHistory()]);
      this.items.set(items);
      this.history.set(history);
    } catch (e) {
      console.error('failed to load stocks', e);
      if (!silent) this.loadError.set(errorMessage(e, 'Impossible de charger les stocks.'));
    } finally {
      if (!silent) this.loading.set(false);
    }
  }
  private async refreshHistory(): Promise<void> {
    try {
      this.history.set(await stockApi.getStockHistory());
    } catch (e) {
      console.error('failed to refresh stock history', e);
    }
  }
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }
  setTab(tab: StockTab): void {
    this.tab.set(tab);
    this.editingId.set(null);
    this.itemEditingId.set(null);
    this.searchTerm.set('');
    void this.load(true);
  }
  toggleEntry(id: number): void {
    this.expandedId.update((current) => (current === id ? null : id));
  }
  sourceLabel(entry: StockHistoryEntry): string {
    return entry.order_group_id === null ? 'Réglage manuel' : `Commande ${formatGroupId(entry.order_group_id)}`;
  }
  typeLabel(type: PricingItemType): string {
    return type === 'service' ? 'Service' : 'Produit';
  }
  typeTone(type: PricingItemType): BadgeTone {
    return type === 'service' ? 'brand' : 'success';
  }
  quantityLabel(item: StockItem): string {
    if (item.quantity === null) return item.type === 'service' ? 'Illimité' : 'Non suivi';
    return item.type === 'service' ? `Limite : ${item.quantity}` : String(item.quantity);
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
  async copy(key: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(key);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(null), COPIED_FEEDBACK_MS);
    } catch (e) {
      console.error('failed to copy id', e);
      this.setStatus("Impossible de copier l'ID.", true);
    }
  }
  private project(item: StockItem): StockItem {
    const fields = this.pending.get<StockItemFields>(`stock:${item.id}:item`);
    const available = this.pending.get<boolean>(`stock:${item.id}:available`);
    const quantity = this.pending.get<number | null>(`stock:${item.id}:quantity`);
    return {
      ...item,
      ...(fields?.payload ?? {}),
      available: available ? available.payload : item.available,
      quantity: quantity ? quantity.payload : item.quantity,
    };
  }
  isPending(id: string): boolean {
    return this.pending.has(`stock:${id}:`);
  }
  onApplied(): void {
    this.editingId.set(null);
    this.itemEditingId.set(null);
    void this.load(true);
    this.setStatus('Modifications appliquées.', false);
  }
  toggleAvailability(item: StockItem): void {
    const real = this.items().find((i) => i.id === item.id);
    if (!real) return;
    const key = `stock:${item.id}:available`;
    const desired = !item.available;
    this.setStatus('', false);
    if (desired === real.available) {
      this.pending.unstage(key);
      return;
    }
    this.pending.stage({
      key,
      payload: desired,
      counter: [`${item.label} : ${desired ? 'disponible' : 'indisponible'}`],
      cashier: [],
      apply: async () => {
        await stockApi.setStockAvailability(item.id, desired, this.username);
      },
    });
  }
  startEdit(item: StockItem): void {
    this.itemEditingId.set(null);
    this.editingId.set(item.id);
    this.editQuantity.set(item.quantity);
    this.editError.set('');
    setTimeout(() => document.getElementById(`stock-qty-${item.id}`)?.focus());
  }
  cancelEdit(): void {
    const id = this.editingId();
    this.editingId.set(null);
    this.editError.set('');
    if (id) document.getElementById(`stock-edit-btn-${id}`)?.focus();
  }
  private quantityLine(item: StockItem, quantity: number | null): string {
    const service = item.type === 'service';
    if (quantity === null) return `${item.label} : ${service ? 'sans limite' : 'stock non suivi'}`;
    if (quantity === 0) return `${item.label} : rupture de stock`;
    return `${item.label} : ${service ? 'limite' : 'stock'} ${quantity}`;
  }
  saveQuantity(item: StockItem): void {
    const real = this.items().find((i) => i.id === item.id);
    if (!real) return;
    const quantity = this.editQuantity();
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0)) {
      this.editError.set('La quantité doit être un nombre entier positif ou nul.');
      return;
    }
    const key = `stock:${item.id}:quantity`;
    if (quantity === real.quantity) {
      this.pending.unstage(key);
    } else {
      this.pending.stage({
        key,
        payload: quantity,
        counter: [this.quantityLine(item, quantity)],
        cashier: [],
        apply: async () => {
          await stockApi.setStockQuantity(item.id, quantity, this.username);
        },
      });
    }
    this.editError.set('');
    this.setStatus('', false);
    this.editingId.set(null);
    document.getElementById(`stock-edit-btn-${item.id}`)?.focus();
  }
  private fieldsError(label: string, category: string): string {
    if (!label) return "Le nom de l'article est obligatoire.";
    if (!category) return 'La catégorie est obligatoire.';
    return '';
  }
  private numberError(value: number | null, what: string): string {
    if (value === null || (Number.isInteger(value) && value >= 0)) return '';
    return `${what} doit être un nombre entier positif ou nul.`;
  }
  openCreate(): void {
    this.newType.set(this.tab() === 'service' ? 'service' : 'product');
    this.newLabel.set('');
    this.newCategory.set('');
    this.newPrice.set(null);
    this.newQuantity.set(null);
    this.createError.set('');
    this.showCreate.set(true);
    setTimeout(() => document.getElementById('new-item-label')?.focus());
  }
  closeCreate(): void {
    if (this.creating()) return;
    this.showCreate.set(false);
    document.getElementById('stock-add-btn')?.focus();
  }
  async createItem(): Promise<void> {
    if (this.creating()) return;
    const fields: StockItemFields = {
      type: this.newType(),
      category: this.newCategory().trim(),
      label: this.newLabel().trim(),
    };
    const price = this.newPrice();
    const quantity = this.newQuantity();
    const invalid =
      this.fieldsError(fields.label, fields.category) ||
      this.numberError(price, 'Le prix') ||
      this.numberError(quantity, fields.type === 'service' ? 'La limite' : 'La quantité');
    if (invalid) {
      this.createError.set(invalid);
      return;
    }
    this.createError.set('');
    this.creating.set(true);
    try {
      const created = await stockApi.createStockItem(fields, price, quantity, this.username);
      this.items.update((list) => [...list, created]);
      this.showCreate.set(false);
      this.setTab(created.type);
      this.setStatus(`« ${created.label} » a été ajouté.`, false);
      if (quantity !== null) await this.refreshHistory();
    } catch (e) {
      console.error('create_item failed', e);
      this.createError.set(errorMessage(e, "Échec de l'ajout de l'article. Réessayez."));
    } finally {
      this.creating.set(false);
    }
  }
  startItemEdit(item: StockItem): void {
    this.editingId.set(null);
    this.editError.set('');
    this.itemEditingId.set(item.id);
    this.editLabel.set(item.label);
    this.editCategory.set(item.category);
    this.editType.set(item.type);
    this.itemEditError.set('');
    setTimeout(() => document.getElementById(`item-edit-label-${item.id}`)?.focus());
  }
  cancelItemEdit(): void {
    const id = this.itemEditingId();
    this.itemEditingId.set(null);
    this.itemEditError.set('');
    if (id) document.getElementById(`item-edit-btn-${id}`)?.focus();
  }
  private itemLines(real: StockItem, fields: StockItemFields): string[] {
    const lines: string[] = [];
    if (fields.label !== real.label) lines.push(`« ${real.label} » renommé « ${fields.label} »`);
    if (fields.category !== real.category) lines.push(`${fields.label} : catégorie « ${fields.category} »`);
    if (fields.type !== real.type) {
      lines.push(`${fields.label} : désormais ${fields.type === 'service' ? 'un service' : 'un produit'}`);
    }
    return lines;
  }
  saveItem(item: StockItem): void {
    const real = this.items().find((i) => i.id === item.id);
    if (!real) return;
    const fields: StockItemFields = {
      type: this.editType(),
      category: this.editCategory().trim(),
      label: this.editLabel().trim(),
    };
    const invalid = this.fieldsError(fields.label, fields.category);
    if (invalid) {
      this.itemEditError.set(invalid);
      return;
    }
    const key = `stock:${item.id}:item`;
    const lines = this.itemLines(real, fields);
    if (lines.length === 0) {
      this.pending.unstage(key);
    } else {
      this.pending.stage({
        key,
        payload: fields,
        counter: lines,
        cashier: [],
        apply: async () => {
          await stockApi.updateStockItem(item.id, fields);
        },
      });
    }
    this.itemEditError.set('');
    this.setStatus('', false);
    this.itemEditingId.set(null);
    if (fields.type !== item.type) this.setTab(fields.type);
    document.getElementById(`item-edit-btn-${item.id}`)?.focus();
  }
}
