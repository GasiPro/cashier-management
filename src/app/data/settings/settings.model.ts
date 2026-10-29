export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
export const FONT_SIZE_STEP = 1;
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
export const BACKGROUND_PRESETS: string[] = ['#EBE8E1', '#F3EFE6', '#E4EAEF', '#E8EEE6', '#FFFFFF'];
export interface DisplaySettings {
  theme: ThemeOption;
  backgroundColor: string;
  fontSize: number;
}
