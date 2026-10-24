import { describe, expect, it } from 'vitest';
import { bigintToDecimal } from '../money';

describe('bigintToDecimal', () => {
  it.each([
    [12345n, 'ILS', '123.45'],
    [12345n, 'JOD', '12.345'],
    [-5n, 'USD', '-0.05'],
    [123456789012345678901234567890n, 'EUR', '1234567890123456789012345678.90'],
  ])('%s %s is %s', (minor, currency, decimal) => {
    expect(bigintToDecimal(minor, currency)).toBe(decimal);
  });

  it('formats a currency the API has retired instead of failing a Restore that holds one (MUT-388)', () => {
    expect(bigintToDecimal(1500n, 'AED')).toBe('15.00');
    expect(bigintToDecimal(1500n, 'BHD')).toBe('1.500');
  });
});
