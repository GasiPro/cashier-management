import { Component, EventEmitter, Output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderGroup } from '../../../../data/order/order.model';
import {
  formatGroupId,
  formatPaidLabel,
  getGroupItemsSummary,
  groupHasDiscount,
  groupHasIncrease,
} from '../../../../data/order/order.utils';

@Component({
  selector: 'app-paid-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './paid-table.html',
  host: { class: 'block' },
})
export class PaidTable {
  /** Most recent paid groups to display in the table. */
  groups = input.required<OrderGroup[]>();
  /** Total number of paid groups (shown next to the section title). */
  totalCount = input.required<number>();

  @Output() opened = new EventEmitter<OrderGroup>();

  readonly formatGroupId = formatGroupId;
  readonly formatPaidLabel = formatPaidLabel;
  readonly getGroupItemsSummary = getGroupItemsSummary;
  readonly groupHasDiscount = groupHasDiscount;
  readonly groupHasIncrease = groupHasIncrease;
}
