import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { SessionStore } from '../../core/auth/session.store';
import { WsClient } from '../../core/realtime/ws-client';
import { WsMessage } from '../../core/realtime/ws-protocol';
import {
  getStoredCashierWsUrl,
  getStoredUsername,
  setStoredCashierWsUrl,
} from '../../core/storage/local-storage';
import {
  DEFAULT_WS,
  MAX_DISPLAY_NAME_LEN,
  MIN_PASSWORD_LEN,
  PASSWORD_HAS_DIGIT,
  PASSWORD_HAS_LETTER,
} from '../../core/config/app.constants';
import { OrderGroup, OrderLine } from '../../data/order/order.model';
import {
  buildGroups,
  formatGroupId,
  getGroupItemsSummary,
  isLineDiscounted,
  isLineIncreased,
} from '../../data/order/order.utils';
import { ServiceItem } from '../../data/pricing/pricing.model';
import { formatRelativeDay } from '../../shared/utils/date';
import { credentialsRuleError, isValidHostPort, stripWsScheme } from '../../shared/utils/validators';
import { BottomBarNotification } from '../../layouts/main-layout/bottom-bar/bottom-bar';
export interface CartItem {
  service: ServiceItem;
  qty: number;
  unitPrice: number;
  label: string;
  observation: string;
}
export interface HistoriqueDayGroup {
  dayLabel: string;
  groups: OrderGroup[];
  count: number;
}
const HISTORIQUE_ALL_STATUSES = 'TOUS';
@Injectable()
export class CounterStore {
  username = getStoredUsername() ?? 'Comptoir';
  cashierHost = stripWsScheme(getStoredCashierWsUrl() ?? DEFAULT_WS);
  private password = '';
  private pendingPassword: string | null = null;
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
  private selectedGroupId = signal<number | null>(null);
  selectedGroup = computed<OrderGroup | null>(() => {
    const id = this.selectedGroupId();
    if (id === null) return null;
    return this.orderGroups().find((g) => g.groupId === id) ?? null;
  });
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
      const dayLabel = formatRelativeDay(group.paidAt ?? group.createdAt);
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
  /** Closes every navbar-menu panel so only one can be open at a time. */
  closeAllPanels(): void {
    this.showServerPanel = false;
    this.showHistoriquePanel = false;
    this.showAccountPanel = false;
  }
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
  notifications = signal<BottomBarNotification[]>([]);
  private notificationIdCounter = 0;
  private clockId!: ReturnType<typeof setInterval>;
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  private closeSubscription?: Subscription;
  constructor(
    private router: Router,
    private ws: WsClient,
    private session: SessionStore,
  ) {}
  start(): void {
    this.updateClock();
    this.clockId = setInterval(() => this.updateClock(), 60_000);
    this.password = this.session.getCounterCredentials()?.password ?? '';
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
      this.ws.send({ type: 'request_pricing' });
    }
  }
  stop(): void {
    clearInterval(this.clockId);
    if (this.confirmDeleteGroupTimer) clearTimeout(this.confirmDeleteGroupTimer);
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.closeSubscription?.unsubscribe();
    this.ws.disconnect();
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
      const formError = credentialsRuleError(this.username, this.password);
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
        this.ws.send({ type: 'request_orders' });
        this.ws.send({ type: 'request_pricing' });
      } else if (msg.type === 'connection_rejected') {
        this.wsConnected.set(false);
        this.waitingApproval.set(false);
        this.ws.disconnect();
        this.session.clearCounterCredentials();
        this.showToast("Connexion refusée : identifiant ou mot de passe incorrect, ou accès refusé par la caisse.");
      } else if (msg.type === 'connection_blocked') {
        this.wsConnected.set(false);
        this.waitingApproval.set(false);
        this.blocked.set(true);
        this.ws.disconnect();
      } else if (msg.type === 'orders') {
        const newGroups = buildGroups(msg.data as OrderLine[]);
        this.notifyStatusChanges(newGroups);
        this.orderGroups.set(newGroups);
      } else if (msg.type === 'time') {
        this.currentTime.set(msg.data as string);
      } else if (msg.type === 'account_data') {
        const account = msg.data as { display_name: string };
        this.accountDisplayName.set(account.display_name);
        this.editDisplayName.set(account.display_name);
      } else if (msg.type === 'account_updated') {
        const account = msg.data as { display_name: string };
        this.accountDisplayName.set(account.display_name);
        if (this.pendingPassword !== null) {
          this.password = this.pendingPassword;
          this.session.setCounterCredentials(this.username, this.pendingPassword);
          this.pendingPassword = null;
        }
        this.savingAccount.set(false);
        this.editPassword.set('');
        this.editPasswordConfirm.set('');
        this.editAccountError.set('');
        this.showAccountPanel = false;
        this.showToast('Compte mis à jour.');
      } else if (msg.type === 'account_update_error') {
        this.pendingPassword = null;
        this.savingAccount.set(false);
        this.editAccountError.set(msg.data as string);
      } else if (msg.type === 'pricing') {
        this.applyPricing(msg.data as ServiceItem[]);
      } else if (msg.type === 'error_order') {
        this.showToast(msg.data as string);
      } else if (msg.type === 'error_protocol') {
        this.showToast(msg.data as string);
      }
    });
  }
  disconnectFromCashier(): void {
    this.ws.disconnect();
    this.session.clearCounterCredentials();
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
      this.ws.send({ type: 'account_get' });
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
    this.pendingPassword = password;
    const sent = this.ws.send({ type: 'account_update', display_name: displayName, password });
    if (!sent) {
      this.pendingPassword = null;
      this.savingAccount.set(false);
      this.editAccountError.set('Échec de l\'enregistrement — vérifiez la connexion réseau.');
    }
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
    setStoredCashierWsUrl(host);
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
  /** The catalogue comes from the cashier's server over the WebSocket (`pricing`), so a
   *  remote counter always sees the cashier's prices rather than a local copy. */
  private applyPricing(services: ServiceItem[]): void {
    this.allServices.set(services);
    this.extractCategories();
  }
  envoyerCommande(): void {
    if (this.cart.length === 0) return;
    if (this.hasInvalidCartPrice) {
      this.showToast('Le panier contient un prix invalide — corrigez-le avant d\'envoyer la commande.');
      return;
    }
    if (!this.wsConnected()) {
      this.showToast('Non connecté à la caisse — vérifiez la connexion réseau');
      return;
    }
    const sent = this.ws.send({ type: 'order_create', cart: this.cart });
    if (!sent) {
      this.showToast("Échec de l'envoi de la commande — vérifiez la connexion réseau.");
      return;
    }
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
    this.selectedGroupId.set(g.groupId);
  }
  closeGroupDetail(): void {
    this.selectedGroupId.set(null);
  }
  updateOrderLine(order: OrderLine): void {
    if (!this.wsConnected()) {
      this.showToast('Non connecté à la caisse — vérifiez la connexion réseau');
      return;
    }
    if (
      order.unit_price === null ||
      !Number.isInteger(Number(order.unit_price)) ||
      Number(order.unit_price) < 0 ||
      !Number.isInteger(Number(order.quantity)) ||
      Number(order.quantity) < 1
    ) {
      this.showToast('Quantité ou prix invalide — la modification n\'a pas été envoyée.');
      return;
    }
    const sent = this.ws.send({
      type: 'order_update',
      id: order.id,
      quantity: order.quantity,
      unit_price: order.unit_price,
    });
    if (!sent) {
      this.showToast('Échec de la mise à jour — vérifiez la connexion réseau.');
    }
  }
  incrementOrderLine(order: OrderLine): void {
    if (!this.wsConnected()) {
      this.showToast('Non connecté à la caisse — vérifiez la connexion réseau');
      return;
    }
    order.quantity++;
    this.updateOrderLine(order);
  }
  decrementOrderLine(order: OrderLine): void {
    if (!this.wsConnected()) {
      this.showToast('Non connecté à la caisse — vérifiez la connexion réseau');
      return;
    }
    if (order.quantity > 1) {
      order.quantity--;
      this.updateOrderLine(order);
    } else {
      this.deleteOrderLine(order);
    }
  }
  deleteOrderLine(order: OrderLine): void {
    if (!this.wsConnected()) {
      this.showToast('Non connecté à la caisse — vérifiez la connexion réseau');
      return;
    }
    const sent = this.ws.send({ type: 'order_delete', id: order.id });
    if (!sent) {
      this.showToast('Échec de la suppression — vérifiez la connexion réseau.');
    }
  }
  private confirmDeleteGroupId: number | null = null;
  private confirmDeleteGroupTimer: ReturnType<typeof setTimeout> | null = null;
  deleteOrderGroup(groupId: number): void {
    if (!this.wsConnected()) {
      this.showToast('Non connecté à la caisse — vérifiez la connexion réseau');
      return;
    }
    if (this.confirmDeleteGroupId !== groupId) {
      this.confirmDeleteGroupId = groupId;
      if (this.confirmDeleteGroupTimer) clearTimeout(this.confirmDeleteGroupTimer);
      this.confirmDeleteGroupTimer = setTimeout(() => {
        this.confirmDeleteGroupId = null;
        this.confirmDeleteGroupTimer = null;
      }, 4000);
      this.showToast('Appuyez à nouveau pour annuler cette commande.');
      return;
    }
    this.confirmDeleteGroupId = null;
    if (this.confirmDeleteGroupTimer) {
      clearTimeout(this.confirmDeleteGroupTimer);
      this.confirmDeleteGroupTimer = null;
    }
    const sent = this.ws.send({ type: 'order_delete_group', group_id: groupId });
    if (!sent) {
      this.showToast('Échec de l\'annulation — vérifiez la connexion réseau.');
      return;
    }
    this.editingGroupId.set(null);
    this.closeGroupDetail();
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
    return this.cart.reduce(
      (sum, item) => sum + item.qty * (this.isCartItemPriceInvalid(item) ? 0 : item.unitPrice),
      0,
    );
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
    return formatGroupId(groupId);
  }
  groupSummary(g: OrderGroup): string {
    return getGroupItemsSummary(g);
  }
  groupTotal(g: OrderGroup): number {
    return g.totalAmount;
  }
  historiqueItemCount(g: OrderGroup): number {
    return g.lines.reduce((sum, l) => sum + l.quantity, 0);
  }
  isCartItemDiscounted(item: CartItem): boolean {
    return item.unitPrice < item.service.price;
  }
  isCartItemIncreased(item: CartItem): boolean {
    return item.unitPrice > item.service.price;
  }
  isCartItemPriceInvalid(item: CartItem): boolean {
    return !Number.isInteger(item.unitPrice) || item.unitPrice < 0;
  }
  get hasInvalidCartPrice(): boolean {
    return this.cart.some((item) => this.isCartItemPriceInvalid(item));
  }
  updateItemPrice(item: CartItem, value: number | string | null): void {
    if (value === null || value === '') {
      item.unitPrice = NaN;
      return;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    item.unitPrice = parsed;
  }
  isLineDiscounted(order: OrderLine): boolean {
    return isLineDiscounted(order);
  }
  isLineIncreased(order: OrderLine): boolean {
    return isLineIncreased(order);
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
  groupTimeLabel(g: OrderGroup): string {
    if (g.status === 'PAYE' && g.paidAt) {
      const date = new Date(g.paidAt);
      const dayLabel = formatRelativeDay(g.paidAt);
      const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `Encaissé ${dayLabel} à ${time}`;
    }
    const dayLabel = formatRelativeDay(g.createdAt);
    return `Envoyé ${dayLabel} à ${g.time}`;
  }
  historiqueTimeLabel(g: OrderGroup): string {
    if (g.status === 'PAYE' && g.paidAt) {
      const time = new Date(g.paidAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `Encaissé à ${time}`;
    }
    return `Envoyé à ${g.time}`;
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
    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    this.notifications.update((list) =>
      [...list, { id: ++this.notificationIdCounter, message: msg, time }].slice(-30),
    );
  }
  private updateClock(): void {
    this.currentTime.set(
      new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    );
  }
}
