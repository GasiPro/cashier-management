import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import * as XLSX from 'xlsx';
import { OrderLine } from '../order/order.model';
import {
  adjustmentsSummaryOf,
  averageBasketOf,
  byCounterOf,
  clientsCountOf,
  counterKey,
  itemsCountOf,
  RevenueTrend,
  revenueOf,
  sectionsByCounterOf,
} from './report.calculator';

export interface ReportExportInput {
  title: string;
  dateLabel: string;
  /** Counter the report is restricted to; shown as an extra header row when set. */
  counterLabel?: string;
  /** Paid orders of the period (already filtered by period and counter). */
  orders: OrderLine[];
  trend: RevenueTrend;
  comparisonLabel: string;
  /** Pending / rejected group counts; the rows are only written when provided. */
  pendingCount?: number;
  rejectedCount?: number;
  /** Time range of the day's payments; the row is only written when non-empty. */
  timeRange?: string;
  defaultFileName: string;
}

export type ReportExportResult = 'saved' | 'cancelled' | 'dialog_failed' | 'save_failed';

export async function exportReportXlsx(input: ReportExportInput): Promise<ReportExportResult> {
  const { orders } = input;
  const rows: (string | number)[][] = [];
  const currencyCells: { r: number; c: number }[] = [];
  const usernameHeaderRows: number[] = [];
  const pushRow = (row: (string | number)[]): number => {
    rows.push(row);
    return rows.length - 1;
  };
  const revenue = revenueOf(orders);
  pushRow([input.title]);
  pushRow([input.dateLabel]);
  if (input.counterLabel) {
    pushRow([`Comptoir : ${input.counterLabel}`]);
  }
  pushRow([]);
  const revenueRow = pushRow(["Chiffre d'affaires", revenue]);
  currencyCells.push({ r: revenueRow, c: 1 });
  const trend = input.trend;
  const comparisonLabel = input.comparisonLabel;
  const previousRevenueRow = pushRow([`Chiffre d'affaires (${comparisonLabel.toLowerCase()})`, trend.previousRevenue]);
  currencyCells.push({ r: previousRevenueRow, c: 1 });
  if (trend.changePercent !== null) {
    pushRow([`Évolution vs ${comparisonLabel.toLowerCase()}`, `${trend.changePercent >= 0 ? '+' : ''}${trend.changePercent}%`]);
  }
  pushRow(['Transactions', clientsCountOf(orders)]);
  const avgBasketRow = pushRow(['Panier moyen', averageBasketOf(orders)]);
  currencyCells.push({ r: avgBasketRow, c: 1 });
  pushRow(['Articles vendus', itemsCountOf(orders)]);
  if (input.pendingCount !== undefined) {
    pushRow(['Commandes en attente', input.pendingCount]);
  }
  if (input.rejectedCount !== undefined) {
    pushRow(['Commandes refusées', input.rejectedCount]);
  }
  if (input.timeRange) {
    pushRow(['Plage horaire', input.timeRange]);
  }
  const counters = byCounterOf(orders);
  if (counters.length > 1) {
    pushRow([]);
    pushRow(['Comptoir', 'Transactions', 'Total (Ar)']);
    for (const counter of counters) {
      const r = pushRow([counter.username, counter.clients, counter.total]);
      currencyCells.push({ r, c: 2 });
    }
  }
  const adjustments = adjustmentsSummaryOf(orders);
  if (adjustments.discountCount > 0 || adjustments.increaseCount > 0) {
    pushRow([]);
    pushRow(['Remises appliquées', adjustments.discountCount]);
    pushRow(['Majorations appliquées', adjustments.increaseCount]);
    const netImpactRow = pushRow(["Impact net des ajustements (Ar)", adjustments.netImpact]);
    currencyCells.push({ r: netImpactRow, c: 1 });
  }
  pushRow([]);
  const headerRow = pushRow([
    'Catégorie',
    'Service',
    'N° Commande',
    'Comptoir',
    'Prix unitaire (Ar)',
    'Prix appliqué (Ar)',
    'Quantité',
    'Heure commande',
    'Heure paiement',
    'Total (Ar)',
  ]);
  const formatReportTime = (iso: string): string =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const sections = sectionsByCounterOf(orders);
  for (const section of sections) {
    const usernameRow = pushRow([section.username]);
    usernameHeaderRows.push(usernameRow);
    const sectionOrders = orders
      .filter((o) => counterKey(o) === section.username)
      .sort((a, b) => {
        const [categoryA] = a.service_type.split(' — ');
        const [categoryB] = b.service_type.split(' — ');
        return categoryA === categoryB ? a.time.localeCompare(b.time) : categoryA.localeCompare(categoryB);
      });
    for (const order of sectionOrders) {
      const [category, label] = order.service_type.split(' — ');
      const r = pushRow([
        category,
        label ?? order.service_type,
        order.group_id,
        section.username,
        order.original_unit_price,
        order.unit_price,
        order.quantity,
        order.time,
        order.paid_at ? formatReportTime(order.paid_at) : '',
        order.quantity * order.unit_price,
      ]);
      currencyCells.push({ r, c: 4 }, { r, c: 5 }, { r, c: 9 });
    }
    const subtotalRow = pushRow(['', '', '', '', '', '', '', '', `Total ${section.username}`, section.total]);
    currencyCells.push({ r: subtotalRow, c: 9 });
    pushRow([]);
  }
  const totalRow = pushRow(['', '', '', '', '', '', '', '', 'Total général', revenue]);
  currencyCells.push({ r: totalRow, c: 9 });
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 18 },
    { wch: 24 },
    { wch: 13 },
    { wch: 16 },
    { wch: 17 },
    { wch: 17 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
  ];
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
    ...usernameHeaderRows.map((r) => ({ s: { r, c: 0 }, e: { r, c: 9 } })),
  ];
  worksheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: 9 } }),
  };
  const currencyFormat = '#,##0" Ar"';
  for (const { r, c } of currencyCells) {
    const cellRef = XLSX.utils.encode_cell({ r, c });
    const cell = worksheet[cellRef];
    if (cell) cell.z = currencyFormat;
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rapport');
  let destinationPath: string | null;
  try {
    destinationPath = await save({
      defaultPath: input.defaultFileName,
      filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }],
    });
  } catch (e) {
    console.error('export dialog failed', e);
    return 'dialog_failed';
  }
  if (!destinationPath) return 'cancelled';
  const workbookBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  try {
    await invoke('file', {
      command: {
        method: 'save_binary',
        path: destinationPath,
        data: Array.from(new Uint8Array(workbookBytes)),
      },
    });
    return 'saved';
  } catch (e) {
    console.error('save_binary_file failed', e);
    return 'save_failed';
  }
}
