import { Component, EventEmitter, Input, Output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderGroup } from '../../../../data/order/order.model';
import {
  formatCreatedLabel,
  formatGroupId,
  formatPaidLabel,
  getGroupObservations,
  groupHasDiscount,
  groupHasIncrease,
  isLineDiscounted,
  isLineIncreased,
} from '../../../../data/order/order.utils';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
@Component({
  selector: 'app-order-detail-modal',
  standalone: true,
  imports: [CommonModule, MoneyPipe],
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
  readonly getGroupObservations = getGroupObservations;
  isGroupPending(g: OrderGroup): boolean {
    return !g.paidAt;
  }
  totalQuantity(g: OrderGroup): number {
    return g.lines.reduce((sum, l) => sum + l.quantity, 0);
  }
  priceAdjustmentLabel(g: OrderGroup): string {
    const discount = groupHasDiscount(g);
    const increase = groupHasIncrease(g);
    if (discount && increase) return 'Remise / Majoration';
    if (discount) return 'Remise';
    if (increase) return 'Majoration';
    return 'Aucun';
  }
}
