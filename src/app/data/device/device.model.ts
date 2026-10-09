export const MAX_BLACKLIST_ADDR_LEN = 64;
export const MAX_BLACKLIST_REASON_LEN = 120;
export const MAX_ALLOWED_CONNECTED_DEVICES = 50;

export type BlacklistEntryType = 'ip' | 'username';

export type PeerId = string | number;

export type ConnectionEvent = 'requested' | 'approved' | 'refused' | 'disconnected' | 'blocked';

export interface PendingConnection {
  id: PeerId;
  label: string;
  username?: string | null;
  ip_address: string;
  port: number;
  requested_at: string;
}

export interface ConnectedDevice {
  id: PeerId;
  label: string;
  username?: string | null;
  ip_address: string;
  port: number;
  connected_at: string;
}

export interface ConnectionHistoryEntry {
  id: PeerId;
  label: string;
  username?: string | null;
  ip_address: string;
  event: ConnectionEvent;
  at: string;
}

export interface BlacklistEntry {
  id: PeerId;
  type: 'ip' | 'username';
  value: string;
  reason?: string | null;
  created_at: string;
}

export function deviceDisplayName(item: { username?: string | null; label: string }): string {
  return item.username?.trim() || item.label;
}

export function deviceAddress(item: { ip_address: string; port: number }): string {
  return `${item.ip_address}:${item.port}`;
}

export function connectionEventLabel(event: ConnectionEvent): string {
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
