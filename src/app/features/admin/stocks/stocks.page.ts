import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/error/error-messages';
import { getStoredUsername } from '../../../core/storage/local-storage';
import type { PricingItemType } from '../../../data/pricing/pricing.model';
import * as stockApi from '../../../data/stock/stock.api';
import type { StockAction, StockHistoryEntry, StockItem } from '../../../data/stock/stock.model';
import { Badge, BadgeTone } from '../../../shared/ui/badge/badge';

type StockTab = 'history' | 'product' | 'service';

const ACTION_BADGES: Record<StockAction, { label: string; tone: BadgeTone }> = {
  availability: { label: 'Disponibilité', tone: 'info' },
  quantity: { label: 'Quantité', tone: 'brand' },
  empty: { label: 'Rupture de stock', tone: 'danger' },
};

const COPIED_FEEDBACK_MS = 1500;

@Component({
  selector: 'app-admin-stocks',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, Badge],
  templateUrl: './stocks.page.html',
})
export class StocksPage implements OnInit, OnDestroy {
  readonly actionBadges = ACTION_BADGES;

  private readonly username = getStoredUsername() ?? '';

  items = signal<StockItem[]>([]);
  history = signal<StockHistoryEntry[]>([]);
  loading = signal(true);
  loadError = signal('');

  tab = signal<StockTab>('history');
  searchTerm = signal('');

  statusMessage = signal('');
  statusIsError = signal(false);

  togglingId = signal<string | null>(null);
  savingId = signal<string | null>(null);
  editingId = signal<string | null>(null);
  editQuantity = signal<number | null>(null);
  editError = signal('');

  copied = signal<string | null>(null);
  private copiedTimer?: ReturnType<typeof setTimeout>;

  readonly tabs = computed<{ value: StockTab; label: string; count: number }[]>(() => [
    { value: 'history', label: 'Historique', count: this.history().length },
    { value: 'product', label: 'Produits', count: this.items().filter((i) => i.type === 'product').length },
    { value: 'service', label: 'Services', count: this.items().filter((i) => i.type === 'service').length },
  ]);

  readonly visibleItems = computed<StockItem[]>(() => {
    const tab = this.tab();
    if (tab === 'history') return [];
    const term = this.searchTerm().trim().toLowerCase();
    return this.items()
      .filter(
        (item) =>
          item.type === tab &&
          (!term || item.label.toLowerCase().includes(term) || item.category.toLowerCase().includes(term)),
      )
      .sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.label.localeCompare(b.label, 'fr'));
  });

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
      const [items, history] = await Promise.all([stockApi.getStockItems(), stockApi.getStockHistory()]);
      this.items.set(items);
      this.history.set(history);
    } catch (e) {
      console.error('failed to load stocks', e);
      this.loadError.set(errorMessage(e, 'Impossible de charger les stocks.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshHistory(): Promise<void> {
    try {
      this.history.set(await stockApi.getStockHistory());
    } catch (e) {
      console.error('failed to refresh stock history', e);
    }
  }

  private replaceItem(updated: StockItem): void {
    this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
  }

  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }

  setTab(tab: StockTab): void {
    this.tab.set(tab);
    this.editingId.set(null);
    this.searchTerm.set('');
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

  async toggleAvailability(item: StockItem): Promise<void> {
    if (this.togglingId()) return;
    this.togglingId.set(item.id);
    this.setStatus('', false);
    try {
      const updated = await stockApi.setStockAvailability(item.id, !item.available, this.username);
      this.replaceItem(updated);
      this.setStatus(`« ${updated.label} » est maintenant ${updated.available ? 'disponible' : 'indisponible'}.`, false);
      await this.refreshHistory();
    } catch (e) {
      console.error('set_availability failed', e);
      this.setStatus(errorMessage(e, 'Échec de la mise à jour de la disponibilité. Réessayez.'), true);
    } finally {
      this.togglingId.set(null);
    }
  }

  startEdit(item: StockItem): void {
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

  async saveQuantity(item: StockItem): Promise<void> {
    if (this.savingId()) return;
    const quantity = this.editQuantity();
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0)) {
      this.editError.set('La quantité doit être un nombre entier positif ou nul.');
      return;
    }
    this.editError.set('');
    this.savingId.set(item.id);
    this.setStatus('', false);
    try {
      const updated = await stockApi.setStockQuantity(item.id, quantity, this.username);
      this.replaceItem(updated);
      this.editingId.set(null);
      this.setStatus(`Stock de « ${updated.label} » mis à jour.`, false);
      await this.refreshHistory();
      document.getElementById(`stock-edit-btn-${updated.id}`)?.focus();
    } catch (e) {
      console.error('set_quantity failed', e);
      this.editError.set(errorMessage(e, 'Échec de la mise à jour du stock. Réessayez.'));
    } finally {
      this.savingId.set(null);
    }
  }
}
