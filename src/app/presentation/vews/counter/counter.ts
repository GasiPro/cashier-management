// src/app/presentation/vews/counter/counter.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core'; // Adjust to '@tauri-apps/api/tauri' if on Tauri v1

// Inline types to represent our Rust domain structures.
// NOTE: these fields must mirror the serde output of
// src-tauri/src/domain/order/price_calculator.rs::ServiceItem exactly.
export interface ServiceItem {
  id: string;               // Rust sends a string id (e.g. "pca3nb"), not a number
  label: string;             // Rust field is "label", not "name" — rename template refs from .name to .label
  price: number;
  category: string;
  type: 'service' | 'product'; // Rust ServiceItemType serializes as "service" | "product" (English, lowercase)
}

export interface CartItem {
  service: ServiceItem;
  qty: number;
  unitPrice: number;
}

export interface Order {
  id: number;
  group_id: number;
  service_type: string;
  unit_price: number;
  quantity: number;
  status: 'EN_ATTENTE' | 'PAYE';
  time: string;
  created_at: string;
  paid_at: string | null;
}

interface OrderGroup {
  groupId: number;
  lines: Order[];
  status: 'EN_ATTENTE' | 'PAYE' | 'MIXTE';
  time: string;
}

@Component({
  selector: 'app-counter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './counter.html',
})
export class Counter implements OnInit, OnDestroy {
  // ── Catalogue ──────────────────────────────────────────────────────────────
  allServices: ServiceItem[] = [];

  // ── Type filters ───────────────────────────────────────────────────────────
  // Display labels stay in French; the `value` must match the wire format
  // coming from Rust ('service' | 'product'), not a French word.
  readonly typeFilters = [
    { label: 'Tous',     value: 'tous'    },
    { label: 'Services', value: 'service' },
    { label: 'Produits', value: 'product' },
  ] as const;
  activeTypeFilter: 'tous' | 'service' | 'product' = 'tous';

  // ── Category filters ───────────────────────────────────────────────────────
  categories: string[] = [];
  activeCategory = 'Tous';

  // ── Cart ───────────────────────────────────────────────────────────────────
  cart: CartItem[] = [];

  // ── Today's order history ──────────────────────────────────────────────────
  orderGroups: OrderGroup[] = [];

  // ── UI ─────────────────────────────────────────────────────────────────────
  currentTime = '';
  toastVisible = false;
  toastMessage = '';

  private clockId!: ReturnType<typeof setInterval>;

  constructor(private router: Router) {}

  async ngOnInit(): Promise<void> {
    this.updateClock();
    this.clockId = setInterval(() => this.updateClock(), 60_000);

    // Fetch state directly via Tauri commands upon component initialization
    await this.loadCatalogue();
    await this.refreshHistory();
  }

  ngOnDestroy(): void {
    clearInterval(this.clockId);
  }

  // ── Tauri Interactivity Bridge ─────────────────────────────────────────────

  private async loadCatalogue(): Promise<void> {
    // Queries your Rust backend for the matrix instead of using a hardcoded TS file
    this.allServices = await invoke<ServiceItem[]>('get_pricing_matrix');
    this.extractCategories();
  }

  private async refreshHistory(): Promise<void> {
    // Fetch current orders snapshot directly
    const orders = await invoke<Order[]>('get_orders');
    this.orderGroups = this.buildGroups(orders);
  }

  async envoyerCommande(): Promise<void> {
    if (this.cart.length === 0) return;

    try {
      await invoke('create_order', { cart: this.cart });

      this.cart = [];
      this.showToast('Commande envoyée à la caisse !');
      await this.refreshHistory();
    } catch (error) {
      this.showToast('Erreur lors de l\'envoi de la commande');
    }
  }

  // ── Derived View State ─────────────────────────────────────────────────────

  get filteredServices(): ServiceItem[] {
    return this.allServices.filter(s => {
      const matchType = this.activeTypeFilter === 'tous' || s.type === this.activeTypeFilter;
      const matchCat  = this.activeCategory   === 'Tous' || s.category === this.activeCategory;
      return matchType && matchCat;
    });
  }

