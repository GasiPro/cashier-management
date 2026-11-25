import { invoke } from '@tauri-apps/api/core';
import { localeTime } from '../../core/display/datetime-settings';
import { save } from '@tauri-apps/plugin-dialog';
import * as XLSX from 'xlsx';
import { OrderLine } from '../order/order.model';
import { DEFAULT_CURRENCY } from '../pricing/currency.store';
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
import { translate } from '../../core/i18n/translate';
export interface ReportExportInput {
  title: string;
  dateLabel: string;
  counterLabel?: string;
  currency?: string;
  orders: OrderLine[];
  trend: RevenueTrend;
  comparisonLabel: string;
  pendingCount?: number;
  rejectedCount?: number;
  timeRange?: string;
  defaultFileName: string;
}
export type ReportExportResult = 'saved' | 'cancelled' | 'dialog_failed' | 'save_failed';
export async function exportReportXlsx(input: ReportExportInput): Promise<ReportExportResult> {
  const { orders } = input;
  const currency = (input.currency || DEFAULT_CURRENCY).replace(/[^A-Za-z]/g, '');
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
    pushRow([translate('Comptoir : {counterLabel}', { counterLabel: input.counterLabel })]);
  }
  pushRow([]);
  const revenueRow = pushRow([translate('Chiffre d\'affaires'), revenue]);
  currencyCells.push({ r: revenueRow, c: 1 });
  const trend = input.trend;
  const comparisonLabel = input.comparisonLabel;
  const previousRevenueRow = pushRow([translate('Chiffre d\'affaires ({toLowerCase})', { toLowerCase: comparisonLabel.toLowerCase() }), trend.previousRevenue]);
  currencyCells.push({ r: previousRevenueRow, c: 1 });
  if (trend.changePercent !== null) {
    pushRow([translate('Évolution vs {toLowerCase}', { toLowerCase: comparisonLabel.toLowerCase() }), `${trend.changePercent >= 0 ? '+' : ''}${trend.changePercent}%`]);
  }
  pushRow([translate('Transactions'), clientsCountOf(orders)]);
  const avgBasketRow = pushRow([translate('Panier moyen'), averageBasketOf(orders)]);
  currencyCells.push({ r: avgBasketRow, c: 1 });
  pushRow([translate('Articles vendus'), itemsCountOf(orders)]);
  if (input.pendingCount !== undefined) {
    pushRow([translate('Commandes en attente'), input.pendingCount]);
  }
  if (input.rejectedCount !== undefined) {
    pushRow([translate('Commandes refusées'), input.rejectedCount]);
  }
  if (input.timeRange) {
    pushRow([translate('Plage horaire'), input.timeRange]);
  }
  const counters = byCounterOf(orders);
  if (counters.length > 1) {
    pushRow([]);
    pushRow([translate('Comptoir'), translate('Transactions'), translate('Total ({currency})', { currency: currency })]);
    for (const counter of counters) {
      const r = pushRow([counter.username, counter.clients, counter.total]);
      currencyCells.push({ r, c: 2 });
    }
  }
  const adjustments = adjustmentsSummaryOf(orders);
  if (adjustments.discountCount > 0 || adjustments.increaseCount > 0) {
    pushRow([]);
    pushRow([translate('Remises appliquées'), adjustments.discountCount]);
    pushRow([translate('Majorations appliquées'), adjustments.increaseCount]);
    const netImpactRow = pushRow([translate('Impact net des ajustements ({currency})', { currency: currency }), adjustments.netImpact]);
    currencyCells.push({ r: netImpactRow, c: 1 });
  }
  pushRow([]);
  const headerRow = pushRow([
    translate('Catégorie'),
    translate('Service'),
    translate('N° Commande'),
    translate('Comptoir'),
    translate('Prix unitaire ({currency})', { currency: currency }),
    translate('Prix appliqué ({currency})', { currency: currency }),
    translate('Quantité'),
    translate('Heure commande'),
    translate('Heure paiement'),
    translate('Total ({currency})', { currency: currency }),
  ]);
  const formatReportTime = (iso: string): string => localeTime(iso);
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
    const subtotalRow = pushRow(['', '', '', '', '', '', '', '', translate('Total {username}', { username: section.username }), section.total]);
    currencyCells.push({ r: subtotalRow, c: 9 });
    pushRow([]);
  }
  const totalRow = pushRow(['', '', '', '', '', '', '', '', translate('Total général'), revenue]);
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
  const currencyFormat = `#,##0" ${currency}"`;
  for (const { r, c } of currencyCells) {
    const cellRef = XLSX.utils.encode_cell({ r, c });
    const cell = worksheet[cellRef];
    if (cell) cell.z = currencyFormat;
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, translate('Rapport'));
  let destinationPath: string | null;
  try {
    destinationPath = await save({
      defaultPath: input.defaultFileName,
      filters: [{ name: translate('Classeur Excel'), extensions: ['xlsx'] }],
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
