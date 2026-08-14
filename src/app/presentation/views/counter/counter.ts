
// src/app/presentation/vews/counter/counter.ts
import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
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
  /** Editable display label for this line, defaults to the service's label. */
  label: string;
  /** Free-text note for the cashier (e.g. special instructions). */
  observation: string;
}

export interface Order {
  id: number;
  group_id: number;
  service_type: string;
  unit_price: number;
  /** Catalogue price before any manual adjustment by the counter (0 = not tracked). */
  original_unit_price: number;
  quantity: number;
  status: 'EN_ATTENTE' | 'PAYE' | 'REJETEE';
  time: string;
  created_at: string;
  paid_at: string | null;
  /** Free-text note left by the counter for the cashier when the order was placed. */
  observation: string;
  /** Reason given by the cashier when cancelling (rejecting) this order, if any. */
  raison: string | null;
}

interface OrderGroup {
  groupId: number;
  lines: Order[];
  status: 'EN_ATTENTE' | 'PAYE' | 'REJETEE' | 'MIXTE';
  time: string;
  createdAt: string;
  paidAt: string | null;
}

/** One day's worth of history, pre-grouped for the full-page Historique panel. */
interface HistoriqueDayGroup {
  dayLabel: string;
  groups: OrderGroup[];
  count: number;
}

const LS_USERNAME = 'gasipro:username';
const LS_CASHIER_URL = 'gasipro:cashierWsUrl';
const DEFAULT_WS_HOST = '127.0.0.1:8080';
const HISTORIQUE_ALL_STATUSES = 'TOUS';

/** Kept in sync with the bounds in src-tauri/src/config/accounts.rs. */
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
/** Password must contain at least one letter and one digit ("word + number"),
 *  mirroring the format check in `accounts::validate_password`. */
