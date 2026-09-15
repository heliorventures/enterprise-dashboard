import { describe, expect, it } from 'vitest';
import { compactInr, fullInr } from './money';

describe('unavailable financial amounts', () => {
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
