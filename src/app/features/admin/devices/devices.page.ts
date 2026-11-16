import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { errorMessage } from '../../../core/error/error-messages';
import { WsClient } from '../../../core/realtime/ws-client';
import { WsMessage } from '../../../core/realtime/ws-protocol';
import * as deviceApi from '../../../data/device/device.api';
import {
  ConnectedDevice,
  ConnectionHistoryEntry,
  PeerId,
  PendingConnection,
} from '../../../data/device/device.model';
import { DeviceCard } from './device-card/device-card';
export interface ConnectedRow {
  entry: ConnectionHistoryEntry;
  peerId: PeerId | null;
}
@Component({
  selector: 'app-admin-devices',
  standalone: true,
  imports: [CommonModule, DeviceCard],
  templateUrl: './devices.page.html'
})
export class DevicesPage implements OnInit, OnDestroy {
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  constructor(private ws: WsClient) {}
  ngOnInit(): void {
    this.loadPending();
    this.loadConnected();
    this.loadHistory();
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      if (msg.type === 'connection_requests') {
        void this.loadPending(true);
        void this.loadHistory(true);
      } else if (msg.type === 'connection_devices') {
        void this.loadConnected(true);
        void this.loadHistory(true);
      }
    });
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      void this.loadPending(true);
      void this.loadConnected(true);
      void this.loadHistory(true);
    });
  }
  ngOnDestroy(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
  }
  statusMessage = signal('');
  statusIsError = signal(false);
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }
  displayName(item: { username?: string | null; label: string }): string {
    return item.username?.trim() || item.label;
  }
  pendingConnections = signal<PendingConnection[]>([]);
  loadingPending = signal(true);
  respondingToId = signal<PeerId | null>(null);
  private async loadPending(silent = false): Promise<void> {
    if (!silent) this.loadingPending.set(true);
    try {
      const pending = await deviceApi.listPendingConnections();
      this.pendingConnections.set(pending);
    } catch (e) {
      console.error('failed to load pending connections', e);
      if (!silent) {
        this.setStatus(errorMessage(e, 'Impossible de charger les demandes de connexion.'), true);
      }
    } finally {
      this.loadingPending.set(false);
    }
  }
  async approveConnection(connection: PendingConnection): Promise<void> {
    if (this.respondingToId()) return;
    this.respondingToId.set(connection.id);
    this.setStatus('', false);
    try {
      await deviceApi.approveConnection(connection.id);
      await Promise.all([this.loadPending(true), this.loadConnected(true), this.loadHistory(true)]);
      this.setStatus(`« ${this.displayName(connection)} » approuvé.`, false);
    } catch (e) {
      console.error('approve_connection failed', e);
      const message = errorMessage(e, "Échec de l'approbation. Réessayez.");
      this.setStatus(message, true);
    } finally {
      this.respondingToId.set(null);
    }
  }
  async rejectConnection(connection: PendingConnection): Promise<void> {
    if (this.respondingToId()) return;
    this.respondingToId.set(connection.id);
    this.setStatus('', false);
    try {
      await deviceApi.rejectConnection(connection.id);
      this.pendingConnections.update((list) => list.filter((c) => c.id !== connection.id));
      this.setStatus(`« ${this.displayName(connection)} » refusé.`, false);
      void this.loadHistory(true);
    } catch (e) {
      console.error('reject_connection failed', e);
      const message = errorMessage(e, 'Échec du refus. Réessayez.');
      this.setStatus(message, true);
    } finally {
      this.respondingToId.set(null);
    }
  }
  connectedDevices = signal<ConnectedDevice[]>([]);
  disconnectingId = signal<PeerId | null>(null);
  private async loadConnected(silent = false): Promise<void> {
    try {
      const devices = await deviceApi.listConnectedDevices();
      this.connectedDevices.set(devices);
    } catch (e) {
      console.error('failed to load connected devices', e);
      if (!silent) {
        this.setStatus(errorMessage(e, 'Impossible de charger les appareils connectés.'), true);
      }
    }
  }
  private peerIdOf(entry: ConnectionHistoryEntry): PeerId | null {
    const peer = this.connectedDevices().find(
      (d) => d.device_id === entry.device_id && d.username === entry.username,
    );
    return peer?.id ?? null;
  }
  async disconnectDevice(row: ConnectedRow): Promise<void> {
    const id = row.peerId;
    if (id === null || this.disconnectingId()) return;
    this.disconnectingId.set(id);
    this.setStatus('', false);
    try {
      await deviceApi.disconnectDevice(id);
      this.connectedDevices.update((list) => list.filter((d) => d.id !== id));
      this.setStatus(`« ${row.entry.username} » déconnecté.`, false);
      void this.loadHistory(true);
    } catch (e) {
      console.error('disconnect_device failed', e);
      const message = errorMessage(e, 'Échec de la déconnexion. Réessayez.');
      this.setStatus(message, true);
    } finally {
      this.disconnectingId.set(null);
    }
  }
  confirmingBlockId = signal<PeerId | null>(null);
  blockingId = signal<PeerId | null>(null);
  blockError = signal('');
  requestBlockDevice(row: ConnectedRow): void {
    if (row.peerId === null) return;
    this.confirmingBlockId.set(row.peerId);
    this.blockError.set('');
  }
  cancelBlockDevice(): void {
    this.confirmingBlockId.set(null);
    this.blockError.set('');
  }
  /** Disconnects the device and adds its IP address to the blacklist in one step. */
  async confirmBlockDevice(row: ConnectedRow): Promise<void> {
    const id = row.peerId;
    if (id === null || this.blockingId()) return;
    this.blockingId.set(id);
    this.blockError.set('');
    try {
      await deviceApi.blockDevice(id);
      await Promise.all([this.loadConnected(true), this.loadHistory(true)]);
      this.confirmingBlockId.set(null);
      this.setStatus(`« ${row.entry.username} » bloqué et déconnecté.`, false);
    } catch (e) {
      console.error('block_device failed', e);
      const message = errorMessage(e, 'Échec du blocage. Réessayez.');
      this.blockError.set(message);
    } finally {
      this.blockingId.set(null);
    }
  }
  history = signal<ConnectionHistoryEntry[]>([]);
  loadingHistory = signal(true);
  connectedRows = computed<ConnectedRow[]>(() =>
    this.history()
      .filter((entry) => entry.event === 'approved')
      .map((entry) => ({ entry, peerId: this.peerIdOf(entry) })),
  );
  pastEntries = computed(() =>
    this.history().filter((entry) => entry.event !== 'approved' && entry.event !== 'requested'),
  );
  private async loadHistory(silent = false): Promise<void> {
    if (!silent) this.loadingHistory.set(true);
    try {
      const history = await deviceApi.listConnectionHistory();
      this.history.set(history);
    } catch (e) {
      console.error('failed to load connection history', e);
      if (!silent) {
        this.setStatus(errorMessage(e, "Impossible de charger l'historique des connexions."), true);
      }
    } finally {
      this.loadingHistory.set(false);
    }
  }
}
