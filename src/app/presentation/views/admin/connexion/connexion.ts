import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';

const MAX_BLACKLIST_VALUE_LEN = 64;
const MAX_BLACKLIST_REASON_LEN = 120;

type BlacklistType = 'ip' | 'username';
type ConnectionEvent = 'connected' | 'disconnected' | 'approved' | 'refused' | 'blocked';

interface BlacklistTypeChoice {
  value: BlacklistType;
  label: string;
}

const BLACKLIST_TYPES: BlacklistTypeChoice[] = [
  { value: 'ip', label: 'Adresse IP' },
  { value: 'username', label: "Nom d'utilisateur" },
];

interface PendingConnection {
  id: number;
  label: string;
  username: string | null;
  ip_address: string;
  port: number;
  requested_at: string;
}

interface ConnectedDevice {
  id: number;
  label: string;
  username: string | null;
  ip_address: string;
  port: number;
  connected_at: string;
}

interface ConnectionHistoryEntry {
  id: number;
  label: string;
  username: string | null;
  ip_address: string;
  event: ConnectionEvent;
  at: string;
}

interface BlacklistEntry {
  id: number;
  type: BlacklistType;
  value: string;
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
  readonly blacklistTypes = BLACKLIST_TYPES;
  readonly maxBlacklistValueLen = MAX_BLACKLIST_VALUE_LEN;
  readonly maxBlacklistReasonLen = MAX_BLACKLIST_REASON_LEN;

