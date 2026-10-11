import { describe, expect, it } from 'vitest';
import { compactInr, fullInr } from './money';

describe('unavailable financial amounts', () => {
  it('formats known USD without INR and never guesses unknown currency', () => {
    for (const format of [compactInr, fullInr]) {
      expect(format(125000, 'USD')).toContain('$');
      expect(format(125000, 'USD')).not.toContain('₹');
      expect(format(125000, null)).toBe('Currency unavailable');
      expect(format(125000, 'ZZZ')).toBe('Currency unavailable');
    }
  });
  it('distinguishes unavailable amounts from an explicitly reported zero', () => {
    for (const format of [compactInr, fullInr]) {
      for (const missing of [null, undefined, NaN, Infinity]) {
        expect(format(missing as number)).toBe('Not available');
      }
      expect(format(0)).toContain('0.00');
      expect(format(100)).not.toBe('Not available');
    }
  });
});
