import { signal } from '@angular/core';
import { FRENCH_PACK } from './fr';
import { DEFAULT_LANGUAGE, LanguagePack, TranslateParams } from './i18n.model';
import { localeSelection } from './locale';
const packs = signal<LanguagePack[]>([FRENCH_PACK]);
export const languagePacks = packs.asReadonly();
export function addLanguagePack(pack: LanguagePack): void {
  if (pack.code === DEFAULT_LANGUAGE) return;
  packs.update((list) => [...list.filter((p) => p.code !== pack.code), pack]);
}
export function removeLanguagePack(code: string): void {
  if (code === DEFAULT_LANGUAGE) return;
  packs.update((list) => list.filter((p) => p.code !== code));
}
export function activePack(): LanguagePack {
  const code = localeSelection().language;
  return packs().find((p) => p.code === code) ?? FRENCH_PACK;
}
export function translate(key: string, params?: TranslateParams): string {
  const text = activePack().messages[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
