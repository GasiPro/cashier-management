import { invoke } from '@tauri-apps/api/core';
import { LOCAL_WS_URL } from '../../core/config/app.constants';
import {
  BlacklistEntry,
  BlacklistEntryType,
  ConnectedDevice,
  ConnectionHistoryEntry,
  PeerId,
  PendingConnection,
} from './device.model';
export function getServerAddress(): Promise<string> {
  return invoke<string>('server', { command: { method: 'get_address' } });
}
/** URL of this machine's own WebSocket server, following the port the server actually bound to. */
export async function getLocalWsUrl(): Promise<string> {
  try {
    const port = (await getServerAddress()).split(':').pop() ?? '';
    return /^\d+$/.test(port) ? `ws://127.0.0.1:${port}` : LOCAL_WS_URL;
  } catch {
    return LOCAL_WS_URL;
  }
}
export function listPendingConnections(): Promise<PendingConnection[]> {
  return invoke<PendingConnection[]>('server', {
    command: { method: 'connection_list_pending' },
  });
}
export function approveConnection(id: PeerId): Promise<void> {
  return invoke<void>('server', {
    command: { method: 'connection_approve', id },
  });
}
export function rejectConnection(id: PeerId): Promise<void> {
  return invoke<void>('server', {
    command: { method: 'connection_reject', id },
  });
}
export function listConnectedDevices(): Promise<ConnectedDevice[]> {
  return invoke<ConnectedDevice[]>('server', {
    command: { method: 'connection_list_connected' },
  });
}
export function disconnectDevice(id: PeerId): Promise<void> {
  return invoke<void>('server', {
    command: { method: 'connection_disconnect', id },
  });
}
export function blockDevice(id: PeerId): Promise<BlacklistEntry> {
  return invoke<BlacklistEntry>('server', {
    command: { method: 'connection_block', id },
  });
}
export function listConnectionHistory(): Promise<ConnectionHistoryEntry[]> {
  return invoke<ConnectionHistoryEntry[]>('server', {
    command: { method: 'connection_history' },
  });
}
export function listBlacklist(): Promise<BlacklistEntry[]> {
  return invoke<BlacklistEntry[]>('server', {
    command: { method: 'connection_blacklist_list' },
  });
}
export function addBlacklistEntry(
  entryType: BlacklistEntryType,
  value: string,
  reason: string | null,
): Promise<BlacklistEntry> {
  return invoke<BlacklistEntry>('server', {
    command: {
      method: 'connection_blacklist_add',
      entry_type: entryType,
      value,
      reason,
    },
  });
}
export function removeBlacklistEntry(id: PeerId): Promise<void> {
  return invoke<void>('server', {
    command: { method: 'connection_blacklist_remove', id },
  });
}
export function getMaxDevices(): Promise<number> {
  return invoke<number>('server', { command: { method: 'devices_max_get' } });
}
export function setMaxDevices(value: number): Promise<number> {
  return invoke<number>('server', {
    command: { method: 'devices_max_set', value },
  });
}
export function countConnectedDevices(): Promise<number> {
  return invoke<number>('server', { command: { method: 'devices_count' } });
}
