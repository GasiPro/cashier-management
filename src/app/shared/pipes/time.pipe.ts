import { Pipe, PipeTransform } from '@angular/core';
import { localeTime } from '../../core/display/datetime-settings';
@Pipe({ name: 'time', standalone: true })
export class TimePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return localeTime(date);
  }
}
