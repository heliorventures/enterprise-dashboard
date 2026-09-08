import { Routes } from '@angular/router';
import { Dashboard } from './pages/dashboard/dashboard';
import { Ledgers } from './pages/ledgers/ledgers';
import { Transactions } from './pages/transactions/transactions';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: Dashboard },
  { path: 'ledgers', component: Ledgers },
  { path: 'transactions', component: Transactions },
  { path: '**', redirectTo: 'dashboard' },
];
