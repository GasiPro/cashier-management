import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
@Component({
  selector: 'app-day-summary',
  standalone: true,
  imports: [CommonModule, MoneyPipe, TranslatePipe],
  templateUrl: './day-summary.html',
  host: { class: 'hidden sm:flex items-center gap-4 text-sm' },
})
export class DaySummary {
  revenue = input.required<number>();
  transactions = input.required<number>();
}
