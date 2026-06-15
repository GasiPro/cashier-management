import { Routes } from '@angular/router';
import { Cashier } from './presentation/vews/cashier/cashier';
import { Counter } from './presentation/vews/counter/counter';
import { LoginComponent } from './presentation/vews/login/login';

export const routes: Routes = [
    { path: '', redirectTo: 'login', pathMatch: 'full' },
    { path: 'login', component: LoginComponent },
    { path: 'caissier', component: Cashier },
    { path: 'comptoir', component: Counter },
    { path: '**', redirectTo: 'login' },
];
