import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DenominationStore } from '../../../../data/pricing/denomination.store';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';

export interface BilletageResult {
  theoretical: number;
  physical: number;
  gap: number;
  reason: string | null;
}

interface BilletageLine {
  value: number;
  count: number;
}

const MAX_COUNT = 1_000_000;

@Component({
  selector: 'app-billetage',
  standalone: true,
  imports: [CommonModule, MoneyPipe],
  templateUrl: './billetage.html',
  host: { class: 'flex flex-col flex-1 min-h-0' },
})
export class Billetage {
  /** Caisse théorique (CT) : ventes du jour calculées par l'application. */
  theoretical = input.required<number>();
  validated = output<BilletageResult>();

  private readonly denominations = inject(DenominationStore);

  lines = signal<BilletageLine[]>([]);
  reason = signal('');
  confirming = signal(false);
  done = signal(false);
  /** CT figée au moment de la validation, pour que l'écart affiché ne change plus. */
  private frozen = signal<number | null>(null);

  readonly available = computed(() => [...this.denominations.values()].sort((a, b) => b - a));
  readonly sortedLines = computed(() => [...this.lines()].sort((a, b) => b.value - a.value));
  readonly reference = computed(() => this.frozen() ?? this.theoretical());
  /** Caisse physique (CP) : total compté par le caissier. */
  readonly physical = computed(() => this.lines().reduce((sum, l) => sum + l.value * l.count, 0));
  /** Écart = CP − CT. */
  readonly gap = computed(() => this.physical() - this.reference());
  readonly canConfirm = computed(() => this.gap() === 0 || this.reason().trim().length > 0);
  readonly gapClass = computed(() => {
    const gap = this.gap();
    if (gap === 0) return 'text-emerald-700';
    return gap > 0 ? 'text-amber-700' : 'text-red-700';
  });
  readonly gapLabel = computed(() => {
    const gap = this.gap();
    if (gap === 0) return 'Caisse juste';
    return gap > 0 ? 'Excédent' : 'Manquant';
  });

  countId(value: number): string {
    return `billetage-count-${value}`;
  }

  isSelected(value: number): boolean {
    return this.lines().some((l) => l.value === value);
  }

  select(value: number): void {
    if (this.done() || this.isSelected(value)) return;
    this.lines.update((list) => [...list, { value, count: 0 }]);
    setTimeout(() => document.getElementById(this.countId(value))?.focus());
  }

  setCount(value: number, event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const count = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 0), MAX_COUNT) : 0;
    this.lines.update((list) => list.map((l) => (l.value === value ? { ...l, count } : l)));
  }

  remove(value: number): void {
    this.lines.update((list) => list.filter((l) => l.value !== value));
  }

  reasonChanged(event: Event): void {
    this.reason.set((event.target as HTMLTextAreaElement).value);
  }

  reset(): void {
    this.lines.set([]);
    this.reason.set('');
    this.confirming.set(false);
    this.done.set(false);
    this.frozen.set(null);
  }

  validate(): void {
    if (this.gap() === 0) {
      this.finish();
    } else {
      this.confirming.set(true);
    }
  }

  confirm(): void {
    if (this.canConfirm()) this.finish();
  }

  private finish(): void {
    const gap = this.gap();
    this.validated.emit({
      theoretical: this.reference(),
      physical: this.physical(),
      gap,
      reason: gap === 0 ? null : this.reason().trim(),
    });
    this.frozen.set(this.reference());
    this.confirming.set(false);
    this.done.set(true);
  }
}
