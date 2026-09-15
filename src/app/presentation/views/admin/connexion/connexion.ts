import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
const MAX_BLACKLIST_ADDR_LEN = 64;
const MAX_BLACKLIST_REASON_LEN = 120;
type ConnectionEvent = 'requested' | 'approved' | 'rejected' | 'disconnected' | 'blocked';
interface PendingConnection {
  addr: string;
  username: string;
}
interface ConnectedDevice {
  addr: string;
  username: string;
}
interface ConnectionHistoryEntry {
  addr: string;
  username: string;
  event: ConnectionEvent;
  timestamp: string;
}
interface BlacklistEntry {
  addr: string;
  reason: string | null;
  created_at: string;
}
@Component({
  selector: 'app-connexion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './connexion.html',
  styleUrl: './connexion.css',
})
export class Connexion implements OnInit {
  readonly maxBlacklistAddrLen = MAX_BLACKLIST_ADDR_LEN;
  readonly maxBlacklistReasonLen = MAX_BLACKLIST_REASON_LEN;
  ngOnInit(): void {
    this.loadWsAddress();
    this.loadPending();
    this.loadConnected();
    this.loadHistory();
    this.loadBlacklist();
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
  /** Formats an ISO/RFC3339 timestamp for display; falls back to the raw value if parsing fails. */
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
  eventLabel(event: ConnectionEvent): string {
    switch (event) {
      case 'requested':
        return 'Demande reçue';
      case 'approved':
        return 'Approuvé';
      case 'rejected':
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
      this.wsAddress.set(await invoke<string>('get_ws_address'));
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
  respondingToAddr = signal<string | null>(null);
  private async loadPending(): Promise<void> {
    this.loadingPending.set(true);
    try {
      const pending = await invoke<PendingConnection[]>('list_pending_connections');
      this.pendingConnections.set(pending);
    } catch (e) {
      console.error('failed to load pending connections', e);
      this.setStatus(this.errorMessage(e, 'Impossible de charger les demandes de connexion.'), true);
    } finally {
      this.loadingPending.set(false);
    }
  }
  async approveConnection(connection: PendingConnection): Promise<void> {
    if (this.respondingToAddr()) return;
    this.respondingToAddr.set(connection.addr);
    this.setStatus('', false);
    try {
      await invoke<void>('approve_connection', { addr: connection.addr });
      await Promise.all([this.loadPending(), this.loadConnected()]);
      this.setStatus(`« ${connection.username} » approuvé.`, false);
    } catch (e) {
      console.error('approve_connection failed', e);
      const message = this.errorMessage(e, "Échec de l'approbation. Réessayez.");
      this.setStatus(message, true);
    } finally {
      this.respondingToAddr.set(null);
    }
  }
  async rejectConnection(connection: PendingConnection): Promise<void> {
    if (this.respondingToAddr()) return;
    this.respondingToAddr.set(connection.addr);
    this.setStatus('', false);
    try {
      await invoke<void>('reject_connection', { addr: connection.addr });
      this.pendingConnections.update((list) => list.filter((c) => c.addr !== connection.addr));
      this.setStatus(`« ${connection.username} » refusé.`, false);
    } catch (e) {
      console.error('reject_connection failed', e);
      const message = this.errorMessage(e, 'Échec du refus. Réessayez.');
      this.setStatus(message, true);
    } finally {
      this.respondingToAddr.set(null);
    }
  }
  connectedDevices = signal<ConnectedDevice[]>([]);
  loadingConnected = signal(true);
  disconnectingAddr = signal<string | null>(null);
  private async loadConnected(): Promise<void> {
    this.loadingConnected.set(true);
    try {
      const devices = await invoke<ConnectedDevice[]>('list_connected_devices');
      this.connectedDevices.set(devices);
    } catch (e) {
      console.error('failed to load connected devices', e);
      this.setStatus(this.errorMessage(e, 'Impossible de charger les appareils connectés.'), true);
    } finally {
      this.loadingConnected.set(false);
    }
  }
  async disconnectDevice(device: ConnectedDevice): Promise<void> {
    if (this.disconnectingAddr()) return;
    this.disconnectingAddr.set(device.addr);
    this.setStatus('', false);
    try {
      await invoke<void>('disconnect_device', { addr: device.addr });
      this.connectedDevices.update((list) => list.filter((d) => d.addr !== device.addr));
      this.setStatus(`« ${device.username} » déconnecté.`, false);
    } catch (e) {
      console.error('disconnect_device failed', e);
      const message = this.errorMessage(e, 'Échec de la déconnexion. Réessayez.');
      this.setStatus(message, true);
    } finally {
      this.disconnectingAddr.set(null);
    }
  }
  confirmingBlockAddr = signal<string | null>(null);
  blockingAddr = signal<string | null>(null);
  blockError = signal('');
  requestBlockDevice(device: ConnectedDevice): void {
    this.confirmingBlockAddr.set(device.addr);
    this.blockError.set('');
  }
  cancelBlockDevice(): void {
    this.confirmingBlockAddr.set(null);
    this.blockError.set('');
  }
  /** Disconnects the device and adds its IP address to the blacklist in one step. */
  async confirmBlockDevice(device: ConnectedDevice): Promise<void> {
    if (this.blockingAddr()) return;
    this.blockingAddr.set(device.addr);
    this.blockError.set('');
    try {
      await invoke<void>('block_device', { addr: device.addr });
      await Promise.all([this.loadConnected(), this.loadBlacklist()]);
      this.confirmingBlockAddr.set(null);
      this.setStatus(`« ${device.username} » bloqué et déconnecté.`, false);
    } catch (e) {
      console.error('block_device failed', e);
      const message = this.errorMessage(e, 'Échec du blocage. Réessayez.');
      this.blockError.set(message);
    } finally {
      this.blockingAddr.set(null);
    }
  }
  history = signal<ConnectionHistoryEntry[]>([]);
  loadingHistory = signal(true);
  private async loadHistory(): Promise<void> {
    this.loadingHistory.set(true);
    try {
      const history = await invoke<ConnectionHistoryEntry[]>('list_connection_history');
      this.history.set(history);
    } catch (e) {
      console.error('failed to load connection history', e);
      this.setStatus(this.errorMessage(e, "Impossible de charger l'historique des connexions."), true);
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
  private readonly trimmedNewBlacklistAddr = computed(() => this.newBlacklistAddr().trim());
  canSubmitBlacklist = computed(() => {
    const addr = this.trimmedNewBlacklistAddr();
    return (
      addr.length > 0 &&
      addr.length <= this.maxBlacklistAddrLen &&
      !this.addingBlacklistEntry() &&
      !this.blacklist().some((b) => b.addr.toLowerCase() === addr.toLowerCase())
    );
  });
  private async loadBlacklist(): Promise<void> {
    this.loadingBlacklist.set(true);
    try {
      const blacklist = await invoke<BlacklistEntry[]>('list_blacklist_entries');
      this.blacklist.set(blacklist);
    } catch (e) {
      console.error('failed to load blacklist', e);
      this.setStatus(this.errorMessage(e, 'Impossible de charger la liste noire.'), true);
    } finally {
      this.loadingBlacklist.set(false);
    }
  }
  private validateBlacklistForm(): string {
    const addr = this.trimmedNewBlacklistAddr();
    if (addr.length === 0) {
      return 'Saisissez une adresse IP.';
    }
    if (addr.length > this.maxBlacklistAddrLen) {
      return `Cette valeur ne peut pas dépasser ${this.maxBlacklistAddrLen} caractères.`;
    }
    if (this.blacklist().some((b) => b.addr.toLowerCase() === addr.toLowerCase())) {
      return 'Cette adresse est déjà dans la liste noire.';
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
      await invoke<void>('add_blacklist_entry', {
        addr: this.trimmedNewBlacklistAddr(),
        reason: this.newBlacklistReason().trim() || null,
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
  confirmingRemoveBlacklistAddr = signal<string | null>(null);
  removingBlacklistAddr = signal<string | null>(null);
  removeBlacklistError = signal('');
  requestRemoveBlacklistEntry(entry: BlacklistEntry): void {
    this.confirmingRemoveBlacklistAddr.set(entry.addr);
    this.removeBlacklistError.set('');
  }
  cancelRemoveBlacklistEntry(): void {
    this.confirmingRemoveBlacklistAddr.set(null);
    this.removeBlacklistError.set('');
  }
  async confirmRemoveBlacklistEntry(entry: BlacklistEntry): Promise<void> {
    if (this.removingBlacklistAddr()) return;
    this.removingBlacklistAddr.set(entry.addr);
    this.removeBlacklistError.set('');
    try {
      await invoke<void>('remove_blacklist_entry', { addr: entry.addr });
      this.blacklist.update((list) => list.filter((b) => b.addr !== entry.addr));
      this.confirmingRemoveBlacklistAddr.set(null);
      this.setStatus('Entrée retirée de la liste noire.', false);
    } catch (e) {
      console.error('remove_blacklist_entry failed', e);
      const message = this.errorMessage(e, 'Échec de la suppression. Réessayez.');
      this.removeBlacklistError.set(message);
    } finally {
      this.removingBlacklistAddr.set(null);
    }
  }
}