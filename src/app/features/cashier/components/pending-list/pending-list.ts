import { Component, EventEmitter, Output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderGroup } from '../../../../data/order/order.model';
import {
  formatCreatedLabel,
  formatGroupId,
  getGroupItemsSummary,
  groupHasDiscount,
  groupHasIncrease,
} from '../../../../data/order/order.utils';

@Component({
  selector: 'app-pending-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pending-list.html',
  host: { class: 'block' },
})
export class PendingList {
  groups = input.required<OrderGroup[]>();
  busyGroupId = input<number | null>(null);

  @Output() opened = new EventEmitter<OrderGroup>();
  @Output() rejectRequested = new EventEmitter<OrderGroup>();
  @Output() payRequested = new EventEmitter<number>();

  readonly formatGroupId = formatGroupId;
  readonly formatCreatedLabel = formatCreatedLabel;
  readonly getGroupItemsSummary = getGroupItemsSummary;
  readonly groupHasDiscount = groupHasDiscount;
  readonly groupHasIncrease = groupHasIncrease;
}
