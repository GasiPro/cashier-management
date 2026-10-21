import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { errorMessage } from '../../../core/error/error-messages';
import { WsClient } from '../../../core/realtime/ws-client';
import { WsMessage } from '../../../core/realtime/ws-protocol';
import * as deviceApi from '../../../data/device/device.api';
import {
  BlacklistEntry,
  BlacklistEntryType,
  ConnectedDevice,
  ConnectionEvent,
  ConnectionHistoryEntry,
  PeerId,
  PendingConnection,
} from '../../../data/device/device.model';
import { isValidIp } from '../../../shared/utils/validators';
const MAX_BLACKLIST_ADDR_LEN = 64;
const MAX_BLACKLIST_REASON_LEN = 120;
@Component({
  selector: 'app-admin-devices',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './devices.page.html'
})
export class DevicesPage implements OnInit, OnDestroy {
  readonly maxBlacklistAddrLen = MAX_BLACKLIST_ADDR_LEN;
  readonly maxBlacklistReasonLen = MAX_BLACKLIST_REASON_LEN;
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  constructor(private ws: WsClient) {}
  ngOnInit(): void {
    this.loadWsAddress();
    this.loadPending();
    this.loadConnected();
    this.loadHistory();
    this.loadBlacklist();
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
  formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  displayName(item: { username?: string | null; label: string }): string {
    return item.username?.trim() || item.label;
  }
  addrOf(item: { ip_address: string; port: number }): string {
    return `${item.ip_address}:${item.port}`;
  }
  eventLabel(event: ConnectionEvent): string {
    switch (event) {
      case 'requested':
        return 'Demande reçue';
      case 'approved':
        return 'Approuvé';
      case 'refused':
        return 'Refusé';
      case 'disconnected':
        return 'Déconnecté';
      case 'blocked':
        return 'Bloqué';
      default:
        return event;
    }
  }
  wsAddress = signal('');
  loadingWsAddress = signal(true);
  private async loadWsAddress(): Promise<void> {
    this.loadingWsAddress.set(true);
    try {
      this.wsAddress.set(await deviceApi.getServerAddress());
    } catch (e) {
      console.error('failed to load ws address', e);
      this.setStatus(errorMessage(e, "Impossible de récupérer l'adresse du serveur."), true);
    } finally {
      this.loadingWsAddress.set(false);
    }
  }
  async copyWsAddress(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.wsAddress());
      this.setStatus('Adresse copiée.', false);
    } catch (e) {
      console.error('failed to copy ws address', e);
      this.setStatus("Impossible de copier l'adresse.", true);
    }
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
  loadingConnected = signal(true);
  disconnectingId = signal<PeerId | null>(null);
  private async loadConnected(silent = false): Promise<void> {
    if (!silent) this.loadingConnected.set(true);
    try {
      const devices = await deviceApi.listConnectedDevices();
      this.connectedDevices.set(devices);
    } catch (e) {
      console.error('failed to load connected devices', e);
      if (!silent) {
        this.setStatus(errorMessage(e, 'Impossible de charger les appareils connectés.'), true);
      }
    } finally {
      this.loadingConnected.set(false);
    }
  }
  async disconnectDevice(device: ConnectedDevice): Promise<void> {
    if (this.disconnectingId()) return;
    this.disconnectingId.set(device.id);
    this.setStatus('', false);
    try {
      await deviceApi.disconnectDevice(device.id);
      this.connectedDevices.update((list) => list.filter((d) => d.id !== device.id));
      this.setStatus(`« ${this.displayName(device)} » déconnecté.`, false);
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
  requestBlockDevice(device: ConnectedDevice): void {
    this.confirmingBlockId.set(device.id);
    this.blockError.set('');
  }
  cancelBlockDevice(): void {
    this.confirmingBlockId.set(null);
    this.blockError.set('');
  }
  /** Disconnects the device and adds its IP address to the blacklist in one step. */
  async confirmBlockDevice(device: ConnectedDevice): Promise<void> {
    if (this.blockingId()) return;
    this.blockingId.set(device.id);
    this.blockError.set('');
    try {
      await deviceApi.blockDevice(device.id);
      await Promise.all([this.loadConnected(true), this.loadBlacklist(true), this.loadHistory(true)]);
      this.confirmingBlockId.set(null);
      this.setStatus(`« ${this.displayName(device)} » bloqué et déconnecté.`, false);
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
  blacklist = signal<BlacklistEntry[]>([]);
  loadingBlacklist = signal(true);
  newBlacklistAddr = signal('');
  newBlacklistReason = signal('');
  addingBlacklistEntry = signal(false);
  blacklistFormError = signal('');
  newBlacklistType = signal<BlacklistEntryType>('ip');
  setBlacklistType(type: BlacklistEntryType): void {
    this.newBlacklistType.set(type);
    this.blacklistFormError.set('');
  }
  private readonly trimmedNewBlacklistAddr = computed(() => this.newBlacklistAddr().trim());
  canSubmitBlacklist = computed(() => {
    const addr = this.trimmedNewBlacklistAddr();
    return (
      addr.length > 0 &&
      addr.length <= this.maxBlacklistAddrLen &&
      !this.addingBlacklistEntry() &&
      !this.blacklist().some(
        (b) => b.type === this.newBlacklistType() && b.value.toLowerCase() === addr.toLowerCase(),
      )
    );
  });
  private async loadBlacklist(silent = false): Promise<void> {
    if (!silent) this.loadingBlacklist.set(true);
    try {
      const blacklist = await deviceApi.listBlacklist();
      this.blacklist.set(blacklist);
    } catch (e) {
      console.error('failed to load blacklist', e);
      if (!silent) {
        this.setStatus(errorMessage(e, 'Impossible de charger la liste noire.'), true);
      }
    } finally {
      this.loadingBlacklist.set(false);
    }
  }
  private validateBlacklistForm(): string {
    const addr = this.trimmedNewBlacklistAddr();
    const type = this.newBlacklistType();
    if (addr.length === 0) {
      return type === 'ip' ? 'Saisissez une adresse IP.' : "Saisissez un nom d'utilisateur.";
    }
    if (type === 'ip' && !isValidIp(addr)) {
      return 'Adresse IP invalide (ex : 192.168.1.42).';
    }
    if (addr.length > this.maxBlacklistAddrLen) {
      return `Cette valeur ne peut pas dépasser ${this.maxBlacklistAddrLen} caractères.`;
    }
    if (this.blacklist().some((b) => b.type === type && b.value.toLowerCase() === addr.toLowerCase())) {
      return type === 'ip'
        ? 'Cette adresse est déjà dans la liste noire.'
        : "Ce nom d'utilisateur est déjà dans la liste noire.";
    }
    return '';
  }
  async addBlacklistEntry(): Promise<void> {
    if (this.addingBlacklistEntry()) return;
    const formError = this.validateBlacklistForm();
    if (formError) {
      this.blacklistFormError.set(formError);
      return;
    }
    this.blacklistFormError.set('');
    this.addingBlacklistEntry.set(true);
    try {
      await deviceApi.addBlacklistEntry(
        this.newBlacklistType(),
        this.trimmedNewBlacklistAddr(),
        this.newBlacklistReason().trim() || null,
      );
      await this.loadBlacklist();
      this.newBlacklistAddr.set('');
      this.newBlacklistReason.set('');
      this.setStatus('Entrée ajoutée à la liste noire.', false);
    } catch (e) {
      console.error('add_blacklist_entry failed', e);
      const message = errorMessage(e, "Échec de l'ajout. Réessayez.");
      this.blacklistFormError.set(message);
    } finally {
      this.addingBlacklistEntry.set(false);
    }
  }
  confirmingRemoveBlacklistId = signal<PeerId | null>(null);
  removingBlacklistId = signal<PeerId | null>(null);
  removeBlacklistError = signal('');
  requestRemoveBlacklistEntry(entry: BlacklistEntry): void {
    this.confirmingRemoveBlacklistId.set(entry.id);
    this.removeBlacklistError.set('');
  }
  cancelRemoveBlacklistEntry(): void {
    this.confirmingRemoveBlacklistId.set(null);
    this.removeBlacklistError.set('');
  }
  async confirmRemoveBlacklistEntry(entry: BlacklistEntry): Promise<void> {
    if (this.removingBlacklistId()) return;
    this.removingBlacklistId.set(entry.id);
    this.removeBlacklistError.set('');
    try {
      await deviceApi.removeBlacklistEntry(entry.id);
      this.blacklist.update((list) => list.filter((b) => b.id !== entry.id));
      this.confirmingRemoveBlacklistId.set(null);
      this.setStatus('Entrée retirée de la liste noire.', false);
    } catch (e) {
      console.error('remove_blacklist_entry failed', e);
      const message = errorMessage(e, 'Échec de la suppression. Réessayez.');
      this.removeBlacklistError.set(message);
    } finally {
      this.removingBlacklistId.set(null);
    }
  }
}
