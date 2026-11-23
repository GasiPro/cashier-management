import { Component, EventEmitter, Output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderGroup } from '../../../../data/order/order.model';
import {
  formatCreatedLabel,
  formatGroupId,
  getGroupItemsSummary,
  getGroupObservations,
  groupHasDiscount,
  groupHasIncrease,
} from '../../../../data/order/order.utils';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
@Component({
  selector: 'app-pending-list',
  standalone: true,
  imports: [CommonModule, MoneyPipe],
  templateUrl: './pending-list.html',
  host: { class: 'block' },
})
export class PendingList {
  groups = input.required<OrderGroup[]>();
  totalCount = input.required<number>();
  totalAmount = input.required<number>();
  search = input<string>('');
  counters = input<string[]>([]);
  selectedCounter = input<string>('');
  allCounters = input<string>('');
  @Output() opened = new EventEmitter<OrderGroup>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() counterChange = new EventEmitter<string>();
  readonly formatGroupId = formatGroupId;
  readonly formatCreatedLabel = formatCreatedLabel;
  readonly getGroupItemsSummary = getGroupItemsSummary;
  readonly getGroupObservations = getGroupObservations;
  readonly groupHasDiscount = groupHasDiscount;
  readonly groupHasIncrease = groupHasIncrease;
}
