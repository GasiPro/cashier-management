import { Injectable, computed } from '@angular/core';
import { DEFAULT_LANGUAGE, LanguagePack, TranslateParams } from './i18n.model';
import { activeLocale, localeSelection, setLocaleSelection } from './locale';
import { addLanguagePack, languagePacks, removeLanguagePack, translate } from './translate';
@Injectable({ providedIn: 'root' })
export class I18n {
  readonly languages = languagePacks;
  readonly language = computed(() => localeSelection().language);
  readonly locale = computed(() => activeLocale());
  init(): void {
    setLocaleSelection(localeSelection());
  }
  t(key: string, params?: TranslateParams): string {
    return translate(key, params);
  }
  use(code: string, region: string = localeSelection().region): boolean {
    if (!languagePacks().some((p) => p.code === code)) return false;
    setLocaleSelection({ language: code, region });
    return true;
  }
  install(pack: LanguagePack): void {
    addLanguagePack(pack);
  }
  uninstall(code: string): void {
    removeLanguagePack(code);
    if (this.language() === code) this.use(DEFAULT_LANGUAGE);
  }
}
