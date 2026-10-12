import { describe, it, expect } from 'vitest';
import { orderCurrencyAmounts } from '../currencyAmounts';

describe('orderCurrencyAmounts', () => {
  it('lists each non-zero currency once, in USD, ILS, EUR order', () => {
    expect(orderCurrencyAmounts({ EUR: 1500, USD: 24000, ILS: 350000 })).toEqual([
      { currency: 'USD', amountMinor: 24000 },
      { currency: 'ILS', amountMinor: 350000 },
      { currency: 'EUR', amountMinor: 1500 },
    ]);
  });

  it('leaves out zero and missing currencies', () => {
    expect(orderCurrencyAmounts({ USD: 0, ILS: 5000 })).toEqual([{ currency: 'ILS', amountMinor: 5000 }]);
    expect(orderCurrencyAmounts({})).toEqual([]);
  });
});
