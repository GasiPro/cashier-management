export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_LOCALE = 'en-GB';
export const SOURCE_LANGUAGE = 'fr';
export const SOURCE_LOCALE = 'fr-FR';
export type Messages = Record<string, string>;
export type TranslateParams = Record<string, string | number>;
export interface LanguagePack {
  code: string;
  name: string;
  locale: string;
  messages: Messages;
}
