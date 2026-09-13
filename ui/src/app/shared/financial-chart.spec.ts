import { chartDomain } from './financial-chart';
import { monthEnd, voucherColumns } from './record-columns';

describe('Financial presentation', () => {
  it('places zero between negative and positive balances on one proportional scale', () => {
    const domain = chartDomain([
      {
        key: 'company',
        label: 'Company',
        values: [
          { label: 'Loss', value: -100 },
          { label: 'Revenue', value: 300 },
        ],
      },
    ]);
    expect(domain).toEqual({ min: -100, max: 300, span: 400, zero: 25 });
  });
  it('keeps zero at the right edge for entirely negative balances', () => {
    expect(
      chartDomain([{ key: 'loss', label: 'Loss', values: [{ label: 'Net', value: -100 }] }]).zero,
    ).toBe(100);
  });
  it('has a finite scale for empty and zero-only datasets', () => {
    expect(chartDomain([]).span).toBe(1);
    expect(
      chartDomain([{ key: 'zero', label: 'Zero', values: [{ label: 'Net', value: 0 }] }]).span,
    ).toBe(1);
  });
  it('excludes non-finite values from the scale', () => {
    expect(
      chartDomain([
        {
          key: 'invalid',
          label: 'Invalid',
          values: [
            { label: 'Net', value: NaN },
            { label: 'Unknown', value: Infinity },
          ],
        },
      ]).span,
    ).toBe(1);
  });
  it('includes the last calendar date regardless of browser timezone', () => {
    expect(monthEnd('2026-08-01')).toBe('2026-08-31');
    expect(monthEnd('2024-02-01')).toBe('2024-02-29');
    expect(monthEnd('2026-02-01')).toBe('2026-02-28');
    expect(monthEnd('2026-12-01')).toBe('2026-12-31');
  });
  it('does not present zero voucher amounts as confirmed complete data', () => {
    const column = voucherColumns.find((c) => c.key === 'amount')!;
    expect(column.secondary!({ amount: 0 } as Parameters<typeof column.value>[0])).toBe(
      'Zero or missing in source',
    );
  });
});