  ngOnInit(): void {
    this.loadServerAddress();
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
      case 'connected':
        return 'Connecté';
      case 'disconnected':
        return 'Déconnecté';
      case 'approved':
        return 'Approuvé';
      case 'refused':
        return 'Refusé';
      case 'blocked':
        return 'Bloqué';
      default:
        return event;
    }
  }

  blacklistTypeLabel(type: BlacklistType): string {
    return this.blacklistTypes.find((t) => t.value === type)?.label ?? type;
  }

  // ── Shared server address ────────────────────────────────────────────────
  serverAddress = signal('');
  loadingServerAddress = signal(true);

  private async loadServerAddress(): Promise<void> {
    this.loadingServerAddress.set(true);
    try {
      this.serverAddress.set(await invoke<string>('get_server_address'));
    } catch (e) {
      console.error('failed to load server address', e);
    } finally {
      this.loadingServerAddress.set(false);
    }
  }

  async copyServerAddress(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.serverAddress());
      this.setStatus('Adresse copiée.', false);
    } catch (e) {
      console.error('failed to copy server address', e);
    }
  }

  // ── Pending connections ──────────────────────────────────────────────────
  pendingConnections = signal<PendingConnection[]>([]);
  loadingPending = signal(true);
  respondingToId = signal<number | null>(null);

  private async loadPending(): Promise<void> {
    this.loadingPending.set(true);
    try {
      const pending = await invoke<PendingConnection[]>('list_pending_connections');
      this.pendingConnections.set(pending);
    } catch (e) {
      console.error('failed to load pending connections', e);
      this.setStatus("Impossible de charger les demandes de connexion.", true);
    } finally {
      this.loadingPending.set(false);
    }
  }

  async approveConnection(connection: PendingConnection): Promise<void> {
    if (this.respondingToId()) return;
    this.respondingToId.set(connection.id);
    this.setStatus('', false);
    try {
      const device = await invoke<ConnectedDevice>('approve_connection', { id: connection.id });
      this.pendingConnections.update((list) => list.filter((c) => c.id !== connection.id));
      this.connectedDevices.update((list) => [device, ...list]);
      this.setStatus(`« ${connection.label} » approuvé.`, false);
    } catch (e) {
      console.error('approve_connection failed', e);
      const message = typeof e === 'string' ? e : "Échec de l'approbation. Réessayez.";
      this.setStatus(message, true);
    } finally {
      this.respondingToId.set(null);
    }
  }

  async refuseConnection(connection: PendingConnection): Promise<void> {
    if (this.respondingToId()) return;
    this.respondingToId.set(connection.id);
    this.setStatus('', false);
    try {
      await invoke<void>('refuse_connection', { id: connection.id });
      this.pendingConnections.update((list) => list.filter((c) => c.id !== connection.id));
      this.setStatus(`« ${connection.label} » refusé.`, false);
    } catch (e) {
      console.error('refuse_connection failed', e);
      const message = typeof e === 'string' ? e : 'Échec du refus. Réessayez.';
      this.setStatus(message, true);
    } finally {
      this.respondingToId.set(null);
    }
  }

  // ── Connected devices ────────────────────────────────────────────────────
  connectedDevices = signal<ConnectedDevice[]>([]);
  loadingConnected = signal(true);
  disconnectingId = signal<number | null>(null);

  private async loadConnected(): Promise<void> {
    this.loadingConnected.set(true);
    try {
      const devices = await invoke<ConnectedDevice[]>('list_connected_devices');
      this.connectedDevices.set(devices);
    } catch (e) {
      console.error('failed to load connected devices', e);
      this.setStatus('Impossible de charger les appareils connectés.', true);
    } finally {
      this.loadingConnected.set(false);
    }
  }

  async disconnectDevice(device: ConnectedDevice): Promise<void> {
    if (this.disconnectingId()) return;
    this.disconnectingId.set(device.id);
    this.setStatus('', false);
    try {
      await invoke<void>('disconnect_device', { id: device.id });
      this.connectedDevices.update((list) => list.filter((d) => d.id !== device.id));
      this.setStatus(`« ${device.label} » déconnecté.`, false);
    } catch (e) {
      console.error('disconnect_device failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la déconnexion. Réessayez.';
      this.setStatus(message, true);
    } finally {
      this.disconnectingId.set(null);
    }
  }

  /** Blocking is irreversible without a manual removal from the blacklist, so it
   *  goes through the same confirm-then-commit step as a permanent deletion. */
  confirmingBlockId = signal<number | null>(null);
  blockingId = signal<number | null>(null);
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
      const entry = await invoke<BlacklistEntry>('block_device', { id: device.id });
      this.connectedDevices.update((list) => list.filter((d) => d.id !== device.id));
      this.blacklist.update((list) => [entry, ...list]);
      this.confirmingBlockId.set(null);
      this.setStatus(`« ${device.label} » bloqué et déconnecté.`, false);
    } catch (e) {
      console.error('block_device failed', e);
      const message = typeof e === 'string' ? e : 'Échec du blocage. Réessayez.';
      this.blockError.set(message);
    } finally {
      this.blockingId.set(null);
    }
  }

  // ── Connection history ───────────────────────────────────────────────────
  history = signal<ConnectionHistoryEntry[]>([]);
  loadingHistory = signal(true);

  private async loadHistory(): Promise<void> {
    this.loadingHistory.set(true);
    try {
      const history = await invoke<ConnectionHistoryEntry[]>('list_connection_history');
      this.history.set(history);
    } catch (e) {
      console.error('failed to load connection history', e);
    } finally {
      this.loadingHistory.set(false);
    }
  }

  // ── Blacklist (block by IP address or username) ─────────────────────────
  blacklist = signal<BlacklistEntry[]>([]);
  loadingBlacklist = signal(true);
  newBlacklistType = signal<BlacklistType>('ip');
  newBlacklistValue = signal('');
  newBlacklistReason = signal('');
  addingBlacklistEntry = signal(false);
  blacklistFormError = signal('');

  private readonly trimmedNewBlacklistValue = computed(() => this.newBlacklistValue().trim());

  canSubmitBlacklist = computed(() => {
    const value = this.trimmedNewBlacklistValue();
    return (
      value.length > 0 &&
      value.length <= this.maxBlacklistValueLen &&
      !this.addingBlacklistEntry() &&
      !this.blacklist().some(
        (b) => b.type === this.newBlacklistType() && b.value.toLowerCase() === value.toLowerCase(),
      )
    );
  });

  private async loadBlacklist(): Promise<void> {
    this.loadingBlacklist.set(true);
    try {
      const blacklist = await invoke<BlacklistEntry[]>('list_blacklist_entries');
      this.blacklist.set(blacklist);
    } catch (e) {
      console.error('failed to load blacklist', e);
      this.setStatus('Impossible de charger la liste noire.', true);
    } finally {
      this.loadingBlacklist.set(false);
    }
  }

  selectBlacklistType(type: BlacklistType): void {
    this.newBlacklistType.set(type);
    this.blacklistFormError.set('');
  }

  private validateBlacklistForm(): string {
    const value = this.trimmedNewBlacklistValue();
    if (value.length === 0) {
      return this.newBlacklistType() === 'ip'
        ? 'Saisissez une adresse IP.'
        : "Saisissez un nom d'utilisateur.";
    }
    if (value.length > this.maxBlacklistValueLen) {
      return `Cette valeur ne peut pas dépasser ${this.maxBlacklistValueLen} caractères.`;
    }
    if (
      this.blacklist().some(
        (b) => b.type === this.newBlacklistType() && b.value.toLowerCase() === value.toLowerCase(),
      )
    ) {
      return 'Cette entrée est déjà dans la liste noire.';
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
      const entry = await invoke<BlacklistEntry>('add_blacklist_entry', {
        entryType: this.newBlacklistType(),
        value: this.trimmedNewBlacklistValue(),
        reason: this.newBlacklistReason().trim() || null,
      });
      this.blacklist.update((list) => [entry, ...list]);
      this.newBlacklistValue.set('');
      this.newBlacklistReason.set('');
      this.setStatus('Entrée ajoutée à la liste noire.', false);
    } catch (e) {
      console.error('add_blacklist_entry failed', e);
      const message = typeof e === 'string' ? e : "Échec de l'ajout. Réessayez.";
      this.blacklistFormError.set(message);
    } finally {
      this.addingBlacklistEntry.set(false);
    }
  }

  confirmingRemoveBlacklistId = signal<number | null>(null);
  removingBlacklistId = signal<number | null>(null);
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
      await invoke<void>('remove_blacklist_entry', { id: entry.id });
      this.blacklist.update((list) => list.filter((b) => b.id !== entry.id));
      this.confirmingRemoveBlacklistId.set(null);
      this.setStatus('Entrée retirée de la liste noire.', false);
    } catch (e) {
      console.error('remove_blacklist_entry failed', e);
      const message = typeof e === 'string' ? e : 'Échec de la suppression. Réessayez.';
      this.removeBlacklistError.set(message);
    } finally {
      this.removingBlacklistId.set(null);
    }
  }
}
