import { computed, signal } from '@angular/core';
import { DEFAULT_LOCALE_SETTINGS, LocaleSettings } from '../../data/settings/locale.model';
import { DEFAULT_LOCALE } from './i18n.model';
const selection = signal<LocaleSettings>(DEFAULT_LOCALE_SETTINGS);
function isSupportedLocale(locale: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}
function localeOf(value: LocaleSettings): string {
  const wanted = value.region ? `${value.language}-${value.region}` : value.language;
  return isSupportedLocale(wanted) ? wanted : DEFAULT_LOCALE;
}
const locale = computed(() => localeOf(selection()));
export const localeSelection = selection.asReadonly();
export function activeLocale(): string {
  return locale();
}
export function setLocaleSelection(value: LocaleSettings): void {
  selection.set({ language: value.language, region: value.region });
  document.documentElement.lang = locale();
}
