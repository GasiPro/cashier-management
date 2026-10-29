import { formatRelativeDay } from '../../shared/utils/date';
import type { OrderGroup, OrderLine } from './order.model';
export function buildGroups(orders: OrderLine[]): OrderGroup[] {
  const map = new Map<number, OrderLine[]>();
  for (const o of orders) {
    if (!map.has(o.group_id)) map.set(o.group_id, []);
    map.get(o.group_id)!.push(o);
  }
  const groups: OrderGroup[] = [];
  for (const [groupId, lines] of map.entries()) {
    groups.push({
      groupId,
      lines,
      status: lines[0].status,
      totalAmount: lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
      time: lines[0].time,
      createdAt: lines[0].created_at,
      paidAt: lines[0].paid_at,
      counterUsername: lines[0].counter_username,
      observation: lines[0].observation,
      raison: lines[0].raison,
    });
  }
  return groups.sort((a, b) => b.groupId - a.groupId);
}
export function getGroupItemsSummary(group: OrderGroup): string {
  const categoryOrder: string[] = [];
  const byCategory = new Map<string, string[]>();
  for (const l of group.lines) {
    const parts = l.service_type.split(' — ');
    const category = parts.length > 1 ? parts[0] : 'Autre';
    const label = parts.length > 1 ? parts[1] : l.service_type;
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
      categoryOrder.push(category);
    }
    byCategory.get(category)!.push(`${label} x${l.quantity}`);
  }
  return categoryOrder
    .map((category) => `${category}: ${byCategory.get(category)!.join(', ')}`)
    .join(' • ');
}
export function getGroupObservations(group: OrderGroup): string[] {
  const notes: string[] = [];
  for (const l of group.lines) {
    const text = l.observation?.trim();
    if (!text) continue;
    const parts = l.service_type.split(' — ');
    const label = parts.length > 1 ? parts[1] : l.service_type;
    notes.push(`${label} : ${text}`);
  }
  return notes;
}
export function formatGroupId(groupId: number): string {
  return '#' + String(groupId).padStart(4, '0');
}
export function isLineDiscounted(order: OrderLine): boolean {
  return order.original_unit_price > 0 && order.unit_price < order.original_unit_price;
}
export function isLineIncreased(order: OrderLine): boolean {
  return order.original_unit_price > 0 && order.unit_price > order.original_unit_price;
}
export function groupHasDiscount(group: OrderGroup): boolean {
  return group.lines.some((l) => isLineDiscounted(l));
}
export function groupHasIncrease(group: OrderGroup): boolean {
  return group.lines.some((l) => isLineIncreased(l));
}
export function formatPaidLabel(group: OrderGroup): string {
  if (!group.paidAt) return '';
  const date = new Date(group.paidAt);
  const dayLabel = formatRelativeDay(group.paidAt);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `Encaissé ${dayLabel} à ${time}`;
}
export function formatPaidTime(group: OrderGroup): string {
  if (!group.paidAt) return '';
  return new Date(group.paidAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
export function formatCreatedLabel(group: OrderGroup): string {
  const dayLabel = formatRelativeDay(group.createdAt);
  return `${dayLabel} à ${group.time}`;
}
