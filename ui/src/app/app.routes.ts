import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth.guard';
import { Dashboard } from './pages/dashboard/dashboard';
import { ImportDetail } from './pages/imports/import-detail';
import { ImportAccount } from './pages/imports/import-account';
import { ImportAudit } from './pages/imports/import-audit';
import { ImportExceptions } from './pages/imports/import-exceptions';
import { ImportQualityView } from './pages/imports/import-quality';
import { ImportResults } from './pages/imports/import-results';
import { ImportProjectDetail } from './pages/imports/import-project-detail';
import { ImportMissing } from './pages/imports/import-missing';
import { ImportProjects } from './pages/imports/import-projects';
import { ImportProjectSummary } from './pages/imports/import-project-summary';
import { ImportCompare } from './pages/imports/import-compare';
import { ImportSync } from './pages/imports/import-sync';
import { ImportSyncDetail } from './pages/imports/import-sync-detail';
import { ImportWizard } from './pages/imports/import-wizard';
import { Imports } from './pages/imports/imports';
import { Ledgers } from './pages/ledgers/ledgers';
import { Login } from './pages/login/login';
import { ReportHub } from './pages/management-reports/report-hub';
import { ReportView } from './pages/management-reports/report-view';
import { Operations } from './pages/operations/operations';
import { Reports } from './pages/reports/reports';
import { Transactions } from './pages/transactions/transactions';

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [guestGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: Dashboard, canActivate: [authGuard] },
  { path: 'reports', component: Reports, canActivate: [authGuard] },
  { path: 'management-reports', component: ReportHub, canActivate: [authGuard] },
  { path: 'management-reports/:kind', component: ReportView, canActivate: [authGuard] },
  { path: 'ledgers', component: Ledgers, canActivate: [authGuard] },
  { path: 'transactions', component: Transactions, canActivate: [authGuard] },
  { path: 'operations', component: Operations, canActivate: [authGuard] },
  { path: 'imports', component: Imports, canActivate: [authGuard] },
  { path: 'imports/new', component: ImportWizard, canActivate: [authGuard] },
  { path: 'imports/compare', component: ImportCompare, canActivate: [authGuard] },
  { path: 'imports/results', component: ImportResults, canActivate: [authGuard] },
  { path: 'imports/projects', component: ImportProjects, canActivate: [authGuard] },
  { path: 'imports/missing', component: ImportMissing, canActivate: [authGuard] },
  { path: 'imports/summary', component: ImportProjectSummary, canActivate: [authGuard] },
  { path: 'imports/projects/:id', component: ImportProjectDetail, canActivate: [authGuard] },
  { path: 'imports/sync', component: ImportSync, canActivate: [authGuard] },
  { path: 'imports/sync/:id', component: ImportSyncDetail, canActivate: [authGuard] },
  { path: 'imports/accounts/:id', component: ImportAccount, canActivate: [authGuard] },
  { path: 'imports/exceptions', component: ImportExceptions, canActivate: [authGuard] },
  { path: 'imports/quality', component: ImportQualityView, canActivate: [authGuard] },
  { path: 'imports/audit', component: ImportAudit, canActivate: [authGuard] },
  { path: 'imports/:id', component: ImportDetail, canActivate: [authGuard] },
  { path: '**', redirectTo: 'dashboard' },
];
