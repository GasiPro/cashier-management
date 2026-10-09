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

export const BACKGROUND_PRESETS: string[] = ['#FAFAFA', '#FFFFFF', '#F1F5F9', '#1E293B', '#0F172A'];

export interface DisplaySettings {
  theme: ThemeOption;
  backgroundColor: string;
  fontSize: number;
}
