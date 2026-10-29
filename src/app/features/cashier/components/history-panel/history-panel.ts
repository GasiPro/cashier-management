import { Component, EventEmitter, Output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderGroup } from '../../../../data/order/order.model';
import {
  formatGroupId,
  formatPaidTime,
  getGroupItemsSummary,
  getGroupObservations,
  groupHasDiscount,
  groupHasIncrease,
} from '../../../../data/order/order.utils';
import { HistoriqueDayGroup } from '../../cashier.store';
@Component({
  selector: 'app-history-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './history-panel.html',
})
export class HistoryPanel {
  groups = input.required<OrderGroup[]>();
  usernames = input.required<string[]>();
  selectedUser = input.required<string>();
  allCounters = input.required<string>();
  totalAmount = input.required<number>();
  groupsByDay = input.required<HistoriqueDayGroup[]>();
  hasPaidGroups = input.required<boolean>();
  @Output() closed = new EventEmitter<void>();
  @Output() userFilterChange = new EventEmitter<string>();
  @Output() groupOpened = new EventEmitter<OrderGroup>();
  readonly formatGroupId = formatGroupId;
  readonly formatPaidTime = formatPaidTime;
  readonly getGroupItemsSummary = getGroupItemsSummary;
  readonly getGroupObservations = getGroupObservations;
  readonly groupHasDiscount = groupHasDiscount;
  readonly groupHasIncrease = groupHasIncrease;
  historiqueItemCount(group: OrderGroup): number {
    return group.lines.reduce((sum, l) => sum + l.quantity, 0);
  }
}
