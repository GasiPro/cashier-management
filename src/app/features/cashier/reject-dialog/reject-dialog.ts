import { Component, EventEmitter, Input, Output, input } from '@angular/core';
import { OrderGroup } from '../../../../data/order/order.model';
import { formatGroupId } from '../../../../data/order/order.utils';

@Component({
  selector: 'app-reject-dialog',
  standalone: true,
  templateUrl: './reject-dialog.html',
})
export class RejectDialog {
  @Input({ required: true }) group!: OrderGroup;
  reason = input<string>('');

  @Output() reasonChange = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<void>();

  readonly formatGroupId = formatGroupId;
}
