import { Routes } from '@angular/router';
import { roleGuard } from '../../core/auth/role.guard';
export const SETTINGS_ROUTES: Routes = [
  {
    path: 'reglages',
    loadComponent: () => import('./settings.page').then((m) => m.SettingsPage),
  },
  {
    path: 'affichage',
    loadComponent: () => import('./display/display.page').then((m) => m.DisplayPage),
  },
  {
    path: 'profil',
    canActivate: [roleGuard('caissier', 'comptoir')],
    loadComponent: () => import('./profile/profile.page').then((m) => m.ProfilePage),
  },
];
