import { Routes } from '@angular/router';

export const SETTINGS_ROUTES: Routes = [
  {
    path: 'reglages',
    loadComponent: () => import('./settings.page').then((m) => m.SettingsPage),
  },
  {
    path: 'affichage',
    loadComponent: () => import('./display/display.page').then((m) => m.DisplayPage),
  },
];
