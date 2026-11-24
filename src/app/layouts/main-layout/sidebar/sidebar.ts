import { Component, EventEmitter, Output, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { DenominationStore } from '../../../data/pricing/denomination.store';
import { Billetage, BilletageResult } from './billetage/billetage';
export type ToolSlot = 'A' | 'B' | 'C';
const SETTINGS_ROUTE = '/reglages';
const SLOT_POSITION_CLASS: Record<ToolSlot, string> = {
  A: 'fixed bottom-17 left-20',
  B: 'fixed bottom-17 left-105',
  C: 'fixed bottom-17 left-190',
};
@Component({
  selector: 'app-left-sidebar',
  standalone: true,
  imports: [CommonModule, Billetage],
  templateUrl: './sidebar.html',
})
export class LeftSidebar {
  @Output() calculatriceClick = new EventEmitter<void>();
  @Output() memoClick = new EventEmitter<void>();
  @Output() billetageValidated = new EventEmitter<BilletageResult>();
  /** Caisse théorique du jour : le billetage n'est proposé que lorsqu'elle est fournie (caisse). */
  theoreticalCash = input<number | null>(null);
  private currentUrl = signal('');
  calculatriceSlot = signal<ToolSlot | null>(null);
  display = signal('0');
  memoSlot = signal<ToolSlot | null>(null);
  memoText = signal('');
  billetageSlot = signal<ToolSlot | null>(null);
  private storedValue: number | null = null;
  private pendingOperator: string | null = null;
  private waitingForOperand = false;
  constructor(
    private router: Router,
    private denominations: DenominationStore,
  ) {
    this.currentUrl.set(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
  }
  isSettingsActive(): boolean {
    return this.currentUrl().startsWith(SETTINGS_ROUTE);
  }
  iconButtonClass(active: boolean): string {
    return active
      ? 'bg-[#EFF4FA] text-[#1E3A5F]'
      : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600';
  }
  openCalculatrice(): void {
    if (this.calculatriceSlot() !== null) {
      this.calculatriceSlot.set(null);
    } else {
      this.calculatriceSlot.set(this.assignSlot());
    }
    this.calculatriceClick.emit();
  }
  closeCalculatrice(): void {
    this.calculatriceSlot.set(null);
  }
  calculatricePanelClass(): string {
    const position = SLOT_POSITION_CLASS[this.calculatriceSlot() ?? 'A'];
    return `${position} z-10 w-80 h-96 rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden flex flex-col`;
  }
  openMemo(): void {
    if (this.memoSlot() !== null) {
      this.memoSlot.set(null);
    } else {
      this.memoSlot.set(this.assignSlot());
    }
    this.memoClick.emit();
  }
  closeMemo(): void {
    this.memoSlot.set(null);
  }
  memoPanelClass(): string {
    const position = SLOT_POSITION_CLASS[this.memoSlot() ?? 'A'];
    return `${position} z-10 w-80 h-96 rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden flex flex-col`;
  }
  openBilletage(): void {
    if (this.billetageSlot() !== null) {
      this.billetageSlot.set(null);
    } else {
      this.billetageSlot.set(this.assignSlot());
      void this.denominations.load();
    }
  }
  closeBilletage(): void {
    this.billetageSlot.set(null);
  }
  billetagePanelClass(): string {
    const slot = this.billetageSlot();
    const position = SLOT_POSITION_CLASS[slot ?? 'A'];
    return `${position} z-10 w-80 h-[36rem] max-h-[calc(100vh-8rem)] rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden flex-col ${slot === null ? 'hidden' : 'flex'}`;
  }
  memoTextChanged(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.memoText.set(target.value);
  }
  private assignSlot(): ToolSlot | null {
    const occupied = new Set<ToolSlot>();
    const calcSlot = this.calculatriceSlot();
    const memoSlot = this.memoSlot();
    const billetageSlot = this.billetageSlot();
    if (calcSlot) occupied.add(calcSlot);
    if (memoSlot) occupied.add(memoSlot);
    if (billetageSlot) occupied.add(billetageSlot);
    if (!occupied.has('A')) return 'A';
    if (!occupied.has('B')) return 'B';
    if (!occupied.has('C')) return 'C';
    return null;
  }
  goToSettings(): void {
    this.router.navigate([SETTINGS_ROUTE]);
  }
  digitPressed(digit: string): void {
    if (this.waitingForOperand) {
      this.display.set(digit);
      this.waitingForOperand = false;
      return;
    }
    this.display.update((value) => (value === '0' ? digit : value + digit));
  }
  decimalPressed(): void {
    if (this.waitingForOperand) {
      this.display.set('0,');
      this.waitingForOperand = false;
      return;
    }
    this.display.update((value) => (value.includes(',') ? value : value + ','));
  }
  toggleSignPressed(): void {
    this.display.update((value) => {
      if (value === '0') return value;
      return value.startsWith('-') ? value.slice(1) : '-' + value;
    });
  }
  clearPressed(): void {
    this.display.set('0');
    this.storedValue = null;
    this.pendingOperator = null;
    this.waitingForOperand = false;
  }
  backspacePressed(): void {
    this.display.update((value) => (value.length > 1 ? value.slice(0, -1) : '0'));
  }
  operatorPressed(operator: string): void {
    const inputValue = this.parseDisplay();
    if (this.storedValue === null) {
      this.storedValue = inputValue;
    } else if (this.pendingOperator && !this.waitingForOperand) {
      this.storedValue = this.compute(this.pendingOperator, this.storedValue, inputValue);
      this.display.set(this.formatValue(this.storedValue));
    }
    this.waitingForOperand = true;
    this.pendingOperator = operator;
  }
  equalsPressed(): void {
    const inputValue = this.parseDisplay();
    if (this.pendingOperator === null || this.storedValue === null) {
      return;
    }
    const result = this.compute(this.pendingOperator, this.storedValue, inputValue);
    this.display.set(this.formatValue(result));
    this.storedValue = null;
    this.pendingOperator = null;
    this.waitingForOperand = true;
  }
  private parseDisplay(): number {
    return parseFloat(this.display().replace(',', '.')) || 0;
  }
  private formatValue(value: number): string {
    if (!isFinite(value)) return '0';
    return String(Math.round(value * 1e10) / 1e10).replace('.', ',');
  }
  private compute(operator: string, a: number, b: number): number {
    switch (operator) {
      case '+':
        return a + b;
      case '−':
        return a - b;
      case '×':
        return a * b;
      case '÷':
        return b === 0 ? 0 : a / b;
      default:
        return b;
    }
  }
}
