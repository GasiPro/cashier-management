import { Injectable, computed, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { WsClient } from '../../core/realtime/ws-client';
import { WsMessage } from '../../core/realtime/ws-protocol';
import { getMaxDevices, listConnectedDevices, listPendingConnections } from './device.api';
import { ConnectedDevice, PendingConnection } from './device.model';
@Injectable({ providedIn: 'root' })
export class DeviceStore {
  readonly pendingConnections = signal<PendingConnection[]>([]);
  readonly connectedDevices = signal<ConnectedDevice[]>([]);
  readonly loadingPending = signal(true);
  readonly loadingConnected = signal(true);
  readonly maxConnectedDevices = signal<number>(0);
  readonly totalPendingRequests = computed(() => this.pendingConnections().length);
  readonly atDeviceCapacity = computed(
    () => this.maxConnectedDevices() > 0 && this.connectedDevices().length >= this.maxConnectedDevices(),
  );
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  constructor(private ws: WsClient) {}
  async loadPending(silent = false): Promise<void> {
    if (!silent) this.loadingPending.set(true);
    try {
      this.pendingConnections.set(await listPendingConnections());
    } catch (e) {
      console.error('failed to load pending connections', e);
      if (!silent) throw e;
    } finally {
      this.loadingPending.set(false);
    }
  }
  async loadConnected(silent = false): Promise<void> {
    if (!silent) this.loadingConnected.set(true);
    try {
      this.connectedDevices.set(await listConnectedDevices());
    } catch (e) {
      console.error('failed to load connected devices', e);
      if (!silent) throw e;
    } finally {
      this.loadingConnected.set(false);
    }
  }
  async loadMaxDevices(): Promise<void> {
    this.maxConnectedDevices.set(await getMaxDevices());
  }
  removePending(id: PendingConnection['id']): void {
    this.pendingConnections.update((list) => list.filter((c) => c.id !== id));
  }
  removeConnected(id: ConnectedDevice['id']): void {
    this.connectedDevices.update((list) => list.filter((d) => d.id !== id));
  }
  startLive(): void {
    this.stopLive();
    this.wsSubscription = this.ws.getMessages().subscribe((msg: WsMessage) => {
      if (msg.type === 'connection_requests') {
        void this.loadPending(true);
      } else if (msg.type === 'connection_devices') {
        void this.loadConnected(true);
      }
    });
    this.openSubscription = this.ws.onOpened().subscribe(() => {
      void this.loadPending(true);
      void this.loadConnected(true);
    });
  }
  stopLive(): void {
    this.wsSubscription?.unsubscribe();
    this.openSubscription?.unsubscribe();
    this.wsSubscription = undefined;
    this.openSubscription = undefined;
  }
}
