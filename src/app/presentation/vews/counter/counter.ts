// src/app/presentation/vews/comptoir/comptoir.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { Router }       from '@angular/router';
import { Subscription } from 'rxjs';

import { OrderService }                        from '../../../core/service/order.service';
import { Order }                               from '../../../domain/order/order.model';
import { ServiceItem, CartItem, PriceCalculator } from '../../../domain/order/price-calculator';
import { PRICING_MATRIX }                      from '../../../core/config/pricing.matrix';

interface OrderGroup {
  groupId: number;
  lines:   Order[];
  status:  'EN_ATTENTE' | 'PAYE' | 'MIXTE';
  time:    string;
}

@Component({
  selector: 'app-counter',
  standalone:  true,
  imports:     [CommonModule, FormsModule],
  templateUrl: './counter.html',
})
export class Counter implements OnInit, OnDestroy {

  // ── Catalogue ──────────────────────────────────────────────────────────────
  readonly allServices: ServiceItem[] = PRICING_MATRIX;

  // ── Type filters ───────────────────────────────────────────────────────────
  readonly typeFilters = [
    { label: 'Tous',     value: 'tous'    },
    { label: 'Services', value: 'service' },
    { label: 'Produits', value: 'produit' },
  ] as const;
  activeTypeFilter: 'tous' | 'service' | 'produit' = 'tous';

  // ── Category filters ───────────────────────────────────────────────────────
  categories:     string[] = [];
  activeCategory           = 'Tous';

  // ── Cart ───────────────────────────────────────────────────────────────────
  cart: CartItem[] = [];

  // ── Today's order history (reactive) ──────────────────────────────────────
  orderGroups: OrderGroup[] = [];

  // ── UI ─────────────────────────────────────────────────────────────────────
  currentTime  = '';
  toastVisible = false;
  toastMessage = '';

  private sub!: Subscription;
  private clockId!: ReturnType<typeof setInterval>;

  constructor(
    private orderService: OrderService,
    private router:       Router,
  ) {}

  ngOnInit(): void {
    this.extractCategories();

    this.sub = this.orderService.orders$.subscribe(orders => {
      this.orderGroups = this.buildGroups(orders);
    });

    this.updateClock();
    this.clockId = setInterval(() => this.updateClock(), 60_000);
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    clearInterval(this.clockId);
  }

  // ── Derived state ──────────────────────────────────────────────────────────

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
    return this.cart.reduce(
      (sum, item) => sum + PriceCalculator.calculateLineTotal(item.qty, item.unitPrice),
      0,
    );
  }

  // ── Filter actions ─────────────────────────────────────────────────────────

  setTypeFilter(type: 'tous' | 'service' | 'produit'): void {
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

  // ── Cart mutations ─────────────────────────────────────────────────────────

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

  // ── Submit ─────────────────────────────────────────────────────────────────

  envoyerCommande(): void {
    if (this.cart.length === 0) return;
    this.orderService.createOrder(this.cart);
    this.cart = [];
    this.showToast('Commande envoyée à la caisse !');
  }

  // ── Template helpers ───────────────────────────────────────────────────────

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

  // ── Internals ──────────────────────────────────────────────────────────────

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
        time:   lines[0].time,
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