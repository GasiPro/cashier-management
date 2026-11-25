import { Pipe, PipeTransform } from '@angular/core';
import { localeDate } from '../../core/display/datetime-settings';
@Pipe({ name: 'clockDate', standalone: true })
export class ClockDatePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return localeDate(date, { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
}
