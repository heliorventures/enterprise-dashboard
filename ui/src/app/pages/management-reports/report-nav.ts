import { Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-report-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `<nav class="import-nav" aria-label="Management reports">
    <a routerLink="/management-reports" [queryParams]="scope()" queryParamsHandling="merge" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Report menu</a>
    <a routerLink="/management-reports/daily" [queryParams]="scope()" queryParamsHandling="merge" routerLinkActive="active">Daily</a>
    <a routerLink="/management-reports/weekly" [queryParams]="scope()" queryParamsHandling="merge" routerLinkActive="active">Weekly</a>
    <a routerLink="/management-reports/monthly" [queryParams]="scope()" queryParamsHandling="merge" routerLinkActive="active">Monthly</a>
    <a routerLink="/management-reports/types" [queryParams]="scope()" queryParamsHandling="merge" routerLinkActive="active">Voucher mix</a>
    <a routerLink="/management-reports/parties" [queryParams]="scope()" queryParamsHandling="merge" routerLinkActive="active">Top parties</a>
    <a routerLink="/management-reports/large" [queryParams]="scope()" queryParamsHandling="merge" routerLinkActive="active">Large vouchers</a>
    <a routerLink="/management-reports/companies" [queryParams]="scope()" queryParamsHandling="merge" routerLinkActive="active">By company</a>
  </nav>`,
  styleUrl: '../imports/imports.css',
})
export class ReportNav {
  readonly scope = input<Record<string, string>>({});
}
