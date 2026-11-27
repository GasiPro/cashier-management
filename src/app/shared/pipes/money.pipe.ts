import { Pipe, PipeTransform, inject } from '@angular/core';
import { activeLocale } from '../../core/i18n/locale';
import { CurrencyStore } from '../../data/pricing/currency.store';
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly currency = inject(CurrencyStore);
  transform(value: number | string | null | undefined, code?: string | null): string {
    if (value === null || value === undefined || value === '') return '';
    return `${Number(value).toLocaleString(activeLocale(), { maximumFractionDigits: 0 })} ${code || this.currency.code()}`;
  }
}
