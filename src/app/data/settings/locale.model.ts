export interface LocaleSettings {
  language: string;
  region: string;
}
export interface LocaleChoice {
  value: string;
  label: string;
}
export const LANGUAGE_CHOICES: LocaleChoice[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
];
export const REGION_CODES: string[] = [
  'GB', 'US', 'CA', 'AU', 'IE', 'FR', 'BE', 'CH', 'LU', 'DE', 'AT', 'ES',
  'PT', 'IT', 'NL', 'SE', 'BR', 'MX', 'CN', 'JP', 'KR', 'IN', 'ZA', 'MG',
];
export function regionChoices(locale: string): LocaleChoice[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    names = null;
  }
  return REGION_CODES.map((code) => ({ value: code, label: names?.of(code) ?? code })).sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}
export const DEFAULT_LOCALE_SETTINGS: LocaleSettings = { language: 'en', region: 'GB' };
