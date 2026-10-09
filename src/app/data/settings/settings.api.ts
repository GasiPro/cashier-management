import { invoke } from '@tauri-apps/api/core';
import { DisplaySettings, ThemeOption } from './settings.model';

export function getTheme(): Promise<ThemeOption> {
  return invoke<ThemeOption>('settings', { command: { method: 'theme_get' } });
}

export function getBackgroundColor(): Promise<string> {
  return invoke<string>('settings', { command: { method: 'background_color_get' } });
}

export function getFontSize(): Promise<number> {
  return invoke<number>('settings', { command: { method: 'font_size_get' } });
}

export function setTheme(value: ThemeOption): Promise<ThemeOption> {
  return invoke<ThemeOption>('settings', {
    command: { method: 'theme_set', value },
  });
}

export function setBackgroundColor(value: string): Promise<string> {
  return invoke<string>('settings', {
    command: { method: 'background_color_set', value },
  });
}

export function setFontSize(value: number): Promise<number> {
  return invoke<number>('settings', {
    command: { method: 'font_size_set', value },
  });
}

export async function loadDisplaySettings(): Promise<DisplaySettings> {
  const [theme, backgroundColor, fontSize] = await Promise.all([
    getTheme(),
    getBackgroundColor(),
    getFontSize(),
  ]);
  return { theme, backgroundColor, fontSize };
}

/** Saves sequentially (theme, then background, then font size) and returns the applied values. */
export async function saveDisplaySettings(draft: DisplaySettings): Promise<DisplaySettings> {
  const theme = await setTheme(draft.theme);
  const backgroundColor = await setBackgroundColor(draft.backgroundColor);
  const fontSize = await setFontSize(draft.fontSize);
  return { theme, backgroundColor, fontSize };
}
