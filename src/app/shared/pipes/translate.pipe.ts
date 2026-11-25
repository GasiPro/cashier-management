import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslateParams } from '../../core/i18n/i18n.model';
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(key: string, params?: TranslateParams): string {
    return this.i18n.t(key, params);
  }
}
