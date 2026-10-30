import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import type { ExpenseRecord } from '../../repositories/ports.js';
import { expensePatch } from '../compose.js';

/** MUT-272 (ADR-096): an expense's currency travels only with its amount, the way a conversion leg's does. */
const row = (over: Partial<ExpenseRecord> = {}): ExpenseRecord =>
  ({ id: 'e1', organizationId: 'o1', occurredOn: '2026-10-05', amountMinor: 12050n, currency: 'ILS', version: 1, ...over }) as ExpenseRecord;
const today = '2026-10-20';

function refusal(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err.details;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('expensePatch currency (MUT-272)', () => {
  it('refuses a currency without its amount, changed or not', () => {
    expect(refusal(() => expensePatch(row(), today, { currency: 'USD' }))).toMatchObject({ reason: 'AMOUNT_REQUIRED', field: 'amount' });
    expect(refusal(() => expensePatch(row(), today, { currency: 'ILS' }))).toMatchObject({ reason: 'AMOUNT_REQUIRED', field: 'amount' });
  });

  it('reads the amount in the new currency’s digits and sets the currency', () => {
    expect(expensePatch(row(), today, { amount: '1.234', currency: 'JOD' })).toEqual({ amountMinor: 1234n, currency: 'JOD' });
    expect(expensePatch(row({ currency: 'JOD', amountMinor: 1234n }), today, { amount: '1.23', currency: 'USD' })).toEqual({ amountMinor: 123n, currency: 'USD' });
  });

  it('refuses an amount with more digits than the new currency has', () => {
    expect(refusal(() => expensePatch(row(), today, { amount: '1.234', currency: 'USD' }))).toMatchObject({ field: 'amount' });
  });

  it('leaves the currency alone when only the amount changes, read in the row’s currency', () => {
    expect(expensePatch(row({ currency: 'JOD' }), today, { amount: '2.500' })).toEqual({ amountMinor: 2500n });
  });
});

describe('expensePatch VAT (MUT-302, D4)', () => {
  const withVat = row({ amountMinor: 11700n, vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1700, netMinor: 10000n, vatMinor: 1700n });
  const STD16 = { treatment: 'STANDARD_RATED' as const, rateBasisPoints: 1600 };

  it('absent keeps it: no VAT columns in the patch when the amount stays', () => {
    expect(expensePatch(withVat, today, { notes: 'x' })).toEqual({ notes: 'x' });
  });

  it('absent with a new amount re-splits at the row’s own rate in the same patch', () => {
    expect(expensePatch(withVat, today, { amount: '234.00' })).toEqual({ amountMinor: 23400n, vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1700, netMinor: 20000n, vatMinor: 3400n });
  });

  it('absent with a new amount on a row with no VAT (or a record without the keys) writes no VAT columns', () => {
    expect(expensePatch(row(), today, { amount: '99.00' })).toEqual({ amountMinor: 9900n });
    expect(expensePatch(row({ vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null }), today, { amount: '99.00' })).toEqual({ amountMinor: 9900n });
  });

  it('null clears all four', () => {
    expect(expensePatch(withVat, today, { vat: null })).toEqual({ vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null });
  });

  it('an object alone splits the row’s amount; with amount + currency it splits the new amount', () => {
    expect(expensePatch(row({ amountMinor: 11600n }), today, { vat: STD16 })).toEqual({ vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1600, netMinor: 10000n, vatMinor: 1600n });
    expect(expensePatch(withVat, today, { amount: '11.600', currency: 'JOD', vat: STD16 })).toEqual({ amountMinor: 11600n, currency: 'JOD', vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1600, netMinor: 10000n, vatMinor: 1600n });
  });

  it('refuses a 0 % standard rate on PATCH too', () => {
    expect(refusal(() => expensePatch(withVat, today, { vat: { treatment: 'STANDARD_RATED', rateBasisPoints: 0 } }))).toMatchObject({ reason: 'VAT_RATE_INVALID', field: 'vat.rateBasisPoints' });
  });
});
