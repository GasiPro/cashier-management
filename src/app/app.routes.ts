import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { loginGuard } from './core/auth/login.guard';
import { modeGuard } from './core/auth/mode.guard';
import { roleGuard } from './core/auth/role.guard';
import { setupGuard, setupPageGuard } from './core/auth/setup.guard';
export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'setup',
    canActivate: [setupPageGuard],
    loadChildren: () => import('./features/setup/setup.routes').then((m) => m.SETUP_ROUTES),
  },
  {
    path: 'login',
    canActivate: [setupGuard, loginGuard],
    loadChildren: () => import('./features/login/login.routes').then((m) => m.LOGIN_ROUTES),
  },
  {
    path: 'admin',
    canActivate: [modeGuard('caisse'), roleGuard('admin')],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: 'caissier',
    canActivate: [modeGuard('caisse'), roleGuard('caissier')],
    loadChildren: () => import('./features/cashier/cashier.routes').then((m) => m.CASHIER_ROUTES),
  },
  {
    path: 'comptoir',
    canActivate: [modeGuard('comptoir'), roleGuard('comptoir')],
    loadChildren: () => import('./features/counter/counter.routes').then((m) => m.COUNTER_ROUTES),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadChildren: () => import('./features/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
  },
  { path: '**', redirectTo: 'login' },
];
