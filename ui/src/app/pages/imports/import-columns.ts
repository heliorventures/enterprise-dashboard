import { ImportRecord } from '../../services/excel-import';
import { DataColumn } from '../../shared/data-table';
import { importMoney } from './import-money';

export function importText(value: unknown) {
  return value == null || value === '' ? '—' : String(value);
}

export function importDetail(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map(importDetail).join('; ') : '—';
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? entries.map(([key, item]) =>
      `${key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')}: ${importDetail(item)}`).join('; ') : '—';
  }
  return String(value);
}

export function importRowKey(row: ImportRecord) {
  return String(row['id'] ?? row['ageing_bucket'] ?? '');
}

export function importDate(value: unknown) {
  if (!value) return 'Unknown';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString('en-IN');
}

export function comparisonMoney(value: unknown, currency: unknown = null) {
  return value == null || !currency ? 'Unavailable' : importMoney(value,currency);
}

export const exceptionColumns: DataColumn<ImportRecord>[] = [
  {
    key: 'title',
    label: 'Issue',
    value: (row) => importText(row['title'] || row['type']).replaceAll('_', ' '),
    primary: true,
  },
  {
    key: 'severity',
    label: 'Severity',
    value: (row) => importText(row['severity']),
    primary: true,
  },
  { key: 'status', label: 'Status', value: (row) => importText(row['status']), primary: true },
  { key: 'detail', label: 'Detail', value: (row) => importDetail(row['detail']) },
  { key: 'owner', label: 'Owner', value: (row) => importText(row['owner']) },
];

export const auditColumns: DataColumn<ImportRecord>[] = [
  {
    key: 'date',
    label: 'When',
    value: (row) =>
      row['created_at'] ? new Date(String(row['created_at'])).toLocaleString('en-IN') : 'Unknown',
    primary: true,
  },
  {
    key: 'action',
    label: 'Action',
    value: (row) => importText(row['action']).replaceAll('_', ' '),
    primary: true,
  },
  { key: 'user', label: 'User', value: (row) => importText(row['username']), primary: true },
  {
    key: 'entity',
    label: 'Entity',
    value: (row) => importText(row['entity']),
    secondary: (row) => importText(row['entity_id']),
  },
];
