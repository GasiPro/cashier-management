import { UserType } from '../account/account.model';
import { translate } from '../../core/i18n/translate';
export const MAX_BLACKLIST_ADDR_LEN = 64;
export const MAX_BLACKLIST_REASON_LEN = 120;
export const MAX_ALLOWED_CONNECTED_DEVICES = 50;
export type BlacklistEntryType = 'ip' | 'account' | 'device';
export type PeerId = string | number;
export type ConnectionEvent = 'requested' | 'approved' | 'refused' | 'disconnected' | 'blocked';
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
  type: BlacklistEntryType;
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
      return translate('Demande reçue');
    case 'approved':
      return translate('Approuvé');
    case 'refused':
      return translate('Refusé');
    case 'disconnected':
      return translate('Déconnecté');
    case 'blocked':
      return translate('Bloqué');
    default:
      return event;
  }
}
