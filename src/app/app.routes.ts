import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { loginGuard } from './core/auth/login.guard';
import { roleGuard } from './core/auth/role.guard';
export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    canActivate: [loginGuard],
    loadChildren: () => import('./features/login/login.routes').then((m) => m.LOGIN_ROUTES),
  },
  {
    path: 'admin',
    canActivate: [roleGuard('admin')],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: 'caissier',
    canActivate: [roleGuard('caissier')],
    loadChildren: () => import('./features/cashier/cashier.routes').then((m) => m.CASHIER_ROUTES),
  },
  {
    path: 'comptoir',
    canActivate: [roleGuard('comptoir')],
    loadChildren: () => import('./features/counter/counter.routes').then((m) => m.COUNTER_ROUTES),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadChildren: () => import('./features/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
  },
  { path: '**', redirectTo: 'login' },
];
