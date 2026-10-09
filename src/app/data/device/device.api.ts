import { invoke } from '@tauri-apps/api/core';
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

/** Disconnects the device and adds its IP address to the blacklist in one step. */
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
