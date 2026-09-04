import { Component, ElementRef, OnInit, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';

export type PricingItemType = 'service' | 'product';

export interface ServiceItem {
  id: string;
  label: string;
  price: number;
  category: string;
  type: PricingItemType;
}

type TypeFilter = 'all' | PricingItemType;
type SortKey = 'category' | 'label' | 'price-asc' | 'price-desc';

const MAX_LABEL_LEN = 60;
const MAX_CATEGORY_LEN = 40;

interface TypeOption {
  value: PricingItemType;
  label: string;
}

const TYPE_OPTIONS: TypeOption[] = [
  { value: 'service', label: 'Service' },
  { value: 'product', label: 'Produit' },
];

@Component({
  selector: 'app-product',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product.html',
  styleUrl: './product.css',
})
export class Product implements OnInit {
  readonly maxLabelLen = MAX_LABEL_LEN;
  readonly maxCategoryLen = MAX_CATEGORY_LEN;
  readonly typeOptions = TYPE_OPTIONS;
  @ViewChild('newItemLabelInput') private newItemLabelInput?: ElementRef<HTMLInputElement>;

  // ── Catalogue ──────────────────────────────────────────────────────────────
  items = signal<ServiceItem[]>([]);
  loadingItems = signal(true);
  loadError = signal('');

  ngOnInit(): void {
    this.loadItems();
  }

  private async loadItems(): Promise<void> {
    this.loadingItems.set(true);
    this.loadError.set('');
    try {
      const items = await invoke<ServiceItem[]>('get_pricing_matrix');
      this.items.set(items);
    } catch (e) {
      console.error('failed to load pricing matrix', e);
      this.loadError.set('Impossible de charger la grille tarifaire.');
    } finally {
      this.loadingItems.set(false);
    }
  }

  // ── Filters, search & sort ───────────────────────────────────────────────
  typeFilter = signal<TypeFilter>('all');
  categoryFilter = signal<string>('all');
  searchTerm = signal('');
  sortKey = signal<SortKey>('category');

  /** Distinct, alphabetically sorted categories derived from the current catalogue —
   *  also feeds the add/edit forms' category suggestions so labels stay consistent. */
  readonly categories = computed<string[]>(() => {
    const set = new Set(this.items().map((i) => i.category).filter((c) => c.trim().length > 0));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  });

  readonly serviceCount = computed(() => this.items().filter((i) => i.type === 'service').length);
  readonly productCount = computed(() => this.items().filter((i) => i.type === 'product').length);

  setTypeFilter(type: TypeFilter): void {
    this.typeFilter.set(type);
  }
  isTypeFilterActive(type: TypeFilter): boolean {
    return this.typeFilter() === type;
  }
  setCategoryFilter(category: string): void {
    this.categoryFilter.set(category);
  }
  isCategoryFilterActive(category: string): boolean {
    return this.categoryFilter() === category;
  }

  readonly filtersActive = computed(
    () => this.typeFilter() !== 'all' || this.categoryFilter() !== 'all' || this.searchTerm().trim().length > 0,
  );

  resetFilters(): void {
    this.typeFilter.set('all');
    this.categoryFilter.set('all');
    this.searchTerm.set('');
  }

  readonly filteredItems = computed<ServiceItem[]>(() => {
    const type = this.typeFilter();
    const category = this.categoryFilter();
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

  typeLabel(type: PricingItemType): string {
    return type === 'service' ? 'Service' : 'Produit';
  }

  typeBadgeClass(type: PricingItemType): string {
    const base = 'inline-flex items-center text-[10px] font-semibold uppercase tracking-wide' +
      ' border rounded-full px-1.5 py-0.5 flex-shrink-0';
    return type === 'service'
      ? `${base} text-[#1E3A5F] bg-[#EFF4FA] border-[#1E3A5F]/20`
      : `${base} text-emerald-700 bg-emerald-50 border-emerald-200`;
  }

  // ── New item form ─────────────────────────────────────────────────────────
  newItemLabel = signal('');
  newItemCategory = signal('');
  newItemPrice = signal<number | null>(null);
  newItemType = signal<PricingItemType>('service');
  creatingItem = signal(false);
  newItemFormError = signal('');
  /** Result feedback (success or server error) for catalogue actions, announced via aria-live. */
  itemStatusMessage = signal('');
  itemStatusIsError = signal(false);

  setNewItemType(type: PricingItemType): void {
    this.newItemType.set(type);
  }

  private readonly trimmedNewItemLabel = computed(() => this.newItemLabel().trim());
  private readonly trimmedNewItemCategory = computed(() => this.newItemCategory().trim());

  /** Client-side shape check only — the server remains the source of truth, so the
   *  button stays enabled even if this passes; the real rejection (if any) comes
   *  back from `create_pricing_item`. */
  canSubmitNewItem = computed(() => {
    const price = this.newItemPrice();
    return (
      this.trimmedNewItemLabel().length > 0 &&
      this.trimmedNewItemLabel().length <= this.maxLabelLen &&
      this.trimmedNewItemCategory().length > 0 &&
      this.trimmedNewItemCategory().length <= this.maxCategoryLen &&
      price !== null &&
      price >= 0 &&
      !this.creatingItem()
    );
  });

  private validateItemForm(label: string, category: string, price: number | null, excludeId: string | null): string {
    if (label.length === 0) return 'Le libellé est obligatoire.';
    if (label.length > this.maxLabelLen) return `Le libellé ne peut pas dépasser ${this.maxLabelLen} caractères.`;
    if (category.length === 0) return 'La catégorie est obligatoire.';
    if (category.length > this.maxCategoryLen) {
      return `La catégorie ne peut pas dépasser ${this.maxCategoryLen} caractères.`;
    }
    if (price === null || Number.isNaN(price)) return 'Le prix est obligatoire.';
    if (price < 0) return 'Le prix ne peut pas être négatif.';
    if (
      this.items().some(
        (i) =>
          i.id !== excludeId &&
          i.label.toLowerCase() === label.toLowerCase() &&
          i.category.toLowerCase() === category.toLowerCase(),
      )
    ) {
      return 'Un tarif avec ce libellé existe déjà dans cette catégorie.';
    }
    return '';
  }

  async createItem(): Promise<void> {
    if (this.creatingItem()) return;
    const label = this.trimmedNewItemLabel();
    const category = this.trimmedNewItemCategory();
    const price = this.newItemPrice();
    const formError = this.validateItemForm(label, category, price, null);
    if (formError) {
      this.newItemFormError.set(formError);
      this.setItemStatus('', false);
      return;
    }
    this.newItemFormError.set('');
    this.creatingItem.set(true);
    this.setItemStatus('', false);
    try {
      const created = await invoke<ServiceItem>('create_pricing_item', {
        label,
        category,
        price,
        itemType: this.newItemType(),
      });
      this.items.update((list) => [created, ...list]);
      this.setItemStatus(`Tarif « ${created.label} » ajouté.`, false);
      this.resetNewItemForm();
      this.newItemLabelInput?.nativeElement.focus();
    } catch (e) {
      console.error('create_pricing_item failed', e);
      const message = typeof e === 'string' ? e : "Échec de l'ajout du tarif. Réessayez.";
      this.setItemStatus(message, true);
    } finally {
      this.creatingItem.set(false);
    }
  }

  private resetNewItemForm(): void {
    this.newItemLabel.set('');
    this.newItemCategory.set('');
    this.newItemPrice.set(null);
    this.newItemType.set('service');
  }

  private setItemStatus(message: string, isError: boolean): void {
    this.itemStatusMessage.set(message);
    this.itemStatusIsError.set(isError);
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  editingId = signal<string | null>(null);
  editLabel = signal('');
  editCategory = signal('');
  editPrice = signal<number | null>(null);
  editType = signal<PricingItemType>('service');
  savingItem = signal(false);
  /** Inline validation or server error for the edit form, announced via aria-live. */
  editItemError = signal('');

  startEditItem(item: ServiceItem): void {
    this.confirmingDeleteId.set(null);
    this.editingId.set(item.id);
    this.editLabel.set(item.label);
    this.editCategory.set(item.category);
    this.editPrice.set(item.price);
    this.editType.set(item.type);
    this.editItemError.set('');
    // Move focus into the panel once it's rendered, so keyboard/screen-reader
    // users land directly on the field they're most likely to change.
    setTimeout(() => {
      document.getElementById(`edit-item-label-${item.id}`)?.focus();
    });
  }

  cancelEditItem(): void {
    const id = this.editingId();
    this.editingId.set(null);
    if (id) {
      document.getElementById(`item-edit-btn-${id}`)?.focus();
    }
  }

  setEditType(type: PricingItemType): void {
    this.editType.set(type);
  }

  canSubmitEditItem = computed(() => {
    if (this.savingItem()) return false;
    const price = this.editPrice();
    return (
      this.editLabel().trim().length > 0 &&
      this.editLabel().trim().length <= this.maxLabelLen &&
      this.editCategory().trim().length > 0 &&
      this.editCategory().trim().length <= this.maxCategoryLen &&
      price !== null &&
      price >= 0
    );
  });

  async saveEditItem(item: ServiceItem): Promise<void> {
    if (this.savingItem()) return;
    const label = this.editLabel().trim();
    const category = this.editCategory().trim();
    const price = this.editPrice();
    const formError = this.validateItemForm(label, category, price, item.id);
    if (formError) {
      this.editItemError.set(formError);
      return;
    }
    this.editItemError.set('');
    this.savingItem.set(true);
    try {
      const updated = await invoke<ServiceItem>('update_pricing_item', {
        id: item.id,
        label,
        category,
        price,
        itemType: this.editType(),
      });
      this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
      this.editingId.set(null);
      this.setItemStatus(`Tarif « ${updated.label} » mis à jour.`, false);
      document.getElementById(`item-edit-btn-${updated.id}`)?.focus();
    } catch (e) {
      console.error('update_pricing_item failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la mise à jour du tarif. Réessayez.';
      this.editItemError.set(message);
    } finally {
      this.savingItem.set(false);
    }
  }

  // ── Duplicate ─────────────────────────────────────────────────────────────
  /** Id of the item currently being cloned, used to disable its duplicate button
   *  while the request is in flight (a pricing matrix often has many near-identical
   *  rows, e.g. the same garment across categories, so duplicating beats retyping). */
  duplicatingId = signal<string | null>(null);

  async duplicateItem(item: ServiceItem): Promise<void> {
    if (this.duplicatingId()) return;
    this.duplicatingId.set(item.id);
    this.setItemStatus('', false);
    try {
      const created = await invoke<ServiceItem>('create_pricing_item', {
        label: `${item.label} (copie)`,
        category: item.category,
        price: item.price,
        itemType: item.type,
      });
      this.items.update((list) => [created, ...list]);
      this.setItemStatus(`Tarif « ${created.label} » créé à partir de « ${item.label} ».`, false);
      this.startEditItem(created);
    } catch (e) {
      console.error('create_pricing_item (duplicate) failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la duplication du tarif. Réessayez.';
      this.setItemStatus(message, true);
    } finally {
      this.duplicatingId.set(null);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  confirmingDeleteId = signal<string | null>(null);
  deletingItem = signal(false);
  deleteItemError = signal('');

  requestDeleteItem(item: ServiceItem): void {
    this.editingId.set(null);
    this.confirmingDeleteId.set(item.id);
    this.deleteItemError.set('');
    setTimeout(() => {
      document.getElementById(`item-delete-confirm-btn-${item.id}`)?.focus();
    });
  }

  /** Closes the confirmation step and returns focus to the row's delete button. */
  cancelDeleteItem(): void {
    const id = this.confirmingDeleteId();
    this.confirmingDeleteId.set(null);
    this.deleteItemError.set('');
    if (id) {
      document.getElementById(`item-delete-btn-${id}`)?.focus();
    }
  }

  async confirmDeleteItem(item: ServiceItem): Promise<void> {
    if (this.deletingItem()) return;
    this.deletingItem.set(true);
    this.deleteItemError.set('');
    try {
      await invoke<void>('delete_pricing_item', { id: item.id });
      this.items.update((list) => list.filter((i) => i.id !== item.id));
      this.confirmingDeleteId.set(null);
      this.setItemStatus(`Tarif « ${item.label} » supprimé.`, false);
      this.newItemLabelInput?.nativeElement.focus();
    } catch (e) {
      console.error('delete_pricing_item failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la suppression du tarif. Réessayez.';
      this.deleteItemError.set(message);
    } finally {
      this.deletingItem.set(false);
    }
  }
}
