import type { Currency } from '../types';

/**
 * Amounts in several currencies, shown side by side and never combined
 * (ADR-004). MUT-87: the Expenses Needs attention total.
 */
export interface CurrencyAmount {
  currency: Currency;
  amountMinor: number;
}

/**
 * Display position of each currency. A `Record` over `Currency`, so adding a
 * currency without placing it fails to compile. Same order as Owed now.
 */
const DISPLAY_POSITION = { USD: 0, ILS: 1, EUR: 2 } satisfies Record<Currency, number>;

const CURRENCIES_IN_ORDER = (Object.keys(DISPLAY_POSITION) as Currency[]).sort(
  (a, b) => DISPLAY_POSITION[a] - DISPLAY_POSITION[b]
);

/** One entry per non-zero currency, in USD → ILS → EUR order. */
export function orderCurrencyAmounts(totals: Partial<Record<Currency, number>>): CurrencyAmount[] {
  return CURRENCIES_IN_ORDER.flatMap((currency) => {
    const amountMinor = totals[currency] ?? 0;
    return amountMinor === 0 ? [] : [{ currency, amountMinor }];
  });
}
