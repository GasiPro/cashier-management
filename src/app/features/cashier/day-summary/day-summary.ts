import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-day-summary',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './day-summary.html',
  host: { class: 'hidden sm:flex items-center gap-4 text-sm' },
})
export class DaySummary {
  revenue = input.required<number>();
  transactions = input.required<number>();
}
