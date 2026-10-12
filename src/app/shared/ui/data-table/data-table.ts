import { Component, input } from '@angular/core';

export interface DataTableColumn {
  label: string;
  align?: 'left' | 'right';
  hideOnMobile?: boolean;
  nowrap?: boolean;
  /** Tailwind width class, e.g. 'w-12'. */
  widthClass?: string;
}

/**
 * Scrollable bordered table with the shared header row. Rows are projected:
 * <app-data-table [columns]="cols" [minWidth]="340">
 *   @for (...) { <tr app-data-row>...</tr> }
 * </app-data-table>
 */
@Component({
  selector: 'app-data-table',
  standalone: true,
  templateUrl: './data-table.html',
})
export class DataTable {
  columns = input.required<DataTableColumn[]>();
  minWidth = input<number>(340);

  headerClasses(col: DataTableColumn): string {
    const align = col.align === 'right' ? 'text-right' : 'text-left';
    const width = col.widthClass ? ` ${col.widthClass}` : '';
    const hidden = col.hideOnMobile ? ' hidden sm:table-cell' : '';
    const nowrap = col.nowrap ? ' whitespace-nowrap' : '';
    return `${align} px-3 sm:px-4 py-2.5 text-xs text-gray-400 font-medium uppercase tracking-wide${width}${hidden}${nowrap}`;
  }
}
