import { invoke } from '@tauri-apps/api/core';
import { getStoredUsername } from '../../core/storage/local-storage';
import { DisplaySettings, ThemeOption } from './settings.model';
function username(): string {
  return getStoredUsername() ?? '';
}
export function getTheme(): Promise<ThemeOption> {
  return invoke<ThemeOption>('settings', {
    command: { method: 'theme_get', username: username() },
  });
}
export function getBackgroundColor(): Promise<string> {
  return invoke<string>('settings', {
    command: { method: 'background_color_get', username: username() },
  });
}
export function getFontSize(): Promise<number> {
  return invoke<number>('settings', {
    command: { method: 'font_size_get', username: username() },
  });
}
export function setTheme(value: ThemeOption): Promise<ThemeOption> {
  return invoke<ThemeOption>('settings', {
    command: { method: 'theme_set', username: username(), value },
  });
}
export function setBackgroundColor(value: string): Promise<string> {
  return invoke<string>('settings', {
    command: { method: 'background_color_set', username: username(), value },
  });
}
export function setFontSize(value: number): Promise<number> {
  return invoke<number>('settings', {
    command: { method: 'font_size_set', username: username(), value },
  });
}
export function getActivated(): Promise<boolean> {
  return invoke<boolean>('settings', { command: { method: 'activation_get' } });
}
export function activate(value: string): Promise<boolean> {
  return invoke<boolean>('settings', { command: { method: 'activation_set', value } });
}
export async function loadDisplaySettings(): Promise<DisplaySettings> {
  const [theme, backgroundColor, fontSize] = await Promise.all([
    getTheme(),
    getBackgroundColor(),
    getFontSize(),
  ]);
  return { theme, backgroundColor, fontSize };
}
export async function saveDisplaySettings(draft: DisplaySettings): Promise<DisplaySettings> {
  const theme = await setTheme(draft.theme);
  const backgroundColor = await setBackgroundColor(draft.backgroundColor);
  const fontSize = await setFontSize(draft.fontSize);
  return { theme, backgroundColor, fontSize };
}
