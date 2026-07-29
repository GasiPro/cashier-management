// src/app/presentation/vews/counter/counter.ts
import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core'; // Adjust to '@tauri-apps/api/tauri' if on Tauri v1
import { WebsocketService, WsMessage } from '../../../core/service/websocket.service';
import { Subscription } from 'rxjs';

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

const CASHIER_WS_URL_KEY = 'gasipro:cashierWsUrl';
const DEFAULT_WS_URL = 'ws://127.0.0.1:8080';

@Component({
  selector: 'app-counter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './counter.html',
})
export class Counter implements OnInit, OnDestroy {
  // This app runs zoneless (no zone.js — see package.json / angular.json).
  // Anything written from a callback Angular doesn't already track — WS
  // messages, setInterval, setTimeout, a resolved invoke() promise — has to
  // live in a signal, or the view silently stops updating until some
  // unrelated click forces a re-render.

  // ── Catalogue (loaded via invoke(), an async promise resolution) ────────────
  allServices = signal<ServiceItem[]>([]);
  categories = signal<string[]>([]);

  // ── Type filters ───────────────────────────────────────────────────────────
  // Display labels stay in French; the `value` must match the wire format
  // coming from Rust ('service' | 'product'), not a French word.
  readonly typeFilters = [
    { label: 'Tous',     value: 'tous'    },
    { label: 'Services', value: 'service' },
    { label: 'Produits', value: 'product' },
  ] as const;
  // Set only from (click) handlers, which Angular's zoneless scheduler
  // already tracks — no signal needed.
  activeTypeFilter: 'tous' | 'service' | 'product' = 'tous';
  activeCategory = 'Tous';

  // ── Cart ───────────────────────────────────────────────────────────────────
  // Also only mutated from (click)/(ngModelChange) handlers — plain field.
  cart: CartItem[] = [];

  // ── Today's order history (driven entirely by the "orders" WS broadcast) ───
  orderGroups = signal<OrderGroup[]>([]);

  // ── Cashier connection (LAN) ─────────────────────────────────────────────────
  cashierAddress = '';
  wsConnected = signal(false);

  // ── UI ─────────────────────────────────────────────────────────────────────
  currentTime = signal('');
  toastVisible = signal(false);
  toastMessage = signal('');

  private clockId!: ReturnType<typeof setInterval>;
  private wsSubscription?: Subscription;

  constructor(
    private router: Router,
    private ws: WebsocketService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.updateClock();
    // Local fallback clock ticks every minute in case the WS clock hasn't
    // connected yet; once connected, the "time" broadcast overwrites this.
    this.clockId = setInterval(() => this.updateClock(), 60_000);

    // Catalogue is static reference data baked into every build, so it's
    // fine to keep this as a plain local Tauri call — it doesn't need to be
    // shared over the LAN.
    await this.loadCatalogue();

    this.cashierAddress = localStorage.getItem(CASHIER_WS_URL_KEY) ?? DEFAULT_WS_URL.replace('ws://', '');
    this.connectToCashier(this.cashierAddress);
  }

  ngOnDestroy(): void {
    clearInterval(this.clockId);
    this.wsSubscription?.unsubscribe();
    this.ws.disconnect();
  }

  // ── Cashier WS Connection ────────────────────────────────────────────────────

  /** Point this Counter at a Cashier's "host:port" (e.g. "192.168.1.42:8080") and (re)connect. */
  connectToCashier(hostAndPort: string): void {
    const address = hostAndPort.trim() || DEFAULT_WS_URL.replace('ws://', '');
    this.cashierAddress = address;
    localStorage.setItem(CASHIER_WS_URL_KEY, address);

    this.wsSubscription?.unsubscribe();
    this.ws.connect(`ws://${address}`);

    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      this.wsConnected.set(true);
      if (msg.type === 'orders') {
        this.orderGroups.set(this.buildGroups(msg.data as Order[]));
      } else if (msg.type === 'time') {
        this.currentTime.set(msg.data as string);
      }
    });
  }

  // ── Tauri Interactivity Bridge ─────────────────────────────────────────────

  private async loadCatalogue(): Promise<void> {
    // Queries your Rust backend for the matrix instead of using a hardcoded TS file.
    const services = await invoke<ServiceItem[]>('get_pricing_matrix');
    this.allServices.set(services);
    this.extractCategories();
  }

  /**
   * Send the cart to the Cashier over the WebSocket connection instead of
   * invoke('create_order', ...). A local invoke() would only write to this
   * machine's own isolated order file — the Cashier is the single source of
   * truth, so the order has to actually reach it over the LAN. The Cashier's
   * Rust backend creates the order and rebroadcasts the updated snapshot,
   * which lands back here via the "orders" subscription above.
   */
  envoyerCommande(): void {
    if (this.cart.length === 0) return;

    if (!this.wsConnected()) {
      this.showToast('Non connecté à la caisse — vérifiez la connexion réseau');
      return;
    }

    this.ws.send({ type: 'create_order', cart: this.cart });
    this.cart = [];
    this.showToast('Commande envoyée à la caisse !');
  }

  // ── Derived View State ─────────────────────────────────────────────────────

  get filteredServices(): ServiceItem[] {
    return this.allServices().filter(s => {
      const matchType = this.activeTypeFilter === 'tous' || s.type === this.activeTypeFilter;
      const matchCat  = this.activeCategory   === 'Tous' || s.category === this.activeCategory;
      return matchType && matchCat;
    });
  }

  get filteredCategories(): string[] {
    return ['Tous', ...this.categories()];
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
    const raw = this.allServices()
      .filter(s => this.activeTypeFilter === 'tous' || s.type === this.activeTypeFilter)
      .map(s => s.category);
    this.categories.set(Array.from(new Set(raw)));
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
    this.toastMessage.set(msg);
    this.toastVisible.set(true);
    setTimeout(() => this.toastVisible.set(false), 3000);
  }

  private updateClock(): void {
    this.currentTime.set(
      new Date().toLocaleTimeString('fr-FR', {
        hour:   '2-digit',
        minute: '2-digit',
      })
    );
  }
}
