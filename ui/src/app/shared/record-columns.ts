import { LedgerRow, VoucherRow } from '../models/books';
import { DataColumn } from './data-table';
import { fullInr, drCr } from './money';

export const cleanText = (value: string | null | undefined) =>
  (value || '').replace(/\u0004/g, '').trim() || '—';
export const recordKey = (row: { id: string | number }) => row.id;
export const balanceTone = (value: number) => (value < 0 ? 'negative' : 'neutral');
const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
export function recordDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : dateFormat.format(date);
}
export function monthEnd(from: string) {
  const [year, month] = from.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
export const ledgerColumns: DataColumn<LedgerRow>[] = [
  {
    key: 'name',
    label: 'Ledger',
    value: (r) => cleanText(r.name),
    secondary: (r) => r.companyName,
  },
  {
    key: 'balance',
    label: 'Closing balance',
    value: (r) => fullInr(r.balance),
    numeric: true,
    primary: true,
  },
  { key: 'side', label: 'Side', value: (r) => drCr(r.balance), primary: true },
  { key: 'group', label: 'Group', value: (r) => cleanText(r.group), primary: true },
];
export const voucherColumns: DataColumn<VoucherRow>[] = [
  {
    key: 'party',
    label: 'Party / ledger',
    value: (r) => cleanText(r.party || r.number),
    secondary: (r) => r.companyName,
  },
  {
    key: 'amount',
    label: 'Reported amount',
    value: (r) => fullInr(r.amount),
    secondary: (r) => (r.amount === 0 ? 'Zero or missing in source' : ''),
    numeric: true,
    primary: true,
  },
  { key: 'date', label: 'Date', value: (r) => recordDate(r.date), primary: true },
  { key: 'type', label: 'Voucher type', value: (r) => cleanText(r.type), primary: true },
  { key: 'number', label: 'Voucher number', value: (r) => cleanText(r.number) },
  { key: 'project', label: 'Project', value: (r) => cleanText(r.project) },
  { key: 'narration', label: 'Narration', value: (r) => cleanText(r.narration) },
];
