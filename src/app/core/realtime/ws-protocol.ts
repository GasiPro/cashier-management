import type { OrderLine } from '../../data/order/order.model';
import type { ServiceItem } from '../../data/pricing/pricing.model';
import type { DateTimeSync } from '../../data/settings/datetime.model';
import type { ConnectedDevice, PendingConnection } from '../../data/device/device.model';
export interface AccountSummary {
  display_name: string;
}
export type OrderChangeKind = 'created' | 'updated' | 'deleted' | 'paid' | 'rejected';
export interface OrderChange {
  kind: OrderChangeKind;
  group_id: number;
  counter_username: string;
  reason?: string | null;
}
export type WsMessage =
  | { type: 'orders'; data: OrderLine[] }
  | { type: 'time'; data: string }
  | { type: 'pricing'; data: ServiceItem[] }
  | { type: 'currency'; data: string }
  | { type: 'datetime'; data: DateTimeSync }
  | { type: 'connection_requests'; data: PendingConnection[] }
  | { type: 'connection_devices'; data: ConnectedDevice[] }
  | { type: 'connection_pending'; data?: unknown }
  | { type: 'connection_approved'; data?: unknown }
  | { type: 'connection_rejected'; data?: unknown }
  | { type: 'connection_blocked'; data?: unknown }
  | { type: 'connection_disconnected'; data?: unknown }
  | { type: 'account_data'; data: AccountSummary }
  | { type: 'account_updated'; data: AccountSummary }
  | { type: 'account_update_error'; data: string }
  | { type: 'error_order'; data: string }
  | { type: 'order_notification'; data: OrderChange }
  | { type: 'notice'; data: string[] }
  | { type: 'error_protocol'; data: string };
export type WsMessageType = WsMessage['type'];
export type WsMessageOf<T extends WsMessageType> = Extract<WsMessage, { type: T }>;
