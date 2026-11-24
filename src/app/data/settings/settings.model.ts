import { APP_NAME } from '../../core/config/app.constants';
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
export const FONT_SIZE_STEP = 1;
export type AppMode = 'caisse' | 'comptoir';
export const DEFAULT_ORGANIZATION_NAME = APP_NAME;
export interface Organization {
  name: string;
  email: string;
  phone: string;
}
export interface PhoneRegion {
  name: string;
  prefix: string;
  /** ISO country codes and IANA time zones used to detect the region automatically. */
  codes: string[];
  zones: string[];
}
export const DEFAULT_PHONE_PREFIX = '+261';
export const PHONE_REGIONS: PhoneRegion[] = [
  { name: 'Madagascar', prefix: '+261', codes: ['MG'], zones: ['Indian/Antananarivo'] },
  { name: 'Comores', prefix: '+269', codes: ['KM'], zones: ['Indian/Comoro'] },
  { name: 'Maurice', prefix: '+230', codes: ['MU'], zones: ['Indian/Mauritius'] },
  { name: 'Réunion / Mayotte', prefix: '+262', codes: ['RE', 'YT'], zones: ['Indian/Reunion', 'Indian/Mayotte'] },
  { name: 'Seychelles', prefix: '+248', codes: ['SC'], zones: ['Indian/Mahe'] },
  { name: 'France', prefix: '+33', codes: ['FR'], zones: ['Europe/Paris'] },
  { name: 'Belgique', prefix: '+32', codes: ['BE'], zones: ['Europe/Brussels'] },
  { name: 'Suisse', prefix: '+41', codes: ['CH'], zones: ['Europe/Zurich'] },
  { name: 'Canada / États-Unis', prefix: '+1', codes: ['CA', 'US'], zones: [] },
  { name: 'Maroc', prefix: '+212', codes: ['MA'], zones: ['Africa/Casablanca'] },
  { name: 'Sénégal', prefix: '+221', codes: ['SN'], zones: ['Africa/Dakar'] },
  { name: "Côte d'Ivoire", prefix: '+225', codes: ['CI'], zones: ['Africa/Abidjan'] },
];
export type ThemeOption = 'clair' | 'sombre' | 'systeme';
export interface ThemeChoice {
  value: ThemeOption;
  label: string;
}
export const THEME_CHOICES: ThemeChoice[] = [
  { value: 'clair', label: 'Clair' },
  { value: 'sombre', label: 'Sombre' },
  { value: 'systeme', label: 'Système' },
];
export const BACKGROUND_PRESETS: Record<'light' | 'dark', string[]> = {
  light: ['#EBE8E1', '#F3EFE6', '#E4EAEF', '#E8EEE6', '#FFFFFF'],
  dark: ['#0F172A', '#0B1220', '#0F1F2E', '#10252B', '#1A1B2E'],
};
export interface DisplaySettings {
  theme: ThemeOption;
  backgroundColor: string;
  fontSize: number;
}
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  theme: 'clair',
  backgroundColor: BACKGROUND_PRESETS.light[0],
  fontSize: 14,
};
