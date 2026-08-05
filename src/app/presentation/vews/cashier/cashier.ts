// src/app/presentation/vews/cashier/cashier.ts
import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { WebsocketService, WsMessage } from '../../../core/service/websocket.service';
import { Subscription } from 'rxjs';

export interface Order {
  id: number;
  group_id: number;
  service_type: string;
  unit_price: number;
  quantity: number;
  status: 'EN_ATTENTE' | 'PAYE' | 'REJETEE';
  time: string;
  created_at: string;
  paid_at: string | null;
}

export interface OrderGroup {
  groupId: number;
  lines: Order[];
  totalAmount: number;
  time: string;
  createdAt: string;
  paidAt?: string | null;
}

interface RapportLine {
  label: string;
  unitPrice: number;
  qty: number;
  total: number;
}

interface RapportCategoryGroup {
  category: string;
  lines: RapportLine[];
}

export interface ConnectionRequest {
  addr: string;
  username: string;
}

export interface ConnectedDevice {
  addr: string;
  username: string;
}

const CASHIER_LOCAL_WS_URL = 'ws://127.0.0.1:8080';
const LS_USERNAME = 'gasipro:username';

@Component({
  selector: 'app-cashier',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cashier.html',
})
export class Cashier implements OnInit, OnDestroy {
  // ── Identity ────────────────────────────────────────────────────────────────
  username = localStorage.getItem(LS_USERNAME) ?? 'Caisse';

  // ── Order state (from WS broadcast) ─────────────────────────────────────────
  currentTime = signal('');
  pendingGroups = signal<OrderGroup[]>([]);
  paidGroups = signal<OrderGroup[]>([]);
  recentPaidGroups = computed(() => this.paidGroups().slice(0, 5));
  totalRevenue = signal(0);
  volumeByService = signal<Record<string, number>>({});
  wsConnected = signal(false);

  // ── Device management (from WS broadcast) ────────────────────────────────────
  pendingRequests = signal<ConnectionRequest[]>([]);
  connectedDevices = signal<ConnectedDevice[]>([]);
  showDevicesPanel = false;

  // ── UI ──────────────────────────────────────────────────────────────────────
  showMenu = false;
  showRapport = false;
  showHistorique = false;
  wsAddress = signal('');

  private _rawPaidOrders: Order[] = [];
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;

  constructor(
    private router: Router,
    private ws: WebsocketService,
  ) {}

