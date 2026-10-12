import { formatNumber } from '@angular/common';
import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';

/** Same output as `{{ value | number:'1.0-0' }} Ar`. */
@Pipe({ name: 'currencyAr', standalone: true })
export class CurrencyArPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    return `${formatNumber(Number(value), this.locale, '1.0-0')} Ar`;
  }
}
