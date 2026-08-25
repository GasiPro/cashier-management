import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { WebsocketService, WsMessage, isValidHostPort, stripWsScheme } from '../../../core/service/websocket.service';
import { Navbar } from '../../shared/navbar/navbar';
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
  label: string;
  observation: string;
}
export interface Order {
  id: number;
  group_id: number;
  service_type: string;
  unit_price: number;
  original_unit_price: number;
  quantity: number;
  status: 'EN_ATTENTE' | 'PAYE' | 'REJETEE';
  time: string;
  created_at: string;
  paid_at: string | null;
  observation: string;
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
interface HistoriqueDayGroup {
  dayLabel: string;
  groups: OrderGroup[];
  count: number;
}
const LS_USERNAME = 'gasipro:username';
const LS_CASHIER_URL = 'gasipro:cashierWsUrl';
const DEFAULT_WS_HOST = '127.0.0.1:8080';
const HISTORIQUE_ALL_STATUSES = 'TOUS';
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
const MAX_DISPLAY_NAME_LEN = 40;
const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_DIGIT = /\d/;
@Component({
  selector: 'app-counter',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar],
  templateUrl: './counter.html',
})
export class Counter implements OnInit, OnDestroy {
  username = localStorage.getItem(LS_USERNAME) ?? 'Comptoir';
  cashierHost = localStorage.getItem(LS_CASHIER_URL) ?? DEFAULT_WS_HOST;
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
  cart: CartItem[] = [];
  orderGroups = signal<OrderGroup[]>([]);
  recentOrderGroups = computed(() => this.orderGroups().slice(0, 5));
  editingGroupId = signal<number | null>(null);
  selectedGroup = signal<OrderGroup | null>(null);
  readonly historiqueAllStatuses = HISTORIQUE_ALL_STATUSES;
  readonly historiqueStatusFilters = [
    { label: 'Toutes',      value: HISTORIQUE_ALL_STATUSES },
    { label: 'En attente',  value: 'EN_ATTENTE' as const },
    { label: 'Payées',      value: 'PAYE' as const },
    { label: 'Refusées',    value: 'REJETEE' as const },
  ];
  selectedHistoriqueStatus = signal<string>(HISTORIQUE_ALL_STATUSES);
  filteredHistoriqueGroups = computed(() => {
    const status = this.selectedHistoriqueStatus();
    const groups = this.orderGroups();
    return status === HISTORIQUE_ALL_STATUSES ? groups : groups.filter((g) => g.status === status);
  });
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
  wsConnected = signal(false);
  waitingApproval = signal(false);
  blocked = signal(false);
  credentialsError = signal('');
  // ── Menu / panels ────────────────────────────────────────────────────────────
  showServerPanel = false;
  showHistoriquePanel = false;
  newCashierHost = '';
  /** Result of probing newCashierHost for a running server, shown as a hint/warning.
   *  'invalid_format' is a synchronous check (bad IP/port shape) and never touches
   *  the network; 'unreachable' means the shape is fine but nothing answered there
   *  (server down, or the address doesn't exist). */
  newCashierAddressCheck = signal<'idle' | 'checking' | 'reachable' | 'unreachable' | 'invalid_format'>('idle');
  serverConnectError = signal('');
  /** True from the moment a connect is kicked off (initial load or manual switch)
   *  until the socket opens — lets the very first failure be reported once, without
   *  re-showing an error on every background auto-reconnect retry after that. */
  private awaitingConnectResult = false;
  // ── Account settings ────────────────────────────────────────────────────────
  readonly maxDisplayNameLen = MAX_DISPLAY_NAME_LEN;
  readonly minPasswordLen = MIN_PASSWORD_LEN;
  showAccountPanel = false;
  /** Display name as last confirmed by the server; used to prefill the edit form. */
  private accountDisplayName = signal('');
  /** Name shown in the navbar — the account display name when one exists, otherwise the username. */
  displayLabel = computed(() => this.accountDisplayName().trim() || this.username);
  editDisplayName = signal('');
  editPassword = signal('');
  editPasswordConfirm = signal('');
  /** Toggles the password/confirm fields between masked and plain text. */
  showEditPassword = signal(false);
  savingAccount = signal(false);
  /** Inline validation or server error for the account form, announced via aria-live. */
  editAccountError = signal('');
  /** An empty new-password pair is valid — it means "leave the password unchanged". */
  canSubmitEditAccount = computed(() => {
    if (this.savingAccount()) return false;
    if (this.editDisplayName().trim().length > this.maxDisplayNameLen) return false;
    const password = this.editPassword();
    const confirm = this.editPasswordConfirm();
    if (password.length === 0 && confirm.length === 0) return true;
    return (
      password.length >= this.minPasswordLen &&
      PASSWORD_HAS_LETTER.test(password) &&
      PASSWORD_HAS_DIGIT.test(password) &&
      password === confirm
    );
  });
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
    this.awaitingConnectResult = true;
    this.ws.connect(fullUrl);
    // If the socket is already open (handed off from login), don't wait for onopen.
    if (this.ws.isOpen()) {
      this.awaitingConnectResult = false;
      this.wsConnected.set(true);
      this.waitingApproval.set(false);
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
      // The socket reached the server, so any pending "server down / not found"
      // error no longer applies.
      this.awaitingConnectResult = false;
      this.serverConnectError.set('');
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
    this.closeSubscription = this.ws.onClosed().subscribe(() => {
      this.wsConnected.set(false);
      this.waitingApproval.set(false);
      if (this.awaitingConnectResult) {
        this.awaitingConnectResult = false;
        const message = `Impossible de joindre le serveur à l'adresse ${this.cashierHost} : ` +
          'il est peut-être éteint ou l\'adresse est incorrecte.';
        this.serverConnectError.set(message);
        this.showToast(message);
      }
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
      } else if (msg.type === 'account') {
        const account = msg.data as { display_name: string };
        this.accountDisplayName.set(account.display_name);
        this.editDisplayName.set(account.display_name);
      } else if (msg.type === 'account_updated') {
        const account = msg.data as { display_name: string };
        this.accountDisplayName.set(account.display_name);
        this.savingAccount.set(false);
        this.editPassword.set('');
        this.editPasswordConfirm.set('');
        this.editAccountError.set('');
        this.showAccountPanel = false;
        this.showToast('Compte mis à jour.');
      } else if (msg.type === 'account_update_error') {
        this.savingAccount.set(false);
        this.editAccountError.set(msg.data as string);
      }
    });
  }
  disconnectFromCashier(): void {
    this.ws.disconnect();
    this.ws.clearCounterCredentials();
    this.router.navigate(['/login']);
  }
  openAccountPanel(): void {
    this.editDisplayName.set(this.accountDisplayName());
    this.editPassword.set('');
    this.editPasswordConfirm.set('');
    this.showEditPassword.set(false);
    this.editAccountError.set('');
    this.showAccountPanel = true;
    if (this.wsConnected()) {
      this.ws.send({ type: 'get_account' });
    }
  }
  closeAccountPanel(): void {
    if (this.savingAccount()) return;
    this.showAccountPanel = false;
  }
  toggleEditPasswordVisibility(): void {
    this.showEditPassword.update((v) => !v);
  }
  private validateEditAccountForm(): string {
    if (this.editDisplayName().trim().length > this.maxDisplayNameLen) {
      return `Le nom affiché ne peut pas dépasser ${this.maxDisplayNameLen} caractères.`;
    }
    const password = this.editPassword();
    const confirm = this.editPasswordConfirm();
    if (password.length > 0 || confirm.length > 0) {
      if (password.length < this.minPasswordLen) {
        return `Le mot de passe doit contenir au moins ${this.minPasswordLen} caractères.`;
      }
      if (!PASSWORD_HAS_LETTER.test(password) || !PASSWORD_HAS_DIGIT.test(password)) {
        return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
      }
      if (password !== confirm) {
        return 'Les mots de passe ne correspondent pas.';
      }
    }
    return '';
  }
  saveAccountSettings(): void {
    if (this.savingAccount()) return;
    if (!this.wsConnected()) {
      this.editAccountError.set('Non connecté à la caisse — vérifiez la connexion réseau.');
      return;
    }
    const formError = this.validateEditAccountForm();
    if (formError) {
      this.editAccountError.set(formError);
      return;
    }
    this.editAccountError.set('');
    this.savingAccount.set(true);
    const displayName = this.editDisplayName().trim();
    const password = this.editPassword().length > 0 ? this.editPassword() : null;
    this.ws.send({ type: 'update_account', display_name: displayName, password });
  }
  onNewCashierHostChanged(): void {
    this.newCashierAddressCheck.set('idle');
  }
  async checkNewCashierHost(): Promise<void> {
    const raw = this.newCashierHost.trim();
    if (!raw) {
      this.newCashierAddressCheck.set('idle');
      return;
    }
    if (!isValidHostPort(raw)) {
      this.newCashierAddressCheck.set('invalid_format');
      return;
    }
    this.newCashierAddressCheck.set('checking');
    const fullUrl = `ws://${stripWsScheme(raw)}`;
    const reachable = await this.ws.checkAddress(fullUrl);
    if (this.newCashierHost.trim() !== raw) return;
    this.newCashierAddressCheck.set(reachable ? 'reachable' : 'unreachable');
  }
  connectToNewCashier(): void {
    const raw = this.newCashierHost.trim();
    if (!raw) return;
    if (!isValidHostPort(raw)) {
      this.newCashierAddressCheck.set('invalid_format');
      this.showToast("Adresse invalide : utilisez le format IP:port, par exemple 192.168.1.5:8080.");
      return;
    }
    const host = stripWsScheme(raw);
    this.showServerPanel = false;
    this.newCashierAddressCheck.set('idle');
    this.serverConnectError.set('');
    this.cashierHost = host;
    localStorage.setItem(LS_CASHIER_URL, host);
    // Tear down current connection and set up fresh.
    this.ws.disconnect();
    // Give the socket a tick to close before reconnecting.
    setTimeout(() => {
      const fullUrl = `ws://${host}`;
      this.awaitingConnectResult = true;
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
  toggleCancelConfirm(): void {
    this.confirmingCancel = !this.confirmingCancel;
  }
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
  toggleEditGroup(groupId: number): void {
    this.editingGroupId.set(this.editingGroupId() === groupId ? null : groupId);
  }
  isEditingGroup(groupId: number): boolean {
    return this.editingGroupId() === groupId;
  }
  setHistoriqueStatusFilter(status: string): void {
    this.selectedHistoriqueStatus.set(status);
  }
  openGroupDetail(g: OrderGroup): void {
    this.selectedGroup.set(g);
  }
  closeGroupDetail(): void {
    this.selectedGroup.set(null);
  }
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
  deleteOrderLine(order: Order): void {
    if (!this.wsConnected()) return;
    this.ws.send({ type: 'delete_order', id: order.id });
  }
  deleteOrderGroup(groupId: number): void {
    if (!this.wsConnected()) return;
    this.ws.send({ type: 'delete_order_group', group_id: groupId });
    this.editingGroupId.set(null);
    this.showToast('Commande annulée.');
  }
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
  updateItemObservation(item: CartItem, value: string): void {
    item.observation = value;
  }
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
  groupLabel(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }
  groupSummary(g: OrderGroup): string {
    return this.formatGroupSummary(g.lines);
  }
  groupTotal(g: OrderGroup): number {
    return g.lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
  }
  historiqueItemCount(g: OrderGroup): number {
    return g.lines.reduce((sum, l) => sum + l.quantity, 0);
  }
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
  isCartItemDiscounted(item: CartItem): boolean {
    return item.unitPrice < item.service.price;
  }
  isCartItemIncreased(item: CartItem): boolean {
    return item.unitPrice > item.service.price;
  }
  isLineDiscounted(order: Order): boolean {
    return order.original_unit_price > 0 && order.unit_price < order.original_unit_price;
  }
  isLineIncreased(order: Order): boolean {
    return order.original_unit_price > 0 && order.unit_price > order.original_unit_price;
  }
  groupHasDiscount(g: OrderGroup): boolean {
    return g.lines.some((l) => this.isLineDiscounted(l));
  }
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
  groupRejectReason(g: OrderGroup): string | null {
    return g.lines.find((l) => l.raison)?.raison ?? null;
  }
  private formatRelativeDay(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
    if (diffDays === 0) return "aujourd'hui";
    if (diffDays === 1) return 'hier';
    return date.toLocaleDateString('fr-FR');
  }
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
  historiqueTimeLabel(g: OrderGroup): string {
    if (g.status === 'PAYE' && g.paidAt) {
      const time = new Date(g.paidAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `Encaissé à ${time}`;
    }
    return `Envoyé à ${g.time}`;
  }
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
