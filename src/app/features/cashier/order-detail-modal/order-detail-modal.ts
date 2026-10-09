import { Component, EventEmitter, Input, Output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderGroup } from '../../../../data/order/order.model';
import {
  formatCreatedLabel,
  formatGroupId,
  formatPaidLabel,
  groupHasDiscount,
  groupHasIncrease,
  isLineDiscounted,
  isLineIncreased,
} from '../../../../data/order/order.utils';

@Component({
  selector: 'app-order-detail-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './order-detail-modal.html',
})
export class OrderDetailModal {
  @Input({ required: true }) group!: OrderGroup;
  busyGroupId = input<number | null>(null);

  @Output() closed = new EventEmitter<void>();
  @Output() rejectRequested = new EventEmitter<OrderGroup>();
  @Output() payRequested = new EventEmitter<number>();

  readonly formatGroupId = formatGroupId;
  readonly formatCreatedLabel = formatCreatedLabel;
  readonly formatPaidLabel = formatPaidLabel;
  readonly isLineDiscounted = isLineDiscounted;
  readonly isLineIncreased = isLineIncreased;
  readonly groupHasDiscount = groupHasDiscount;
  readonly groupHasIncrease = groupHasIncrease;

  isGroupPending(g: OrderGroup): boolean {
    return !g.paidAt;
  }
}
