import { Routes } from '@angular/router';
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('../../layouts/admin-layout/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'comptes',
        loadComponent: () => import('./accounts/accounts.page').then((m) => m.AccountsPage),
      },
      {
        path: 'appareils',
        loadComponent: () => import('./devices/devices.page').then((m) => m.DevicesPage),
      },
      {
        path: 'grille-tarifaire',
        loadComponent: () => import('./pricing/pricing.page').then((m) => m.PricingPage),
      },
      {
        path: 'commandes',
        loadComponent: () => import('./orders/orders.page').then((m) => m.OrdersPage),
      },
      {
        path: 'rapport',
        loadComponent: () => import('./reports/reports.page').then((m) => m.ReportsPage),
      },
      {
        path: 'profil',
        loadComponent: () => import('./profile/profile.page').then((m) => m.AdminProfilePage),
      },
      {
        path: 'reglages',
        loadComponent: () => import('./settings/settings.page').then((m) => m.AdminSettingsPage),
      },
      {
        path: 'affichage',
        loadComponent: () => import('../settings/display/display.page').then((m) => m.DisplayPage),
      },
      {
        path: 'mise-a-jour',
        loadComponent: () => import('./update/update.page').then((m) => m.UpdatePage),
      },
    ],
  },
];
