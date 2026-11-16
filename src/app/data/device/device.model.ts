import { UserType } from '../account/account.model';
export const MAX_BLACKLIST_ADDR_LEN = 64;
export const MAX_BLACKLIST_REASON_LEN = 120;
export const MAX_ALLOWED_CONNECTED_DEVICES = 50;
export type BlacklistEntryType = 'ip' | 'username';
export type PeerId = string | number;
export type ConnectionEvent = 'requested' | 'approved' | 'refused' | 'disconnected' | 'blocked';
/** A computer (hardware fingerprint) used with an account, whatever its state. */
export interface Device {
  username?: string | null;
  user_type: UserType;
  machine: string;
  device_id: string;
  account_id: string;
}
export interface PendingConnection extends Device {
  id: PeerId;
  label: string;
  ip_address: string;
  port: number;
  requested_at: string;
}
export interface ConnectedDevice {
  id: PeerId;
  label: string;
  username?: string | null;
  device_id: string;
  ip_address: string;
  port: number;
  connected_at: string;
}
export interface ConnectionHistoryEntry extends Device {
  id: PeerId;
  username: string;
  event: ConnectionEvent;
  connected_at?: string | null;
  disconnected_at?: string | null;
  online: boolean;
  auto_disconnected: boolean;
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
