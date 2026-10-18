import { describe, it, expect } from 'vitest';
import { HOSTED_CURRENCIES } from '../currencies';

describe('HOSTED_CURRENCIES (MUT-183 R4)', () => {
  it('lists every currency the API accepts, in the order the pickers have always shown', () => {
    // The compile-time check in currencies.ts fails typecheck if the API adds a currency;
    // this pins the order, which the expense and conversion pickers already use.
    expect(HOSTED_CURRENCIES).toEqual(['USD', 'ILS', 'EUR', 'JOD', 'AED', 'SAR', 'QAR', 'BHD', 'OMR']);
  });
});
