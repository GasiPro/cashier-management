// src/app/presentation/vews/counter/counter.ts
import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { WebsocketService, WsMessage } from '../../../core/service/websocket.service';
import { Subscription } from 'rxjs';

export interface ServiceItem {
  id: string;
  label: string;
  price: number;
  category: string;
  type: 'service' | 'product';
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

const LS_USERNAME = 'gasipro:username';
const LS_CASHIER_URL = 'gasipro:cashierWsUrl';
const DEFAULT_WS_HOST = '127.0.0.1:8080';

@Component({
  selector: 'app-counter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './counter.html',
})
export class Counter implements OnInit, OnDestroy {
  // ── Identity ────────────────────────────────────────────────────────────────
  username = localStorage.getItem(LS_USERNAME) ?? 'Comptoir';
  cashierHost = localStorage.getItem(LS_CASHIER_URL) ?? DEFAULT_WS_HOST;

  // ── Catalogue ───────────────────────────────────────────────────────────────
  allServices = signal<ServiceItem[]>([]);
  categories = signal<string[]>([]);

  readonly typeFilters = [
    { label: 'Tous',     value: 'tous'    },
    { label: 'Services', value: 'service' },
    { label: 'Produits', value: 'product' },
  ] as const;
  activeTypeFilter: 'tous' | 'service' | 'product' = 'tous';
  activeCategory = 'Tous';

  // ── Cart ─────────────────────────────────────────────────────────────────────
  cart: CartItem[] = [];

  // ── Order history ─────────────────────────────────────────────────────────────
  orderGroups = signal<OrderGroup[]>([]);

  // ── Connection state ──────────────────────────────────────────────────────────
  wsConnected = signal(false);
  /** True while waiting for cashier to re-approve (e.g. after a reconnect). */
  waitingApproval = signal(false);

  // ── Server management panel ───────────────────────────────────────────────────
  showServerPanel = false;
  newCashierHost = '';

  // ── UI ────────────────────────────────────────────────────────────────────────
  currentTime = signal('');
  toastVisible = signal(false);
  toastMessage = signal('');

  private clockId!: ReturnType<typeof setInterval>;
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  private closeSubscription?: Subscription;

  constructor(
    private router: Router,
    private ws: WebsocketService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.updateClock();
    this.clockId = setInterval(() => this.updateClock(), 60_000);
    await this.loadCatalogue();

    this.newCashierHost = this.cashierHost;

    this.setupWsListeners();

    const fullUrl = `ws://${this.cashierHost}`;
    this.ws.connect(fullUrl);

    // If the socket is already open (handed off from login), don't wait for onopen.
    if (this.ws.isOpen()) {
      // Connection is live and already approved (login handled approval before navigating).
      this.wsConnected.set(true);
      this.waitingApproval.set(false);
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.clockId);
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.closeSubscription?.unsubscribe();
    this.ws.disconnect();
  }

  // ── WS lifecycle ──────────────────────────────────────────────────────────────

  private setupWsListeners(): void {
    // Handle reconnect: re-send request_connection, show waiting overlay.
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      this.wsConnected.set(false);
      this.waitingApproval.set(true);
      this.ws.send({ type: 'request_connection', username: this.username });
    });

    // Handle drop: show "disconnected" state.
    this.closeSubscription = this.ws.onClosed().subscribe(() => {
      this.wsConnected.set(false);
      this.waitingApproval.set(false);
    });

    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      if (msg.type === 'connection_approved') {
        this.wsConnected.set(true);
        this.waitingApproval.set(false);
      } else if (msg.type === 'connection_rejected') {
        this.wsConnected.set(false);
        this.waitingApproval.set(false);
        this.ws.disconnect();
        this.showToast('Connexion refusée par la caisse.');
      } else if (msg.type === 'connection_blocked') {
        this.wsConnected.set(false);
        this.waitingApproval.set(false);
        this.ws.disconnect();
        this.showToast('Connexion bloquée par la caisse.');
        this.router.navigate(['/login']);
      } else if (msg.type === 'orders') {
        this.orderGroups.set(this.buildGroups(msg.data as Order[]));
      } else if (msg.type === 'time') {
        this.currentTime.set(msg.data as string);
      }
    });
  }

  // ── Server management ─────────────────────────────────────────────────────────

  disconnectFromCashier(): void {
    this.ws.disconnect();
    this.router.navigate(['/login']);
  }

  connectToNewCashier(): void {
    const host = this.newCashierHost.trim();
    if (!host) return;

    this.showServerPanel = false;
    this.cashierHost = host;
    localStorage.setItem(LS_CASHIER_URL, host);

    // Tear down current connection and set up fresh.
    this.ws.disconnect();

    // Give the socket a tick to close before reconnecting.
    setTimeout(() => {
      const fullUrl = `ws://${host}`;
      this.ws.connect(fullUrl);
      this.waitingApproval.set(true);
    }, 100);
  }

  // ── Catalogue ─────────────────────────────────────────────────────────────────

  private async loadCatalogue(): Promise<void> {
    const services = await invoke<ServiceItem[]>('get_pricing_matrix');
    this.allServices.set(services);
    this.extractCategories();
  }

  // ── Order submission ──────────────────────────────────────────────────────────

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

  // ── Derived view state ────────────────────────────────────────────────────────

  get filteredServices(): ServiceItem[] {
    return this.allServices().filter((s) => {
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
    return this.cart.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  }

  // ── Filter actions ────────────────────────────────────────────────────────────

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
      .filter((s) => this.activeTypeFilter === 'tous' || s.type === this.activeTypeFilter)
      .map((s) => s.category);
    this.categories.set(Array.from(new Set(raw)));
  }

  // ── Cart mutations ────────────────────────────────────────────────────────────

  selectService(service: ServiceItem): void {
    const found = this.cart.find((item) => item.service.id === service.id);
    if (found) {
      found.qty++;
    } else {
      this.cart.push({ service, qty: 1, unitPrice: service.price });
    }
  }

  isInCart(service: ServiceItem): boolean {
    return this.cart.some((item) => item.service.id === service.id);
  }

  cartQty(service: ServiceItem): number {
    return this.cart.find((item) => item.service.id === service.id)?.qty ?? 0;
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
    this.cart = this.cart.filter((i) => i.service.id !== item.service.id);
  }

  // ── Template helpers ──────────────────────────────────────────────────────────

  groupLabel(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }

  groupSummary(g: OrderGroup): string {
    return g.lines.map((l) => {
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

  // ── Layout formatters ──────────────────────────────────────────────────────────

  private buildGroups(orders: Order[]): OrderGroup[] {
    const map = new Map<number, Order[]>();
    for (const o of orders) {
      if (!map.has(o.group_id)) map.set(o.group_id, []);
      map.get(o.group_id)!.push(o);
    }
    const groups: OrderGroup[] = [];
    for (const [groupId, lines] of map.entries()) {
      const allPaid    = lines.every((l) => l.status === 'PAYE');
      const allWaiting = lines.every((l) => l.status === 'EN_ATTENTE');
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
      new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    );
  }
}
