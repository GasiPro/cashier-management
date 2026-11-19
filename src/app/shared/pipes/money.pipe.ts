import { formatNumber } from '@angular/common';
import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';
import { CurrencyStore } from '../../data/pricing/currency.store';

@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);
  private readonly currency = inject(CurrencyStore);

  transform(value: number | string | null | undefined, code?: string | null): string {
    if (value === null || value === undefined || value === '') return '';
    return `${formatNumber(Number(value), this.locale, '1.0-0')} ${code || this.currency.code()}`;
  }
}