  get filteredCategories(): string[] {
    return ['Tous', ...this.categories];
  }

  get totalCartItems(): number {
    return this.cart.reduce((sum, item) => sum + item.qty, 0);
  }

  get grandTotal(): number {
    // Pure calculation localized to the UI line layer
    return this.cart.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
  }

  // ── Filter Actions ─────────────────────────────────────────────────────────

  setTypeFilter(type: 'tous' | 'service' | 'product'): void {
    this.activeTypeFilter = type;
    this.extractCategories();
    this.activeCategory = 'Tous';
  }

  setCategory(cat: string): void {
    this.activeCategory = cat;
  }

  private extractCategories(): void {
    const raw = this.allServices
      .filter(s => this.activeTypeFilter === 'tous' || s.type === this.activeTypeFilter)
      .map(s => s.category);
    this.categories = Array.from(new Set(raw));
  }

  // ── Cart Mutations ─────────────────────────────────────────────────────────

  selectService(service: ServiceItem): void {
    const found = this.cart.find(item => item.service.id === service.id);
    if (found) {
      found.qty++;
    } else {
      this.cart.push({ service, qty: 1, unitPrice: service.price });
    }
  }

  isInCart(service: ServiceItem): boolean {
    return this.cart.some(item => item.service.id === service.id);
  }

  cartQty(service: ServiceItem): number {
    return this.cart.find(item => item.service.id === service.id)?.qty ?? 0;
  }

  incrementItem(item: CartItem): void {
    item.qty++;
  }

  decrementItem(item: CartItem): void {
    if (item.qty > 1) {
      item.qty--;
    } else {
      this.removeItem(item);
    }
  }

  removeItem(item: CartItem): void {
    this.cart = this.cart.filter(i => i.service.id !== item.service.id);
  }

  // ── Template Helpers ───────────────────────────────────────────────────────

  groupLabel(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }

  groupSummary(g: OrderGroup): string {
    return g.lines.map(l => {
      const parts = l.service_type.split(' — ');
      return parts.length > 1 ? parts[1] : l.service_type;
    }).join(', ');
  }

  groupStatusLabel(g: OrderGroup): string {
    if (g.status === 'PAYE')       return 'Payé';
    if (g.status === 'EN_ATTENTE') return 'En attente';
    return 'Mixte';
  }

  groupStatusClass(g: OrderGroup): string {
    if (g.status === 'PAYE')       return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
    if (g.status === 'EN_ATTENTE') return 'bg-amber-50  text-amber-700  border border-amber-100';
    return 'bg-gray-50 text-gray-700 border border-gray-100';
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  // ── Layout Formatters ──────────────────────────────────────────────────────

  private buildGroups(orders: Order[]): OrderGroup[] {
    const map = new Map<number, Order[]>();
    for (const o of orders) {
      if (!map.has(o.group_id)) map.set(o.group_id, []);
      map.get(o.group_id)!.push(o);
    }
    const groups: OrderGroup[] = [];
    for (const [groupId, lines] of map.entries()) {
      const allPaid    = lines.every(l => l.status === 'PAYE');
      const allWaiting = lines.every(l => l.status === 'EN_ATTENTE');
      groups.push({
        groupId,
        lines,
        status: allPaid ? 'PAYE' : allWaiting ? 'EN_ATTENTE' : 'MIXTE',
        time:    lines[0].time,
      });
    }
    return groups.sort((a, b) => b.groupId - a.groupId);
  }

  private showToast(msg: string): void {
    this.toastMessage = msg;
    this.toastVisible = true;
    setTimeout(() => (this.toastVisible = false), 3000);
  }

  private updateClock(): void {
    this.currentTime = new Date().toLocaleTimeString('fr-FR', {
      hour:   '2-digit',
      minute: '2-digit',
    });
  }
}
