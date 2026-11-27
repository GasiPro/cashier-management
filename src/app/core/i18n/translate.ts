import { signal } from '@angular/core';
import { ENGLISH_PACK } from './en';
import { FRENCH_PACK } from './fr';
import { DEFAULT_LANGUAGE, LanguagePack, SOURCE_LANGUAGE, TranslateParams } from './i18n.model';
import { activeLocale, localeSelection } from './locale';
const packs = signal<LanguagePack[]>([ENGLISH_PACK, FRENCH_PACK]);
export const languagePacks = packs.asReadonly();
function isBuiltIn(code: string): boolean {
  return code === DEFAULT_LANGUAGE || code === SOURCE_LANGUAGE;
}
export function addLanguagePack(pack: LanguagePack): void {
  if (isBuiltIn(pack.code)) return;
  packs.update((list) => [...list.filter((p) => p.code !== pack.code), pack]);
}
export function removeLanguagePack(code: string): void {
  if (isBuiltIn(code)) return;
  packs.update((list) => list.filter((p) => p.code !== code));
}
export function activePack(): LanguagePack {
  const code = localeSelection().language;
  return packs().find((p) => p.code === code) ?? ENGLISH_PACK;
}
interface Pattern {
  key: string;
  names: string[];
  re: RegExp;
}
const patternCache = new WeakMap<LanguagePack, Pattern[]>();
const dynamicCache = new WeakMap<LanguagePack, Map<string, string | null>>();
const MIN_PATTERN_LITERAL_LEN = 8;
const MAX_DYNAMIC_CACHE = 500;
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function isPlural(count: number): boolean {
  try {
    return new Intl.PluralRules(activeLocale()).select(count) !== 'one';
  } catch {
    return count > 1;
  }
}
function pluralSuffix(name: string, value: string | number, params: TranslateParams): string | null {
  if (value !== 's' && value !== '') return null;
  const base = /^(\w+?)\d+$/.exec(name)?.[1];
  const count = base === undefined ? undefined : params[base];
  if (count === undefined || count === '' || !Number.isFinite(Number(count))) return null;
  return isPlural(Number(count)) ? 's' : '';
}
function fill(text: string, params: TranslateParams): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return pluralSuffix(name, value, params) ?? String(value);
  });
}
function patternsOf(pack: LanguagePack): Pattern[] {
  let list = patternCache.get(pack);
  if (!list) {
    list = Object.keys(pack.messages)
      .map((key) => ({ key, parts: key.split(/\{\w+\}/) }))
      .filter(({ parts }) => parts.length > 1 && parts.join('').length >= MIN_PATTERN_LITERAL_LEN)
      .sort((a, b) => b.parts.join('').length - a.parts.join('').length)
      .map(({ key, parts }) => ({
        key,
        names: Array.from(key.matchAll(/\{(\w+)\}/g), (m) => m[1]),
        re: new RegExp(`^${parts.map(escapeRegExp).join('(.+?)')}$`, 's'),
      }));
    patternCache.set(pack, list);
  }
  return list;
}
function translateDynamic(pack: LanguagePack, text: string): string | null {
  let cache = dynamicCache.get(pack);
  if (!cache) {
    cache = new Map();
    dynamicCache.set(pack, cache);
  }
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  let result: string | null = null;
  for (const { key, names, re } of patternsOf(pack)) {
    const match = re.exec(text);
    if (match) {
      result = fill(pack.messages[key], Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
      break;
    }
  }
  if (cache.size >= MAX_DYNAMIC_CACHE) cache.clear();
  cache.set(text, result);
  return result;
}
export function translate(key: string, params?: TranslateParams): string {
  const pack = activePack();
  let text = key;
  if (pack.code !== SOURCE_LANGUAGE) {
    text =
      pack.messages[key] ??
      ENGLISH_PACK.messages[key] ??
      (params ? null : (translateDynamic(pack, key) ?? translateDynamic(ENGLISH_PACK, key))) ??
      key;
  }
  return params ? fill(text, params) : text;
}
