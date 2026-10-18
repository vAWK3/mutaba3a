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
