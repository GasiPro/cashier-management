import { invoke } from '@tauri-apps/api/core';
import { AccountActivity, AccountView, UserType } from './account.model';

export interface CreateAccountInput {
  username: string;
  password: string;
  display_name: string;
  user_type: UserType;
}

export interface UpdateAccountInput {
  username: string;
  display_name: string;
  user_type: UserType;
  /** Optional: left empty/undefined, the current password is kept. */
  password?: string;
}

export function listAccounts(): Promise<AccountView[]> {
  return invoke<AccountView[]>('account', { command: { method: 'list' } });
}

export function createAccount(input: CreateAccountInput): Promise<AccountView> {
  return invoke<AccountView>('account', {
    command: {
      method: 'create',
      username: input.username,
      password: input.password,
      display_name: input.display_name,
      user_type: input.user_type,
    },
  });
}

export function updateAccount(input: UpdateAccountInput): Promise<AccountView> {
  const newPassword = input.password ?? '';
  return invoke<AccountView>('account', {
    command: {
      method: 'update',
      username: input.username,
      display_name: input.display_name,
      user_type: input.user_type,
      ...(newPassword.length > 0 ? { password: newPassword } : {}),
    },
  });
}

export function suspendAccount(username: string): Promise<AccountView> {
  return invoke<AccountView>('account', {
    command: { method: 'suspend', username },
  });
}

export function reactivateAccount(username: string): Promise<AccountView> {
  return invoke<AccountView>('account', {
    command: { method: 'reactivate', username },
  });
}

export function deleteAccount(username: string): Promise<void> {
  return invoke<void>('account', {
    command: { method: 'delete', username },
  });
}

export function listAccountActivities(): Promise<AccountActivity[]> {
  return invoke<AccountActivity[]>('account', {
    command: { method: 'activities' },
  });
}
