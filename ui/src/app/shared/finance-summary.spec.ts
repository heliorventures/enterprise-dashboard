import { reportedMoney, projectActivityColumns } from './finance-summary';
import { csvCell } from './csv';

describe('Financial record integrity', () => {
  it('distinguishes unavailable, zero and negative amounts', () => {
    expect(reportedMoney(undefined)).toBe('Not available');
    expect(reportedMoney(NaN)).toBe('Not available');
    expect(reportedMoney(0)).not.toBe('Not available');
    expect(reportedMoney(-10)).toContain('-');
  });
  it('preserves project scope in transaction drill-downs', () => {
    const row = { id: 1, name: 'Project A', companyId: '2', companyName: 'Company' };
    expect(projectActivityColumns[0].link!(row)).toEqual({
      path: '/transactions',
      query: { company: '2', q: 'Project A' },
    });
    expect(projectActivityColumns.find((c) => c.key === 'net')!.value(row)).toBe('Not available');
  });
  it('neutralizes spreadsheet formulas without changing numeric financial values', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('  @SUM(A1)')).toBe("'  @SUM(A1)");
    expect(csvCell(-100)).toBe('-100');
    expect(csvCell('ordinary text')).toBe('ordinary text');
    expect(csvCell('first\rsecond')).toBe('"first\rsecond"');
  });
});
