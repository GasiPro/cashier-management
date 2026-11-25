import { Component, EventEmitter, Input, Output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderGroup } from '../../../../data/order/order.model';
import { formatGroupId } from '../../../../data/order/order.utils';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { PAYMENT_METHOD_LABELS, PaymentMethod } from '../../cashier.store';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
const MOBILE_MONEY_NUMBER = 'xxxxx';
@Component({
  selector: 'app-payment-dialog',
  standalone: true,
  imports: [CommonModule, MoneyPipe, TranslatePipe],
  templateUrl: './payment-dialog.html',
})
export class PaymentDialog {
  @Input({ required: true }) group!: OrderGroup;
  method = input<PaymentMethod>('cash');
  busy = input<boolean>(false);
  @Output() methodChange = new EventEmitter<PaymentMethod>();
  @Output() closed = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<void>();
  readonly formatGroupId = formatGroupId;
  readonly mobileMoneyNumber = MOBILE_MONEY_NUMBER;
  readonly methods: { id: PaymentMethod; label: string }[] = [
    { id: 'cash', label: PAYMENT_METHOD_LABELS.cash },
    { id: 'mobile_money', label: PAYMENT_METHOD_LABELS.mobile_money },
  ];
}
