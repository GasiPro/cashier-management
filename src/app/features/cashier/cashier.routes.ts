import { Routes } from '@angular/router';

export const CASHIER_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./cashier.page').then((m) => m.CashierPage),
  },
];
