import { Pipe, PipeTransform } from '@angular/core';
import { formatRelativeDay } from '../utils/date';

@Pipe({ name: 'relativeDay', standalone: true })
export class RelativeDayPipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return iso ? formatRelativeDay(iso) : '';
  }
}
