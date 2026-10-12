import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'time', standalone: true })
export class TimePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}
