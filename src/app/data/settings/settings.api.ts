import { invoke } from '@tauri-apps/api/core';
import { UserRole } from '../../core/auth/session.store';
import { getStoredUsername } from '../../core/storage/local-storage';
import { DisplaySettings, ThemeOption } from './settings.model';
function account(role: UserRole): { user_type: UserRole; username: string } {
  return { user_type: role, username: getStoredUsername() ?? '' };
}
export function getTheme(role: UserRole): Promise<ThemeOption> {
  return invoke<ThemeOption>('settings', {
    command: { method: 'theme_get', ...account(role) },
  });
}
export function getBackgroundColor(role: UserRole): Promise<string> {
  return invoke<string>('settings', {
    command: { method: 'background_color_get', ...account(role) },
  });
}
export function getFontSize(role: UserRole): Promise<number> {
  return invoke<number>('settings', {
    command: { method: 'font_size_get', ...account(role) },
  });
}
export function setTheme(role: UserRole, value: ThemeOption): Promise<ThemeOption> {
  return invoke<ThemeOption>('settings', {
    command: { method: 'theme_set', ...account(role), value },
  });
}
export function setBackgroundColor(role: UserRole, value: string): Promise<string> {
  return invoke<string>('settings', {
    command: { method: 'background_color_set', ...account(role), value },
  });
}
export function setFontSize(role: UserRole, value: number): Promise<number> {
  return invoke<number>('settings', {
    command: { method: 'font_size_set', ...account(role), value },
  });
}
export function getActivated(): Promise<boolean> {
  return invoke<boolean>('settings', { command: { method: 'activation_get' } });
}
export function activate(value: string): Promise<boolean> {
  return invoke<boolean>('settings', { command: { method: 'activation_set', value } });
}
export async function loadDisplaySettings(role: UserRole): Promise<DisplaySettings> {
  const [theme, backgroundColor, fontSize] = await Promise.all([
    getTheme(role),
    getBackgroundColor(role),
    getFontSize(role),
  ]);
  return { theme, backgroundColor, fontSize };
}
export async function saveDisplaySettings(
  role: UserRole,
  draft: DisplaySettings,
): Promise<DisplaySettings> {
  const theme = await setTheme(role, draft.theme);
  const backgroundColor = await setBackgroundColor(role, draft.backgroundColor);
  const fontSize = await setFontSize(role, draft.fontSize);
  return { theme, backgroundColor, fontSize };
}
