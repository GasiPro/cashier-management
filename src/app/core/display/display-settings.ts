import { loadDisplaySettings } from '../../data/settings/settings.api';
import { BACKGROUND_PRESETS, DisplaySettings, ThemeOption } from '../../data/settings/settings.model';
const REFERENCE_FONT_SIZE = 14;
const DEFAULT_ROOT_FONT_PX = 16;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
let currentTheme: ThemeOption = 'clair';
let currentBackground = BACKGROUND_PRESETS.light[0];
export function isDarkTheme(theme: ThemeOption): boolean {
  return theme === 'sombre' || (theme === 'systeme' && systemDark.matches);
}
export function backgroundSuitsTheme(color: string, dark: boolean): boolean {
  const match = HEX_COLOR.exec(color);
  if (!match) return false;
  const [r, g, b] = [match[1], match[2], match[3]].map((channel) => parseInt(channel, 16));
  return ((0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5) === dark;
}
export function themeBackground(color: string, dark: boolean): string {
  return backgroundSuitsTheme(color, dark) ? color : BACKGROUND_PRESETS[dark ? 'dark' : 'light'][0];
}
function applyTheme(): void {
  const dark = isDarkTheme(currentTheme);
  const root = document.documentElement;
  root.dataset['theme'] = dark ? 'dark' : 'light';
  root.style.setProperty('--app-bg', themeBackground(currentBackground, dark));
}
systemDark.addEventListener('change', applyTheme);
export function applyDisplaySettings(settings: DisplaySettings): void {
  const root = document.documentElement;
  root.style.fontSize = `${(DEFAULT_ROOT_FONT_PX * settings.fontSize) / REFERENCE_FONT_SIZE}px`;
  currentBackground = settings.backgroundColor;
  currentTheme = settings.theme;
  applyTheme();
}
export async function initDisplaySettings(): Promise<void> {
  try {
    applyDisplaySettings(await loadDisplaySettings());
  } catch (e) {
    console.error('failed to load display settings', e);
  }
}
