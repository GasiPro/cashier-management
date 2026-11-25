export const DEFAULT_LANGUAGE = 'fr';
export const DEFAULT_LOCALE = 'fr-FR';
export type Messages = Record<string, string>;
export type TranslateParams = Record<string, string | number>;
export interface LanguagePack {
  code: string;
  name: string;
  locale: string;
  messages: Messages;
}
