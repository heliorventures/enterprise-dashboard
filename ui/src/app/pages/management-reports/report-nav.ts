import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-report-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `<nav class="import-nav" aria-label="Management reports">
    <a routerLink="/management-reports" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Report menu</a>
    <a routerLink="/management-reports/daily" routerLinkActive="active">Daily</a>
    <a routerLink="/management-reports/weekly" routerLinkActive="active">Weekly</a>
    <a routerLink="/management-reports/monthly" routerLinkActive="active">Monthly</a>
    <a routerLink="/management-reports/types" routerLinkActive="active">Voucher mix</a>
    <a routerLink="/management-reports/parties" routerLinkActive="active">Top parties</a>
    <a routerLink="/management-reports/large" routerLinkActive="active">Large vouchers</a>
    <a routerLink="/management-reports/companies" routerLinkActive="active">By company</a>
  </nav>`,
  styleUrl: '../imports/imports.css',
})
export class ReportNav {}
