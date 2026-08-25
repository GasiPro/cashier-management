import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
export type SidebarRole = 'cashier' | 'counter';
export type ToolSlot = 'A' | 'B';
const HOME_ROUTE_BY_ROLE: Record<SidebarRole, string> = {
  cashier: '/caisse',
  counter: '/comptoir',
};
const SETTINGS_ROUTE = '/reglages';
const SLOT_POSITION_CLASS: Record<ToolSlot, string> = {
  A: 'fixed bottom-4 left-20',
  B: 'fixed bottom-4 left-96',
};
@Component({
  selector: 'app-left-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './left-sidebar.html',
})
export class LeftSidebar {
  @Input({ required: true }) role: SidebarRole = 'cashier';
  @Output() calculatriceClick = new EventEmitter<void>();
  @Output() memoClick = new EventEmitter<void>();
  private currentUrl = signal(this.router.url);
  calculatriceSlot = signal<ToolSlot | null>(null);
  display = signal('0');
  memoSlot = signal<ToolSlot | null>(null);
  memoText = signal('');
  private storedValue: number | null = null;
  private pendingOperator: string | null = null;
  private waitingForOperand = false;
  constructor(private router: Router) {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
  }
  isHomeActive(): boolean {
    return this.currentUrl().startsWith(HOME_ROUTE_BY_ROLE[this.role]);
  }
  isSettingsActive(): boolean {
    return this.currentUrl().startsWith(SETTINGS_ROUTE);
  }
  iconButtonClass(active: boolean): string {
    return active
      ? 'bg-[#EFF4FA] text-[#1E3A5F]'
      : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600';
  }
  goHome(): void {
    this.router.navigate([HOME_ROUTE_BY_ROLE[this.role]]);
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
    return `${position} z-50 w-72 rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden`;
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
    return `${position} z-50 w-80 h-96 rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden flex flex-col`;
  }
  memoTextChanged(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.memoText.set(target.value);
  }
  private assignSlot(): ToolSlot | null {
    const occupied = new Set<ToolSlot>();
    const calcSlot = this.calculatriceSlot();
    const memoSlot = this.memoSlot();
    if (calcSlot) occupied.add(calcSlot);
    if (memoSlot) occupied.add(memoSlot);
    if (!occupied.has('A')) return 'A';
    if (!occupied.has('B')) return 'B';
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