  ngOnInit(): void {
    // Load WS address for display in header
    invoke<string>('get_ws_address')
      .then((addr) => this.wsAddress.set(addr))
      .catch(() => this.wsAddress.set('ws://127.0.0.1:8080'));

    // Subscribe to messages
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      this.wsConnected.set(true);
      if (msg.type === 'orders') {
        this.applyOrders(msg.data as Order[]);
      } else if (msg.type === 'time') {
        this.currentTime.set(msg.data as string);
      } else if (msg.type === 'connection_requests') {
        this.pendingRequests.set(msg.data as ConnectionRequest[]);
      } else if (msg.type === 'connected_devices') {
        this.connectedDevices.set(msg.data as ConnectedDevice[]);
      }
    });

    // Connect and register as cashier when the socket opens
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      this.ws.send({ type: 'cashier_register', username: this.username });
    });

    this.ws.connect(CASHIER_LOCAL_WS_URL);

    // If socket is already open (e.g. navigated back from elsewhere), register immediately
    if (this.ws.isOpen()) {
      this.ws.send({ type: 'cashier_register', username: this.username });
    }
  }

  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
  }

  // ── Device management ────────────────────────────────────────────────────────

  get totalPendingRequests(): number {
    return this.pendingRequests().length;
  }

  async approveDevice(addr: string): Promise<void> {
    try {
      await invoke('approve_connection', { addr });
    } catch (e) {
      console.error('approve_connection failed', e);
    }
  }

  async rejectDevice(addr: string): Promise<void> {
    try {
      await invoke('reject_connection', { addr });
    } catch (e) {
      console.error('reject_connection failed', e);
    }
  }

  async disconnectDevice(addr: string): Promise<void> {
    try {
      await invoke('disconnect_device', { addr });
    } catch (e) {
      console.error('disconnect_device failed', e);
    }
  }

  // ── Rust bridge ───────────────────────────────────────────────────────────────

  async markGroupAsPaid(groupId: number): Promise<void> {
    await invoke('mark_group_as_paid', { groupId });
  }

  /** Refuse an entire pending order (e.g. rupture de stock, client parti). */
  async rejectGroup(groupId: number): Promise<void> {
    try {
      await invoke('reject_group', { groupId });
    } catch (e) {
      console.error('reject_group failed', e);
    }
  }

  copyWsAddress(): void {
    navigator.clipboard.writeText(this.wsAddress()).catch(() => {});
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  // ── Template helpers ─────────────────────────────────────────────────────────

  formatGroupId(groupId: number): string {
    return '#' + String(groupId).padStart(4, '0');
  }

  getGroupItemsSummary(group: OrderGroup): string {
    return group.lines
      .map((l) => {
        const parts = l.service_type.split(' — ');
        return `${l.quantity}× ${parts[1] ?? l.service_type}`;
      })
      .join(', ');
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

  /** Human-readable "Encaissé aujourd'hui/hier/le JJ/MM/AAAA à HH:MM" label for the history table. */
  formatPaidLabel(group: OrderGroup): string {
    if (!group.paidAt) return '';
    const date = new Date(group.paidAt);
    const dayLabel = this.formatRelativeDay(group.paidAt);
    const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `Encaissé ${dayLabel} à ${time}`;
  }

  /** Human-readable "aujourd'hui/hier/JJ/MM/AAAA à HH:MM" label for a pending order's creation time. */
  formatCreatedLabel(group: OrderGroup): string {
    const dayLabel = this.formatRelativeDay(group.createdAt);
    return `${dayLabel} à ${group.time}`;
  }

  rapportGroups(): RapportCategoryGroup[] {
    const map = new Map<string, Map<string, RapportLine>>();
    for (const order of this.todaysPaidOrders()) {
      const [category, label] = order.service_type.split(' — ');
      const key = label ?? order.service_type;
      if (!map.has(category)) map.set(category, new Map());
      const cat = map.get(category)!;
      if (!cat.has(key)) {
        cat.set(key, { label: key, unitPrice: order.unit_price, qty: 0, total: 0 });
      }
      const entry = cat.get(key)!;
      entry.qty += order.quantity;
      entry.total += order.quantity * order.unit_price;
    }
    return Array.from(map.entries()).map(([category, lines]) => ({
      category,
      lines: Array.from(lines.values()),
    }));
  }

  /** Chiffre d'affaires du rapport (jour courant uniquement). */
  rapportRevenue(): number {
    return this.todaysPaidOrders().reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
  }

  /** Nombre de clients (commandes distinctes) encaissés aujourd'hui. */
  rapportClientsCount(): number {
    return new Set(this.todaysPaidOrders().map((o) => o.group_id)).size;
  }

  /** Date du rapport, ex. "mardi 4 août 2026" — jour, mois et année en toutes lettres. */
  rapportDateLabel(): string {
    return new Date().toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /** Plage horaire couverte par le rapport, de la première à la dernière commande encaissée aujourd'hui. */
  rapportTimeRange(): string {
    const orders = this.todaysPaidOrders();
    if (orders.length === 0) return '';
    const timestamps = orders
      .map((o) => new Date(o.paid_at as string).getTime())
      .sort((a, b) => a - b);
    const format = (t: number) =>
      new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `${format(timestamps[0])} – ${format(timestamps[timestamps.length - 1])}`;
  }

  /** Commandes payées appartenant à la journée en cours — seule base du rapport. */
  private todaysPaidOrders(): Order[] {
    return this._rawPaidOrders.filter((o) => o.paid_at && this.isToday(o.paid_at));
  }

  private isToday(iso: string): boolean {
    const date = new Date(iso);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return startOfDay(date) === startOfDay(now);
  }

  // ── Derivation from "orders" broadcast ───────────────────────────────────────

  private applyOrders(orders: Order[]): void {
    this._rawPaidOrders = orders.filter((o) => o.status === 'PAYE');
    const pendingOrders = orders.filter((o) => o.status === 'EN_ATTENTE');
    this.pendingGroups.set(this.buildGroups(pendingOrders));
    this.paidGroups.set(this.buildGroups(this._rawPaidOrders));
    this.totalRevenue.set(
      this._rawPaidOrders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0),
    );
    this.volumeByService.set(
      this._rawPaidOrders.reduce((acc, o) => {
        acc[o.service_type] = (acc[o.service_type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    );
  }

  private buildGroups(orders: Order[]): OrderGroup[] {
    const map = new Map<number, Order[]>();
    for (const o of orders) {
      if (!map.has(o.group_id)) map.set(o.group_id, []);
      map.get(o.group_id)!.push(o);
    }
    const groups: OrderGroup[] = [];
    for (const [groupId, lines] of map.entries()) {
      groups.push({
        groupId,
        lines,
        totalAmount: lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
        time: lines[0].time,
        createdAt: lines[0].created_at,
        paidAt: lines[0].paid_at,
      });
    }
    return groups.sort((a, b) => b.groupId - a.groupId);
  }
}
