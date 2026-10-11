import { describe, expect, it } from 'vitest';
import { importDetail } from './import-columns';
import { importMoney } from './import-money';

describe('exception detail formatting', () => {
  it('uses declared USD and never infers INR for unspecified source currency',()=>{
    expect(importMoney(10,'USD')).toContain('$');
    expect(importMoney(10,'USD')).not.toContain('₹');
    expect(importMoney(10)).toContain('currency unspecified');
    expect(importMoney(null)).toBe('Unavailable');
  });
  it('retains structured amounts and nested validation details', () => {
    expect(importDetail({sourceAmount:'12.30',tally_amount:'10.00',issues:[{code:'MISSING_VALUE',row:3}]}))
      .toBe('source Amount: 12.30; tally amount: 10.00; issues: code: MISSING_VALUE; row: 3');
  });
  it('preserves zeros and scalars and leaves markup as text', () => {
    expect(importDetail(0)).toBe('0');
    expect(importDetail(false)).toBe('false');
    expect(importDetail(null)).toBe('—');
    expect(importDetail('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});
