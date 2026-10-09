import { OrderLine } from '../order/order.model';
import { isLineDiscounted, isLineIncreased } from '../order/order.utils';
import { formatIsoDate, isWithinPeriod, PeriodBounds } from './report-period';

export const REPORT_ALL_COUNTERS = 'all';

export const UNKNOWN_COUNTER_LABEL = 'Non renseigné';

export interface CategoryLine {
  label: string;
  unitPrice: number;
  originalUnitPrice: number;
  qty: number;
  total: number;
  discounted: boolean;
  increased: boolean;
}

export interface CategoryGroup {
  category: string;
  lines: CategoryLine[];
  total: number;
}

export interface CounterSection {
  username: string;
  groups: CategoryGroup[];
  total: number;
  clients: number;
}

export interface CounterBreakdown {
  username: string;
  total: number;
  clients: number;
}

export interface RevenueTrend {
  previousRevenue: number;
  changePercent: number | null;
}

export interface AdjustmentsSummary {
  discountCount: number;
  increaseCount: number;
  netImpact: number;
}

export function counterKey(order: OrderLine): string {
  return order.counter_username || UNKNOWN_COUNTER_LABEL;
}

export function paidOrdersOf(orders: OrderLine[]): OrderLine[] {
  return orders.filter((o) => o.status === 'PAYE');
}

export function counterNames(paidOrders: OrderLine[]): string[] {
  const set = new Set(paidOrders.map((o) => counterKey(o)));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Paid orders whose payment date falls inside `bounds`, optionally restricted to one counter. */
export function paidOrdersInPeriod(
  paidOrders: OrderLine[],
  bounds: PeriodBounds,
  counter: string = REPORT_ALL_COUNTERS,
): OrderLine[] {
  return paidOrders.filter((o) => {
    if (!o.paid_at || !isWithinPeriod(o.paid_at, bounds)) return false;
    if (counter !== REPORT_ALL_COUNTERS && counterKey(o) !== counter) return false;
    return true;
  });
}

/** All orders of the period (paid ones by payment date, others by creation date), optionally for one counter. */
export function allOrdersInPeriod(
  orders: OrderLine[],
  bounds: PeriodBounds,
  counter: string = REPORT_ALL_COUNTERS,
): OrderLine[] {
  return orders.filter((o) => {
    const reference = o.status === 'PAYE' ? o.paid_at : o.created_at;
    if (!reference || !isWithinPeriod(reference, bounds)) return false;
    if (counter !== REPORT_ALL_COUNTERS && counterKey(o) !== counter) return false;
    return true;
  });
}

export function revenueOf(orders: OrderLine[]): number {
  return orders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0);
}

export function revenueForPeriod(
  paidOrders: OrderLine[],
  bounds: PeriodBounds,
  counter: string = REPORT_ALL_COUNTERS,
): number {
  return revenueOf(paidOrdersInPeriod(paidOrders, bounds, counter));
}

export function clientsCountOf(orders: OrderLine[]): number {
  return new Set(orders.map((o) => o.group_id)).size;
}

export function averageBasketOf(orders: OrderLine[]): number {
  const clients = clientsCountOf(orders);
  return clients === 0 ? 0 : revenueOf(orders) / clients;
}

export function itemsCountOf(orders: OrderLine[]): number {
  return orders.reduce((sum, o) => sum + o.quantity, 0);
}

export function groupsCountByStatus(orders: OrderLine[], status: OrderLine['status']): number {
  return new Set(orders.filter((o) => o.status === status).map((o) => o.group_id)).size;
}

export function computeRevenueTrend(currentRevenue: number, previousRevenue: number): RevenueTrend {
  if (previousRevenue === 0) {
    return { previousRevenue, changePercent: currentRevenue > 0 ? 100 : null };
  }
  return {
    previousRevenue,
    changePercent: Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100),
  };
}

/** Span of days actually covered by `orders` (by payment date); `fallback` when there are none. */
export function ordersDateBounds(orders: OrderLine[], fallback: PeriodBounds): PeriodBounds {
  const days = orders.map((o) => formatIsoDate(new Date(o.paid_at as string))).sort();
  if (days.length === 0) return fallback;
  return { start: days[0], end: days[days.length - 1] };
}

