export interface LocaleSettings {
  language: string;
  region: string;
}
export interface LocaleChoice {
  value: string;
  label: string;
}
export const LANGUAGE_CHOICES: LocaleChoice[] = [{ value: 'fr', label: 'Français' }];
export const REGION_CHOICES: LocaleChoice[] = [
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'CA', label: 'Canada' },
  { value: 'CH', label: 'Suisse' },
  { value: 'LU', label: 'Luxembourg' },
  { value: 'MG', label: 'Madagascar' },
];
export const DEFAULT_LOCALE_SETTINGS: LocaleSettings = { language: 'fr', region: 'FR' };