const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_DIGIT = /\d/;

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
  /** Kept in memory only (never persisted) — carried over from the login flow via
   *  `WebsocketService`, and re-sent on reconnect / server switch. Populated in
   *  `ngOnInit` since it depends on the injected `ws` service. */
  private password = '';

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
  /** Snapshot shown on the order-taking screen — status at a glance, no filters. */
  recentOrderGroups = computed(() => this.orderGroups().slice(0, 5));
  /** groupId of the pending order currently being edited from the history panel, if any. */
  editingGroupId = signal<number | null>(null);
  /** Order group currently shown in the full-detail modal, if any. */
  selectedGroup = signal<OrderGroup | null>(null);

  // ── Historique panel: status filter ─────────────────────────────────────────
  readonly historiqueAllStatuses = HISTORIQUE_ALL_STATUSES;
  readonly historiqueStatusFilters = [
    { label: 'Toutes',      value: HISTORIQUE_ALL_STATUSES },
    { label: 'En attente',  value: 'EN_ATTENTE' as const },
    { label: 'Payées',      value: 'PAYE' as const },
    { label: 'Refusées',    value: 'REJETEE' as const },
  ];
  selectedHistoriqueStatus = signal<string>(HISTORIQUE_ALL_STATUSES);
  /** Full history filtered to the currently selected status, if any. */
  filteredHistoriqueGroups = computed(() => {
    const status = this.selectedHistoriqueStatus();
    const groups = this.orderGroups();
    return status === HISTORIQUE_ALL_STATUSES ? groups : groups.filter((g) => g.status === status);
  });
  /**
   * Filtered history split into day buckets (most recent day first, groups within a day
   * already newest-first) — the "worthy extra" that turns a flat feed into something a
   * comptoir can actually scan, unlike the brief unsorted snapshot on the order screen.
   */
  historiqueGroupsByDay = computed<HistoriqueDayGroup[]>(() => {
    const days: HistoriqueDayGroup[] = [];
    const byLabel = new Map<string, HistoriqueDayGroup>();
    for (const group of this.filteredHistoriqueGroups()) {
      const dayLabel = this.formatRelativeDay(group.paidAt ?? group.createdAt);
      let bucket = byLabel.get(dayLabel);
      if (!bucket) {
        bucket = { dayLabel, groups: [], count: 0 };
        byLabel.set(dayLabel, bucket);
        days.push(bucket);
      }
      bucket.groups.push(group);
      bucket.count += 1;
    }
    return days;
  });

  // ── Connection state ──────────────────────────────────────────────────────────
  wsConnected = signal(false);
  /** True while waiting for cashier to re-approve (e.g. after a reconnect). */
  waitingApproval = signal(false);
  /** True once the cashier has blocked this device — no auto-reconnect. */
  blocked = signal(false);
  /** Set when stored credentials fail the local format/length check on a
   *  reconnect attempt, so `request_connection` is never sent with an
   *  obviously invalid username or password. */
  credentialsError = signal('');

  // ── Menu / panels ────────────────────────────────────────────────────────────
  showMenu = false;
  showServerPanel = false;
  showHistoriquePanel = false;
  newCashierHost = '';
  /** Result of probing newCashierHost for a running server, shown as a hint/warning. */
  newCashierAddressCheck = signal<'idle' | 'checking' | 'reachable' | 'unreachable'>('idle');

  // ── Cart line notes ──────────────────────────────────────────────────────────
  /** ids of cart items whose observation field is expanded. */
  private noteOpenIds = new Set<string>();

  // ── Cancel confirmation ─────────────────────────────────────────────────────
  confirmingCancel = false;

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

    this.password = this.ws.getCounterCredentials()?.password ?? '';
    this.newCashierHost = this.cashierHost;

    this.setupWsListeners();

    const fullUrl = `ws://${this.cashierHost}`;
    this.ws.connect(fullUrl);

    // If the socket is already open (handed off from login), don't wait for onopen.
    if (this.ws.isOpen()) {
      // Connection is live and already approved (login handled approval before navigating).
      this.wsConnected.set(true);
      this.waitingApproval.set(false);
      // The order snapshot the server pushed right after approval was likely sent
      // while login.ts was already unsubscribed and this component wasn't listening
      // yet — ask for a fresh one now that we're actually ready to receive it.
      this.ws.send({ type: 'request_orders' });
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

  /** Client-side check, mirroring the server-side validation in accounts.rs —
   *  format, length, and the "word + number" rule. Returns a message, or ''
   *  if the credentials look valid. */
  private validateCredentials(username: string, password: string): string {
    if (username.length < MIN_USERNAME_LEN) {
      return `Le nom d'utilisateur doit contenir au moins ${MIN_USERNAME_LEN} caractères.`;
    }
    if (username.length > MAX_USERNAME_LEN) {
      return `Le nom d'utilisateur ne peut pas dépasser ${MAX_USERNAME_LEN} caractères.`;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LEN} caractères.`;
    }
    if (!PASSWORD_HAS_LETTER.test(password) || !PASSWORD_HAS_DIGIT.test(password)) {
      return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    }
    return '';
  }

  private setupWsListeners(): void {
    // Handle reconnect: re-send request_connection, show waiting overlay.
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      // Credentials are checked locally before request_connection is ever sent,
      // whether this open event is a drop/reconnect or a manual server switch.
      const formError = this.validateCredentials(this.username, this.password);
      if (formError) {
        this.credentialsError.set(formError);
        this.wsConnected.set(false);
        this.waitingApproval.set(false);
        this.ws.disconnect();
        this.showToast(formError);
        return;
      }
      this.credentialsError.set('');
      this.wsConnected.set(false);
      this.waitingApproval.set(true);
      this.ws.send({ type: 'request_connection', username: this.username, password: this.password });
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
        this.ws.clearCounterCredentials();
        // Wrong username/password and a manual refusal by the cashier both
        // arrive as the same event, so the message covers both cases.
        this.showToast("Connexion refusée : identifiant ou mot de passe incorrect, ou accès refusé par la caisse.");
      } else if (msg.type === 'connection_blocked') {
        this.wsConnected.set(false);
        this.waitingApproval.set(false);
        this.blocked.set(true);
        this.ws.disconnect();
      } else if (msg.type === 'orders') {
        const newGroups = this.buildGroups(msg.data as Order[]);
        this.notifyStatusChanges(newGroups);
        this.orderGroups.set(newGroups);
      } else if (msg.type === 'time') {
        this.currentTime.set(msg.data as string);
      }
    });
  }

  // ── Server management ─────────────────────────────────────────────────────────

  disconnectFromCashier(): void {
    this.ws.disconnect();
    this.ws.clearCounterCredentials();
    this.router.navigate(['/login']);
  }

  /** Resets the address check hint — called whenever the field is edited. */
  onNewCashierHostChanged(): void {
    this.newCashierAddressCheck.set('idle');
  }

  /** Probes newCashierHost for a running server and updates newCashierAddressCheck. */
  async checkNewCashierHost(): Promise<void> {
    const raw = this.newCashierHost.trim();
    if (!raw) {
      this.newCashierAddressCheck.set('idle');
      return;
    }
    this.newCashierAddressCheck.set('checking');
    const fullUrl = raw.startsWith('ws://') ? raw : `ws://${raw}`;
    const reachable = await this.ws.checkAddress(fullUrl);
    // Ignore a stale result if the field changed while we were checking.
    if (this.newCashierHost.trim() !== raw) return;
    this.newCashierAddressCheck.set(reachable ? 'reachable' : 'unreachable');
  }

  connectToNewCashier(): void {
    const host = this.newCashierHost.trim();
    if (!host) return;

    this.showServerPanel = false;
    this.newCashierAddressCheck.set('idle');
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
    this.noteOpenIds.clear();
    this.confirmingCancel = false;
    this.showToast('Commande envoyée à la caisse !');
  }

  // ── Cart cancellation ────────────────────────────────────────────────────────

  /** Toggle the inline "are you sure?" confirmation before wiping the cart. */
  toggleCancelConfirm(): void {
    this.confirmingCancel = !this.confirmingCancel;
  }

  /** Clear the current cart (called once the cancellation is confirmed). */
  annulerCommande(): void {
    if (this.cart.length === 0) {
      this.confirmingCancel = false;
      return;
    }
    this.cart = [];
    this.noteOpenIds.clear();
    this.confirmingCancel = false;
    this.showToast('Commande annulée.');
  }

  // ── Pending order mutations (while EN_ATTENTE only) ───────────────────────────

  /** Show/hide the inline edit controls for a pending order group in the history panel. */
  toggleEditGroup(groupId: number): void {
    this.editingGroupId.set(this.editingGroupId() === groupId ? null : groupId);
  }

  isEditingGroup(groupId: number): boolean {
    return this.editingGroupId() === groupId;
  }

  /** Set which status should be shown in the Historique panel ('TOUS' = all). */
  setHistoriqueStatusFilter(status: string): void {
    this.selectedHistoriqueStatus.set(status);
  }

  // ── Order detail modal ────────────────────────────────────────────────────────

  /** Open the full-detail modal for a given order group (pending or history). */
  openGroupDetail(g: OrderGroup): void {
    this.selectedGroup.set(g);
  }

  closeGroupDetail(): void {
    this.selectedGroup.set(null);
  }

  /** Push a single order line's current quantity/price to the cashier. */
  updateOrderLine(order: Order): void {
    if (!this.wsConnected()) return;
    this.ws.send({
      type: 'update_order',
      id: order.id,
      quantity: order.quantity,
      unit_price: order.unit_price,
    });
  }

  incrementOrderLine(order: Order): void {
    order.quantity++;
    this.updateOrderLine(order);
  }

  decrementOrderLine(order: Order): void {
    if (order.quantity > 1) {
      order.quantity--;
      this.updateOrderLine(order);
    } else {
      this.deleteOrderLine(order);
    }
  }

  /** Remove a single line from a still-pending order. */
  deleteOrderLine(order: Order): void {
    if (!this.wsConnected()) return;
    this.ws.send({ type: 'delete_order', id: order.id });
  }

  /** Cancel an entire pending order (all its lines). */
  deleteOrderGroup(groupId: number): void {
    if (!this.wsConnected()) return;
    this.ws.send({ type: 'delete_order_group', group_id: groupId });
    this.editingGroupId.set(null);
    this.showToast('Commande annulée.');
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
      this.cart.push({ service, qty: 1, unitPrice: service.price, label: service.label, observation: '' });
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
    this.noteOpenIds.delete(item.service.id);
    this.cart = this.cart.filter((i) => i.service.id !== item.service.id);
    if (this.cart.length === 0) {
      this.confirmingCancel = false;
    }
  }

  // ── Cart line label & observation ─────────────────────────────────────────────

  /** Update a cart line's editable label. */
  updateItemLabel(item: CartItem, value: string): void {
    item.label = value.trim() || item.service.label;
  }

  /** Update a cart line's free-text observation for the cashier. */
  updateItemObservation(item: CartItem, value: string): void {
    item.observation = value;
  }

  /** Show/hide the observation field for a given cart line. */
  toggleItemNote(item: CartItem): void {
    const id = item.service.id;
    if (this.noteOpenIds.has(id)) {
      this.noteOpenIds.delete(id);
    } else {
      this.noteOpenIds.add(id);
    }
  }

  isNoteOpen(item: CartItem): boolean {
    return this.noteOpenIds.has(item.service.id);
  }

  // ── Template helpers ──────────────────────────────────────────────────────────

  groupLabel(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }

  /**
   * Brief, categorized summary of a group's lines, e.g.
   * "Impression: Couleur x4, Normal NB x8 • Reliure: Spirale x2".
   */
  groupSummary(g: OrderGroup): string {
    return this.formatGroupSummary(g.lines);
  }

  /** Sum of quantity × unit price across a group's lines. */
  groupTotal(g: OrderGroup): number {
    return g.lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
  }

  /** Total quantity of items across a group's lines, for the compact "N articles" indicator. */
  historiqueItemCount(g: OrderGroup): number {
    return g.lines.reduce((sum, l) => sum + l.quantity, 0);
  }

  /** Groups lines by category and formats each as "Category: Label x2, Label2 x1". */
  private formatGroupSummary(lines: Order[]): string {
    const categoryOrder: string[] = [];
    const byCategory = new Map<string, string[]>();
    for (const l of lines) {
      const parts = l.service_type.split(' — ');
      const category = parts.length > 1 ? parts[0] : 'Autre';
      const label = parts.length > 1 ? parts[1] : l.service_type;
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
        categoryOrder.push(category);
      }
      byCategory.get(category)!.push(`${label} x${l.quantity}`);
    }
    return categoryOrder
      .map((category) => `${category}: ${byCategory.get(category)!.join(', ')}`)
      .join(' • ');
  }

  /** True if a cart line's price has been lowered below the service's catalogue price. */
  isCartItemDiscounted(item: CartItem): boolean {
    return item.unitPrice < item.service.price;
  }

  /** True if a cart line's price has been raised above the service's catalogue price. */
  isCartItemIncreased(item: CartItem): boolean {
    return item.unitPrice > item.service.price;
  }

  /** True if a placed order line's price was edited down from its original catalogue price. */
  isLineDiscounted(order: Order): boolean {
    return order.original_unit_price > 0 && order.unit_price < order.original_unit_price;
  }

  /** True if a placed order line's price was edited up from its original catalogue price. */
  isLineIncreased(order: Order): boolean {
    return order.original_unit_price > 0 && order.unit_price > order.original_unit_price;
  }

  /** True if any line of the group carries a manually-applied discount. */
  groupHasDiscount(g: OrderGroup): boolean {
    return g.lines.some((l) => this.isLineDiscounted(l));
  }

  /** True if any line of the group carries a manually-applied price increase. */
  groupHasIncrease(g: OrderGroup): boolean {
    return g.lines.some((l) => this.isLineIncreased(l));
  }

  groupStatusLabel(g: OrderGroup): string {
    if (g.status === 'PAYE')       return 'Payé';
    if (g.status === 'EN_ATTENTE') return 'En attente';
    if (g.status === 'REJETEE')    return 'Refusée';
    return 'Mixte';
  }

  groupStatusClass(g: OrderGroup): string {
    if (g.status === 'PAYE')       return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
    if (g.status === 'EN_ATTENTE') return 'bg-amber-50  text-amber-700  border border-amber-100';
    if (g.status === 'REJETEE')    return 'bg-red-50 text-red-700 border border-red-100';
    return 'bg-gray-50 text-gray-700 border border-gray-100';
  }

  /** Reason the cashier gave for refusing this group, if it was rejected and one was provided. */
  groupRejectReason(g: OrderGroup): string | null {
    return g.lines.find((l) => l.raison)?.raison ?? null;
  }

  /** "aujourd'hui", "hier", or the localized date, based on the given ISO timestamp. */
  private formatRelativeDay(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

    if (diffDays === 0) return "aujourd'hui";
    if (diffDays === 1) return 'hier';
    return date.toLocaleDateString('fr-FR');
  }

  /**
   * Human-readable date/time label for a history entry: shows when it was paid if
   * settled, otherwise when it was created — e.g. "Encaissé hier à 14:32" or
   * "Envoyé aujourd'hui à 09:05".
   */
  groupTimeLabel(g: OrderGroup): string {
    if (g.status === 'PAYE' && g.paidAt) {
      const date = new Date(g.paidAt);
      const dayLabel = this.formatRelativeDay(g.paidAt);
      const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `Encaissé ${dayLabel} à ${time}`;
    }
    const dayLabel = this.formatRelativeDay(g.createdAt);
    return `Envoyé ${dayLabel} à ${g.time}`;
  }

  /**
   * Time-only label for a history entry inside the day-grouped Historique panel, where the
   * day is already shown by the section header — e.g. "Encaissé à 14:32" or "Envoyé à 09:05".
   */
  historiqueTimeLabel(g: OrderGroup): string {
    if (g.status === 'PAYE' && g.paidAt) {
      const time = new Date(g.paidAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `Encaissé à ${time}`;
    }
    return `Envoyé à ${g.time}`;
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
      const allPaid     = lines.every((l) => l.status === 'PAYE');
      const allWaiting   = lines.every((l) => l.status === 'EN_ATTENTE');
      const allRejected = lines.every((l) => l.status === 'REJETEE');
      groups.push({
        groupId,
        lines,
        status: allPaid ? 'PAYE' : allWaiting ? 'EN_ATTENTE' : allRejected ? 'REJETEE' : 'MIXTE',
        time:    lines[0].time,
        createdAt: lines[0].created_at,
        paidAt: lines[0].paid_at,
      });
    }
    return groups.sort((a, b) => b.groupId - a.groupId);
  }

  /**
   * Compares freshly-pushed order groups against the current state to detect groups that
   * just transitioned out of EN_ATTENTE (i.e. the cashier just acted on them), and surfaces
   * the same toast used for "Commande envoyée à la caisse !" — accepted or refused, with the
   * cashier's reason when one was given.
   */
  private notifyStatusChanges(newGroups: OrderGroup[]): void {
    const previousStatuses = new Map(this.orderGroups().map((g) => [g.groupId, g.status]));
    for (const g of newGroups) {
      const prevStatus = previousStatuses.get(g.groupId);
      if (prevStatus !== 'EN_ATTENTE') continue;
      if (g.status === 'PAYE') {
        this.showToast(`Commande ${this.groupLabel(g.groupId)} acceptée par la caisse !`);
      } else if (g.status === 'REJETEE') {
        const reason = this.groupRejectReason(g);
        this.showToast(
          reason
            ? `Commande ${this.groupLabel(g.groupId)} refusée : ${reason}`
            : `Commande ${this.groupLabel(g.groupId)} refusée.`,
        );
      }
    }
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
