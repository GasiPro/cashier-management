import { Routes } from '@angular/router';
import { Cashier } from './presentation/views/cashier/cashier';
import { Counter } from './presentation/views/counter/counter';
import { LoginComponent } from './presentation/views/login/login';
import { Setting } from './presentation/views/setting/setting';
import { DisplaySetting } from './presentation/shared/display-setting/display-setting';
import { Admin } from './presentation/views/admin/admin';
import { Dashboard } from './presentation/views/admin/dashboard/dashboard';
import { Account } from './presentation/views/admin/account/account';
import { Connexion } from './presentation/views/admin/connexion/connexion';
import { Product } from './presentation/views/admin/product/product';
import { Order } from './presentation/views/admin/order/order';
import { Report } from './presentation/views/admin/report/report';
export const routes: Routes = [
    { path: '', redirectTo: 'login', pathMatch: 'full' },
    { path: 'login', component: LoginComponent },
    {
        path: 'admin',
        component: Admin,
        children: [
            { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
            { path: 'dashboard', component: Dashboard },
            { path: 'comptes', component: Account },
            { path: 'appareils', component: Connexion },
            { path: 'grille-tarifaire', component: Product },
            { path: 'commandes', component: Order },
            { path: 'rapport', component: Report },
        ],
    },
    { path: 'caissier', component: Cashier },
    { path: 'comptoir', component: Counter },
    { path: 'reglages', component: Setting },
    { path: 'affichage', component: DisplaySetting },
    { path: '**', redirectTo: 'login' },
];
