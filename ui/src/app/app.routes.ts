import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth.guard';
import { Dashboard } from './pages/dashboard/dashboard';
import { Ledgers } from './pages/ledgers/ledgers';
import { Login } from './pages/login/login';
import { Operations } from './pages/operations/operations';
import { Reports } from './pages/reports/reports';
import { Transactions } from './pages/transactions/transactions';

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [guestGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: Dashboard, canActivate: [authGuard] },
  { path: 'reports', component: Reports, canActivate: [authGuard] },
  { path: 'ledgers', component: Ledgers, canActivate: [authGuard] },
  { path: 'transactions', component: Transactions, canActivate: [authGuard] },
  { path: 'operations', component: Operations, canActivate: [authGuard] },
  { path: '**', redirectTo: 'dashboard' },
];
