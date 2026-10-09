export type AccountStatus = 'active' | 'suspended';

export type UserType = 'admin' | 'caissier' | 'comptoir';

export interface UserTypeChoice {
  value: UserType;
  label: string;
}

export const USER_TYPES: UserTypeChoice[] = [
  { value: 'admin', label: 'Administrateur' },
  { value: 'caissier', label: 'Caissier' },
  { value: 'comptoir', label: 'Comptoir' },
];

export interface AccountHistoryEntry {
  kind: 'created' | 'suspended' | 'reactivated' | 'modified';
  at: string;
  reason?: string | null;
}

export interface AccountView {
  id: number;
  username: string;
  display_name: string;
  user_type: UserType;
  status: AccountStatus;
  created_at: string;
  last_sign_in_at?: string | null;
  history: AccountHistoryEntry[];
}

export type ActivityAction = 'Création' | 'Suspension' | 'Réactivation' | 'Modification';

export interface AccountActivity {
  id: number;
  account_username: string;
  action: ActivityAction;
  detail: string;
  at: string;
}

export function userTypeLabel(type: UserType): string {
  return USER_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function accountHistoryLabel(entry: AccountHistoryEntry): string {
  switch (entry.kind) {
    case 'created':
      return 'Compte créé';
    case 'suspended':
      return entry.reason ? `Suspendu — ${entry.reason}` : 'Suspendu';
    case 'reactivated':
      return 'Réactivé';
    case 'modified':
      return 'Modifié';
    default:
      return entry.kind;
  }
}
