import { loadDisplaySettings } from '../../data/settings/settings.api';
import { DisplaySettings, ThemeOption } from '../../data/settings/settings.model';
/** Font-size setting that maps to the browser's default 16px root size. */
const REFERENCE_FONT_SIZE = 14;
const DEFAULT_ROOT_FONT_PX = 16;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let currentTheme: ThemeOption = 'clair';
function applyTheme(): void {
  const dark = currentTheme === 'sombre' || (currentTheme === 'systeme' && systemDark.matches);
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
}
systemDark.addEventListener('change', applyTheme);
/** Applies theme, page background colour and font size to the whole app. */
export function applyDisplaySettings(settings: DisplaySettings): void {
  const root = document.documentElement;
  root.style.fontSize = `${(DEFAULT_ROOT_FONT_PX * settings.fontSize) / REFERENCE_FONT_SIZE}px`;
  root.style.setProperty('--app-bg', settings.backgroundColor);
  currentTheme = settings.theme;
  applyTheme();
}
/** Loads the saved display settings and applies them; keeps the defaults if loading fails. */
export async function initDisplaySettings(): Promise<void> {
  try {
    applyDisplaySettings(await loadDisplaySettings());
  } catch (e) {
    console.error('failed to load display settings', e);
  }
}
