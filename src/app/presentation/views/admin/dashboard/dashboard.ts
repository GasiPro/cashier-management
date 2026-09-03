import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface SalesComparisonPoint {
  label: string;
  today: number;
  yesterday: number;
  todayPct: number;
  yesterdayPct: number;
}

interface PerformanceSlice {
  label: string;
  value: number;
  color: string;
  dashArray: string;
  dashOffset: string;
}

interface RecentOrder {
  groupId: string;
  summary: string;
  counterUsername: string;
  totalAmount: number;
  paidLabel: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
})
export class Dashboard implements OnInit, OnDestroy {
  displayLabel = 'Tableau de bord';

  currentTime = signal<string>(this.formatTime(new Date()));
  private clockInterval?: ReturnType<typeof setInterval>;

  wsConnected = signal<boolean>(true);
  notifications = signal<unknown[]>([]);

  totalSalesYear = signal<number>(0);
  totalSalesToday = signal<number>(0);
  totalTransactionsToday = signal<number>(0);

  salesComparison = signal<SalesComparisonPoint[]>([]);
  performanceSlices = signal<PerformanceSlice[]>([]);
  performanceScore = signal<number>(0);

  recentOrders = signal<RecentOrder[]>([]);

  ngOnInit(): void {
    this.clockInterval = setInterval(() => {
      this.currentTime.set(this.formatTime(new Date()));
    }, 1000);

    this.loadDashboardData();
  }

  ngOnDestroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
  }

  private loadDashboardData(): void {
    // TODO: replace with real data from the backend/service layer.
    this.totalSalesYear.set(48250000);
    this.totalSalesToday.set(1320000);
    this.totalTransactionsToday.set(87);

    const today = 1320000;
    const yesterday = 980000;
    const max = Math.max(today, yesterday);

    this.salesComparison.set([
      {
        label: 'Ventes',
        today,
        yesterday,
        todayPct: (today / max) * 100,
        yesterdayPct: (yesterday / max) * 100,
      },
    ]);

    const slices: Omit<PerformanceSlice, 'dashArray' | 'dashOffset'>[] = [
      { label: 'Objectif atteint', value: 68, color: '#1E3A5F' },
      { label: 'Restant', value: 32, color: '#E5E7EB' },
    ];

    this.performanceScore.set(slices[0].value);
    this.performanceSlices.set(this.buildDonutSlices(slices));

    this.recentOrders.set([
      {
        groupId: '#0231',
        summary: '2x Burger, 1x Frites, 1x Soda',
        counterUsername: 'Comptoir 1',
        totalAmount: 42000,
        paidLabel: '12:04',
      },
      {
        groupId: '#0230',
        summary: '1x Pizza Margherita, 1x Jus',
        counterUsername: 'Comptoir 2',
        totalAmount: 35000,
        paidLabel: '11:52',
      },
      {
        groupId: '#0229',
        summary: '3x Sandwich, 2x Eau',
        counterUsername: 'Comptoir 1',
        totalAmount: 28000,
        paidLabel: '11:40',
      },
    ]);
  }

  /** Builds cumulative stroke-dasharray/offset values for a ring donut chart from percentage slices. */
  private buildDonutSlices(
    slices: Omit<PerformanceSlice, 'dashArray' | 'dashOffset'>[]
  ): PerformanceSlice[] {
    const circumference = 2 * Math.PI * 15.9155; // matches the r=15.9155 circle in the template
    let cumulativePct = 0;

    return slices.map((slice) => {
      const sliceLength = (slice.value / 100) * circumference;
      const dashArray = `${sliceLength} ${circumference - sliceLength}`;
      const dashOffset = `${-(cumulativePct / 100) * circumference}`;
      cumulativePct += slice.value;

      return { ...slice, dashArray, dashOffset };
    });
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}
