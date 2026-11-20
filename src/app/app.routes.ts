import { Routes } from '@angular/router';
import { activationGuard, activationPageGuard } from './core/auth/activation.guard';
import { authGuard } from './core/auth/auth.guard';
import { loginGuard } from './core/auth/login.guard';
import { modeGuard, modePageGuard, modeSelectedGuard } from './core/auth/mode.guard';
import { roleGuard } from './core/auth/role.guard';
export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'activation',
    canActivate: [activationPageGuard],
    loadChildren: () =>
      import('./features/activation/activation.routes').then((m) => m.ACTIVATION_ROUTES),
  },
  {
    path: 'mode',
    canActivate: [modePageGuard],
    loadChildren: () => import('./features/mode/mode.routes').then((m) => m.MODE_ROUTES),
  },
  {
    path: 'login',
    canActivate: [activationGuard, modeSelectedGuard, loginGuard],
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
