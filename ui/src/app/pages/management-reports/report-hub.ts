import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { ReportNav } from './report-nav';

@Component({
  selector: 'app-report-hub',
  imports: [RouterLink, Icon, PageHeader, ReportNav],
  templateUrl: './report-hub.html',
  styleUrl: '../imports/imports.css',
})
export class ReportHub {
  readonly cards = [
    {
      path: '/management-reports/daily',
      icon: 'calendar',
      title: 'Daily transactions',
      text: 'Date-wise voucher count, receipts, payments and net movement.',
    },
    {
      path: '/management-reports/weekly',
      icon: 'calendar',
      title: 'Weekly transactions',
      text: 'ISO week totals so a VP can see whether activity is rising or falling.',
    },
    {
      path: '/management-reports/monthly',
      icon: 'forecast',
      title: 'Monthly trend',
      text: 'Month-wise inflow, outflow and turnover from imported books.',
    },
    {
      path: '/management-reports/types',
      icon: 'transactions',
      title: 'Voucher mix',
      text: 'Payment, receipt, sales, purchase and journal concentration.',
    },
    {
      path: '/management-reports/parties',
      icon: 'user',
      title: 'Top counterparties',
      text: 'Parties with the highest voucher value in the selected period.',
    },
    {
      path: '/management-reports/large',
      icon: 'warning',
      title: 'Large vouchers',
      text: 'High-value transactions that usually need VP attention.',
    },
    {
      path: '/management-reports/companies',
      icon: 'company',
      title: 'Company activity',
      text: 'Compare companies on volume, receipts and payments.',
    },
    {
      path: '/reports',
      icon: 'spend',
      title: 'Expenses & projects',
      text: 'Existing expense concentration and project activity review.',
    },
    {
      path: '/imports/sync',
      icon: 'ledgers',
      title: 'Excel vs Tally gaps',
      text: 'Outstanding differences after Excel import and ledger mapping.',
    },
  ];
}
