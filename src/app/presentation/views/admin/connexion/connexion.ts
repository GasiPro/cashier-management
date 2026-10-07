import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { Subscription } from 'rxjs';
import { WebsocketService, WsMessage } from '../../../../core/service/websocket.service';
const MAX_BLACKLIST_ADDR_LEN = 64;
const MAX_BLACKLIST_REASON_LEN = 120;
const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_REGEX = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`);
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;
type BlacklistEntryType = 'ip' | 'username';
type PeerId = string | number;
type ConnectionEvent = 'requested' | 'approved' | 'refused' | 'disconnected' | 'blocked';
interface PendingConnection {
  id: PeerId;
  label: string;
  username?: string | null;
  ip_address: string;
  port: number;
  requested_at: string;
}
interface ConnectedDevice {
  id: PeerId;
  label: string;
  username?: string | null;
  ip_address: string;
  port: number;
  connected_at: string;
}
interface ConnectionHistoryEntry {
  id: PeerId;
  label: string;
  username?: string | null;
  ip_address: string;
  event: ConnectionEvent;
  at: string;
}
interface BlacklistEntry {
  id: PeerId;
  type: 'ip' | 'username';
  value: string;
  reason?: string | null;
  created_at: string;
}
@Component({
  selector: 'app-connexion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './connexion.html',
  styleUrl: './connexion.css',
})
export class Connexion implements OnInit, OnDestroy {
  readonly maxBlacklistAddrLen = MAX_BLACKLIST_ADDR_LEN;
  readonly maxBlacklistReasonLen = MAX_BLACKLIST_REASON_LEN;
  private wsSubscription?: Subscription;
  private openSubscription?: Subscription;
  constructor(private ws: WebsocketService) {}
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
  /** Tauri rejects with `unknown` — usually a string, sometimes an Error or a
   *  serialized object. Extract something readable, or fall back to `fallback`. */
  private errorMessage(e: unknown, fallback: string): string {
    if (typeof e === 'string') return e.trim() || fallback;
    if (e instanceof Error) return e.message.trim() || fallback;
    if (e && typeof e === 'object' && 'message' in e) {
      const message = String((e as { message: unknown }).message).trim();
      if (message) return message;
    }
    if (e === null || e === undefined) return fallback;
    const text = String(e).trim();
    return text && text !== '[object Object]' ? text : fallback;
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
      this.wsAddress.set(await invoke<string>('server', { command: { method: 'get_address' } }));
    } catch (e) {
      console.error('failed to load ws address', e);
      this.setStatus(this.errorMessage(e, "Impossible de récupérer l'adresse du serveur."), true);
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
      const pending = await invoke<PendingConnection[]>('server', {
        command: { method: 'connection_list_pending' },
      });
      this.pendingConnections.set(pending);
    } catch (e) {
      console.error('failed to load pending connections', e);
      if (!silent) {
        this.setStatus(this.errorMessage(e, 'Impossible de charger les demandes de connexion.'), true);
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
      await invoke<void>('server', {
        command: { method: 'connection_approve', id: connection.id },
      });
      await Promise.all([this.loadPending(true), this.loadConnected(true), this.loadHistory(true)]);
      this.setStatus(`« ${this.displayName(connection)} » approuvé.`, false);
    } catch (e) {
      console.error('approve_connection failed', e);
      const message = this.errorMessage(e, "Échec de l'approbation. Réessayez.");
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
      await invoke<void>('server', {
        command: { method: 'connection_reject', id: connection.id },
      });
      this.pendingConnections.update((list) => list.filter((c) => c.id !== connection.id));
      this.setStatus(`« ${this.displayName(connection)} » refusé.`, false);
      void this.loadHistory(true);
    } catch (e) {
      console.error('reject_connection failed', e);
      const message = this.errorMessage(e, 'Échec du refus. Réessayez.');
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
      const devices = await invoke<ConnectedDevice[]>('server', {
        command: { method: 'connection_list_connected' },
      });
      this.connectedDevices.set(devices);
    } catch (e) {
      console.error('failed to load connected devices', e);
      if (!silent) {
        this.setStatus(this.errorMessage(e, 'Impossible de charger les appareils connectés.'), true);
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
      await invoke<void>('server', {
        command: { method: 'connection_disconnect', id: device.id },
      });
      this.connectedDevices.update((list) => list.filter((d) => d.id !== device.id));
      this.setStatus(`« ${this.displayName(device)} » déconnecté.`, false);
      void this.loadHistory(true);
    } catch (e) {
      console.error('disconnect_device failed', e);
      const message = this.errorMessage(e, 'Échec de la déconnexion. Réessayez.');
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
      await invoke<BlacklistEntry>('server', {
        command: { method: 'connection_block', id: device.id },
      });
      await Promise.all([this.loadConnected(true), this.loadBlacklist(true), this.loadHistory(true)]);
      this.confirmingBlockId.set(null);
      this.setStatus(`« ${this.displayName(device)} » bloqué et déconnecté.`, false);
    } catch (e) {
      console.error('block_device failed', e);
      const message = this.errorMessage(e, 'Échec du blocage. Réessayez.');
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
      const history = await invoke<ConnectionHistoryEntry[]>('server', {
        command: { method: 'connection_history' },
      });
      this.history.set(history);
    } catch (e) {
      console.error('failed to load connection history', e);
      if (!silent) {
        this.setStatus(this.errorMessage(e, "Impossible de charger l'historique des connexions."), true);
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
  private isValidIp(value: string): boolean {
    return IPV4_REGEX.test(value) || (value.includes(':') && IPV6_REGEX.test(value));
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
      const blacklist = await invoke<BlacklistEntry[]>('server', {
        command: { method: 'connection_blacklist_list' },
      });
      this.blacklist.set(blacklist);
    } catch (e) {
      console.error('failed to load blacklist', e);
      if (!silent) {
        this.setStatus(this.errorMessage(e, 'Impossible de charger la liste noire.'), true);
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
    if (type === 'ip' && !this.isValidIp(addr)) {
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
      await invoke<BlacklistEntry>('server', {
        command: {
          method: 'connection_blacklist_add',
          entry_type: this.newBlacklistType(),
          value: this.trimmedNewBlacklistAddr(),
          reason: this.newBlacklistReason().trim() || null,
        },
      });
      await this.loadBlacklist();
      this.newBlacklistAddr.set('');
      this.newBlacklistReason.set('');
      this.setStatus('Entrée ajoutée à la liste noire.', false);
    } catch (e) {
      console.error('add_blacklist_entry failed', e);
      const message = this.errorMessage(e, "Échec de l'ajout. Réessayez.");
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
      await invoke<void>('server', {
        command: { method: 'connection_blacklist_remove', id: entry.id },
      });
      this.blacklist.update((list) => list.filter((b) => b.id !== entry.id));
      this.confirmingRemoveBlacklistId.set(null);
      this.setStatus('Entrée retirée de la liste noire.', false);
    } catch (e) {
      console.error('remove_blacklist_entry failed', e);
      const message = this.errorMessage(e, 'Échec de la suppression. Réessayez.');
      this.removeBlacklistError.set(message);
    } finally {
      this.removingBlacklistId.set(null);
    }
  }
}
