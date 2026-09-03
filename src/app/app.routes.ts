import { Routes } from '@angular/router';
import { Cashier } from './presentation/views/cashier/cashier';
import { Counter } from './presentation/views/counter/counter';
import { LoginComponent } from './presentation/views/login/login';
import { Setting } from './presentation/views/setting/setting';
import { DisplaySetting } from './presentation/shared/display-setting/display-setting';
import { Admin } from './presentation/views/admin/admin';
import { Dashboard } from './presentation/views/admin/dashboard/dashboard';

export const routes: Routes = [
    { path: '', redirectTo: 'login', pathMatch: 'full' },
    { path: 'login', component: LoginComponent },
    { path: 'admin', component: Admin },
    { path: 'admin/dashboard', component: Dashboard },
    { path: 'caissier', component: Cashier },
    { path: 'comptoir', component: Counter },
    { path: 'reglages', component: Setting },
    { path: 'affichage', component: DisplaySetting },
    { path: '**', redirectTo: 'login' },
];