import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { LOCAL_WS_URL } from '../../core/config/app.constants';
import { WsRegistration } from '../../core/auth/ws-registration';
import { errorMessage } from '../../core/error/error-messages';
import { WsClient } from '../../core/realtime/ws-client';
import { WsMessage } from '../../core/realtime/ws-protocol';
import { getStoredDisplayName, getStoredUsername } from '../../core/storage/local-storage';
import {
  approveConnection,
  blockDevice,
  disconnectDevice,
  getServerAddress,
  rejectConnection,
} from '../../data/device/device.api';
import { PeerId } from '../../data/device/device.model';
import { DeviceStore } from '../../data/device/device.store';
import { markGroupPaid, rejectGroup } from '../../data/order/order.api';
import { OrderStore } from '../../data/order/order.store';
import { formatGroupId } from '../../data/order/order.utils';
import { BottomBar } from '../../layouts/main-layout/bottom-bar/bottom-bar';
import { LeftSidebar } from '../../layouts/main-layout/sidebar/sidebar';
import { Navbar } from '../../layouts/main-layout/navbar/navbar';
import { CashierStore } from './cashier.store';
import { DaySummary } from './components/day-summary/day-summary';
import { DevicesPanel, deviceDisplayName } from './components/devices-panel/devices-panel';
import { HistoryPanel } from './components/history-panel/history-panel';
import { OrderDetailModal } from './components/order-detail-modal/order-detail-modal';
import { PaidTable } from './components/paid-table/paid-table';
import { PendingList } from './components/pending-list/pending-list';
import { RejectDialog } from './components/reject-dialog/reject-dialog';
import { ReportPanel } from './components/report-panel/report-panel';
@Component({
  selector: 'app-cashier',
  standalone: true,
  imports: [
    CommonModule,
    Navbar,
    LeftSidebar,
    BottomBar,
    DaySummary,
    PendingList,
    PaidTable,
    OrderDetailModal,
    RejectDialog,
    HistoryPanel,
    ReportPanel,
    DevicesPanel,
  ],
  providers: [CashierStore],
  templateUrl: './cashier.page.html',
})
export class CashierPage implements OnInit, OnDestroy {
  username = getStoredUsername() ?? 'Caisse';
  private accountDisplayName = getStoredDisplayName() ?? '';
  /** Name shown in the navbar — the account display name when one exists, otherwise the username. */
  get displayLabel(): string {
    return this.accountDisplayName.trim() ? this.accountDisplayName : this.username;
  }
  currentTime = signal('');
  wsConnected = signal(false);
  wsAddress = signal('');
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  private approved = false;
  constructor(
    private router: Router,
    private ws: WsClient,
    private registration: WsRegistration,
    public orders: OrderStore,
    public devices: DeviceStore,
    public store: CashierStore,
  ) {}
  ngOnInit(): void {
    getServerAddress()
      .then((addr) => this.wsAddress.set(addr))
      .catch(() => this.wsAddress.set('127.0.0.1:8080'));
    void this.devices.loadMaxDevices().catch(() => {});
    this.orders.start();
    this.devices.startLive();
    void this.devices.loadPending(true);
    void this.devices.loadConnected(true);
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      if (msg.type === 'error_protocol') {
        if (!this.approved) {
          this.returnToLogin();
        }
        return;
      }
      this.approved = true;
      this.wsConnected.set(true);
      if (msg.type === 'time') {
        this.currentTime.set(msg.data as string);
      }
    });
    this.openSubscription = this.ws.onOpened().subscribe(() => this.registerOnOpen());
    this.ws.connect(LOCAL_WS_URL);
    if (this.ws.isOpen()) {
      this.registerOnOpen();
    }
  }
  private registerOnOpen(): void {
    if (this.approved) {
      this.returnToLogin();
      return;
    }
    if (!this.registration.registerCashier(this.username)) {
      this.returnToLogin();
    }
  }
  private returnToLogin(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
    this.router.navigate(['/login']);
  }
  ngOnDestroy(): void {
    this.orders.stop();
    this.devices.stopLive();
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.ws.disconnect();
  }
  get totalPendingRequests(): number {
    return this.devices.pendingConnections().length;
  }
  async approveDevice(id: PeerId): Promise<void> {
    if (this.store.busyDeviceId() !== null) return;
    this.store.busyDeviceId.set(id);
    const req = this.devices.pendingConnections().find((r) => r.id === id);
    try {
      await approveConnection(id);
      this.store.notify(`« ${req ? deviceDisplayName(req) : 'Appareil'} » approuvé.`);
    } catch (e) {
      console.error('connection_approve failed', e);
      this.store.notify(errorMessage(e, "Impossible d'approuver cet appareil."));
    } finally {
      this.store.busyDeviceId.set(null);
    }
  }
  async rejectDevice(id: PeerId): Promise<void> {
    if (this.store.busyDeviceId() !== null) return;
    this.store.busyDeviceId.set(id);
    const req = this.devices.pendingConnections().find((r) => r.id === id);
    try {
      await rejectConnection(id);
      this.store.notify(`« ${req ? deviceDisplayName(req) : 'Appareil'} » refusé.`);
    } catch (e) {
      console.error('connection_reject failed', e);
      this.store.notify(errorMessage(e, 'Impossible de refuser cet appareil.'));
    } finally {
      this.store.busyDeviceId.set(null);
    }
  }
  async disconnectDevice(id: PeerId): Promise<void> {
    if (this.store.busyDeviceId() !== null) return;
    this.store.busyDeviceId.set(id);
    const dev = this.devices.connectedDevices().find((d) => d.id === id);
    try {
      await disconnectDevice(id);
      this.store.notify(`« ${dev ? deviceDisplayName(dev) : 'Appareil'} » déconnecté.`);
    } catch (e) {
      console.error('connection_disconnect failed', e);
      this.store.notify(errorMessage(e, 'Impossible de déconnecter cet appareil.'));
    } finally {
      this.store.busyDeviceId.set(null);
    }
  }
  async blockDevice(id: PeerId): Promise<void> {
    if (this.store.busyDeviceId() !== null) return;
    this.store.busyDeviceId.set(id);
    const dev = this.devices.connectedDevices().find((d) => d.id === id);
    try {
      await blockDevice(id);
      this.store.confirmingBlockDeviceId.set(null);
      this.store.notify(`« ${dev ? deviceDisplayName(dev) : 'Appareil'} » bloqué et déconnecté.`);
    } catch (e) {
      console.error('connection_block failed', e);
      this.store.notify(errorMessage(e, 'Impossible de bloquer cet appareil.'));
    } finally {
      this.store.busyDeviceId.set(null);
    }
  }
  async markGroupAsPaid(groupId: number): Promise<void> {
    if (this.store.busyGroupId() !== null) return;
    this.store.busyGroupId.set(groupId);
    try {
      await markGroupPaid(groupId);
      this.store.notify(`Commande ${formatGroupId(groupId)} encaissée.`);
    } catch (e) {
      console.error('group_mark_paid failed', e);
      this.store.notify(errorMessage(e, "Impossible d'encaisser cette commande."));
    } finally {
      this.store.busyGroupId.set(null);
    }
  }
  async rejectGroup(groupId: number, raison?: string): Promise<void> {
    if (this.store.busyGroupId() !== null) return;
    this.store.busyGroupId.set(groupId);
    try {
      await rejectGroup(groupId, raison?.trim() ? raison.trim() : null);
      this.store.notify(`Commande ${formatGroupId(groupId)} refusée.`);
    } catch (e) {
      console.error('group_reject failed', e);
      this.store.notify(errorMessage(e, 'Impossible de refuser cette commande.'));
    } finally {
      this.store.busyGroupId.set(null);
    }
  }
  async confirmRejectGroup(): Promise<void> {
    const group = this.store.rejectGroupTarget();
    if (!group) return;
    await this.rejectGroup(group.groupId, this.store.rejectReason());
    this.store.closeRejectDialog();
  }
  copyWsAddress(): void {
    navigator.clipboard.writeText(this.wsAddress()).catch(() => {});
  }
  goToSettings(): void {
    this.store.closePanel();
    this.router.navigate(['/reglages']);
  }
}
