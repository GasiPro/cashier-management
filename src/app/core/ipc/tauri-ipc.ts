import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

export type IpcCommandName = 'auth' | 'account' | 'order' | 'pricing' | 'server' | 'settings' | 'file';

export function ipcInvoke<T>(name: IpcCommandName, command: Record<string, unknown>): Promise<T> {
  return invoke<T>(name, { command });
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export function ipcSaveDialog(options: SaveDialogOptions): Promise<string | null> {
  return save(options);
}