export function timeRangeOf(orders: OrderLine[]): string {
  if (orders.length === 0) return '';
  const timestamps = orders.map((o) => new Date(o.paid_at as string).getTime()).sort((a, b) => a - b);
  const format = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${format(timestamps[0])} – ${format(timestamps[timestamps.length - 1])}`;
}

export function adjustmentsSummaryOf(orders: OrderLine[]): AdjustmentsSummary {
  let discountCount = 0;
  let increaseCount = 0;
  let netImpact = 0;
  for (const order of orders) {
    if (isLineDiscounted(order)) discountCount += 1;
    if (isLineIncreased(order)) increaseCount += 1;
    if (order.original_unit_price > 0) {
      netImpact += (order.unit_price - order.original_unit_price) * order.quantity;
    }
  }
  return { discountCount, increaseCount, netImpact };
}

export function byCounterOf(orders: OrderLine[]): CounterBreakdown[] {
  const map = new Map<string, { total: number; groupIds: Set<number> }>();
  for (const order of orders) {
    const key = counterKey(order);
    if (!map.has(key)) map.set(key, { total: 0, groupIds: new Set() });
    const entry = map.get(key)!;
    entry.total += order.quantity * order.unit_price;
    entry.groupIds.add(order.group_id);
  }
  return Array.from(map.entries())
    .map(([username, v]) => ({ username, total: v.total, clients: v.groupIds.size }))
    .sort((a, b) => b.total - a.total);
}

export function buildCategoryGroups(orders: OrderLine[]): CategoryGroup[] {
  const map = new Map<string, Map<string, CategoryLine>>();
  for (const order of orders) {
    const parts = order.service_type.split(' — ');
    const category = parts.length > 1 ? parts[0] : 'Autre';
    const label = parts.length > 1 ? parts[1] : order.service_type;
    if (!map.has(category)) map.set(category, new Map());
    const cat = map.get(category)!;
    if (!cat.has(label)) {
      cat.set(label, {
        label,
        unitPrice: order.unit_price,
        originalUnitPrice: order.original_unit_price,
        qty: 0,
        total: 0,
        discounted: false,
        increased: false,
      });
    }
    const entry = cat.get(label)!;
    entry.qty += order.quantity;
    entry.total += order.quantity * order.unit_price;
    entry.discounted = entry.discounted || isLineDiscounted(order);
    entry.increased = entry.increased || isLineIncreased(order);
  }
  return Array.from(map.entries())
    .map(([category, lines]) => {
      const sortedLines = Array.from(lines.values()).sort((a, b) => b.total - a.total);
      return { category, lines: sortedLines, total: sortedLines.reduce((sum, l) => sum + l.total, 0) };
    })
    .sort((a, b) => b.total - a.total);
}

export function topServicesOf(groups: CategoryGroup[], limit = 5): CategoryLine[] {
  return groups
    .map(
      (g): CategoryLine => ({
        label: g.category,
        unitPrice: 0,
        originalUnitPrice: 0,
        qty: g.lines.reduce((sum, l) => sum + l.qty, 0),
        total: g.total,
        discounted: g.lines.some((l) => l.discounted),
        increased: g.lines.some((l) => l.increased),
      }),
    )
    .slice(0, limit);
}

export function lineShare(total: number, revenue: number): number {
  return revenue === 0 ? 0 : Math.round((total / revenue) * 100);
}

export function sectionsByCounterOf(orders: OrderLine[]): CounterSection[] {
  const byUser = new Map<string, OrderLine[]>();
  for (const order of orders) {
    const key = counterKey(order);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key)!.push(order);
  }
  return Array.from(byUser.entries())
    .map(([username, userOrders]) => ({
      username,
      groups: buildCategoryGroups(userOrders),
      total: userOrders.reduce((sum, o) => sum + o.quantity * o.unit_price, 0),
      clients: new Set(userOrders.map((o) => o.group_id)).size,
    }))
    .sort((a, b) => b.total - a.total);
}
