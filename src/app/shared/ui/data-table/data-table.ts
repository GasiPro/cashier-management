import { Component, input } from '@angular/core';
export interface DataTableColumn {
  label: string;
  align?: 'left' | 'right';
  hideOnMobile?: boolean;
  nowrap?: boolean;
  widthClass?: string;
}
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
    return `${align} px-3 sm:px-4 py-3.5 text-xs text-gray-400 font-medium uppercase tracking-wider${width}${hidden}${nowrap}`;
  }
}
