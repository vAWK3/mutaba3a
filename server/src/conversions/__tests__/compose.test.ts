import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import type { ConversionRecord } from '../../repositories/ports.js';
import { assertDifferentCurrencies, conversionDate, conversionPatch, parseConversionAmount } from '../compose.js';

describe('conversionDate', () => {
  it('accepts a valid ISO date', () => {
    expect(conversionDate('2026-10-05')).toBe('2026-10-05');
  });

  it('rejects a malformed date', () => {
    expect(() => conversionDate('2026-13-40')).toThrow(ApiError);
  });
});

describe('parseConversionAmount', () => {
  it('parses a positive amount in the currency\'s digits', () => {
    expect(parseConversionAmount('12.34', 'ILS', 'amount')).toBe(1234n);
  });

  it('respects JOD\'s 3-decimal precision', () => {
    expect(parseConversionAmount('12.345', 'JOD', 'toAmount')).toBe(12345n);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-5'],
  ])('rejects a non-positive amount (%s)', (_label, text) => {
    try {
      parseConversionAmount(text, 'USD', 'amount');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('VALIDATION_FAILED');
      expect((err as ApiError).details).toMatchObject({ field: 'amount' });
    }
  });

  it('reports the destination leg on its own field name', () => {
    try {
      parseConversionAmount('0', 'USD', 'toAmount');
      expect.unreachable();
    } catch (err) {
      expect((err as ApiError).details).toMatchObject({ field: 'toAmount' });
    }
  });

  it('rejects a wrong-precision amount for the given currency', () => {
    try {
      parseConversionAmount('12.345', 'USD', 'amount');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('assertDifferentCurrencies', () => {
  it('accepts two different currencies', () => {
    expect(() => assertDifferentCurrencies('USD', 'ILS')).not.toThrow();
  });

  it('rejects the same currency on both legs, on the toCurrency field', () => {
    try {
      assertDifferentCurrencies('USD', 'USD');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('VALIDATION_FAILED');
      expect((err as ApiError).details).toMatchObject({ reason: 'SAME_CURRENCY', field: 'toCurrency' });
    }
  });
});

describe('conversionPatch (MUT-194)', () => {
  const row = (over: Partial<ConversionRecord> = {}): ConversionRecord => ({
    id: 'c1',
    organizationId: 'o1',
    occurredOn: '2026-10-05',
    amountMinor: 10_000n,
    currency: 'USD',
    toAmountMinor: 36_500n,
    toCurrency: 'ILS',
    notes: 'first',
    createdByUserId: 'u1',
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...over,
  });

  function refusal(fn: () => unknown): Record<string, unknown> {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('VALIDATION_FAILED');
      return (err as ApiError).details as Record<string, unknown>;
    }
    return expect.unreachable();
  }

  it('carries only the fields sent', () => {
    expect(conversionPatch(row(), {})).toEqual({});
    expect(conversionPatch(row(), { notes: 'second' })).toEqual({ notes: 'second' });
    expect(conversionPatch(row(), { occurredOn: '2026-10-01' })).toEqual({ occurredOn: '2026-10-01' });
  });

  it('notes: null clears the notes', () => {
    expect(conversionPatch(row(), { notes: null })).toEqual({ notes: null });
  });

  it('refuses a currency without its amount, on the amount field', () => {
    expect(refusal(() => conversionPatch(row(), { currency: 'EUR' }))).toMatchObject({ reason: 'AMOUNT_REQUIRED', field: 'amount' });
  });

  it('refuses a toCurrency without its toAmount, on the toAmount field (G1)', () => {
    expect(refusal(() => conversionPatch(row(), { toCurrency: 'EUR' }))).toMatchObject({ reason: 'AMOUNT_REQUIRED', field: 'toAmount' });
  });

  it('parses an amount-only patch in the row\'s own currency: 3 digits on a JOD leg (G1)', () => {
    const jod = row({ currency: 'JOD', amountMinor: 100_000n });
    expect(conversionPatch(jod, { amount: '12.345' })).toEqual({ amountMinor: 12_345n });
    // Scaled by JOD's 3 digits, not USD's 2: '1.5' is 1500 fils.
    expect(conversionPatch(jod, { amount: '1.5' })).toEqual({ amountMinor: 1_500n });
    expect(refusal(() => conversionPatch(jod, { amount: '12.3456' }))).toMatchObject({ reason: 'AMOUNT_INVALID', field: 'amount' });
    const jodTo = row({ toCurrency: 'JOD', toAmountMinor: 70_900n });
    expect(conversionPatch(jodTo, { toAmount: '70.950' })).toEqual({ toAmountMinor: 70_950n });
  });

  it('re-parses an amount in the new currency\'s digits when the currency changes (USD → JOD)', () => {
    expect(conversionPatch(row(), { amount: '70.900', currency: 'JOD' })).toEqual({ amountMinor: 70_900n, currency: 'JOD' });
    expect(conversionPatch(row(), { amount: '70.9', currency: 'JOD' })).toEqual({ amountMinor: 70_900n, currency: 'JOD' });
    // The row's USD would refuse a third digit: the new currency decides.
    expect(refusal(() => conversionPatch(row(), { amount: '70.900' }))).toMatchObject({ reason: 'AMOUNT_INVALID', field: 'amount' });
  });

  it('refuses a merged same-currency pair', () => {
    expect(refusal(() => conversionPatch(row(), { amount: '1.00', currency: 'ILS', toAmount: '1.00', toCurrency: 'ILS' }))).toMatchObject({ reason: 'SAME_CURRENCY', field: 'toCurrency' });
  });

  it('refuses a lone toCurrency change that collides with the row\'s currency', () => {
    expect(refusal(() => conversionPatch(row(), { toAmount: '100.00', toCurrency: 'USD' }))).toMatchObject({ reason: 'SAME_CURRENCY', field: 'toCurrency' });
  });

  it('accepts swapping both legs', () => {
    expect(conversionPatch(row(), { amount: '365.00', currency: 'ILS', toAmount: '100.00', toCurrency: 'USD' })).toEqual({ amountMinor: 36_500n, currency: 'ILS', toAmountMinor: 10_000n, toCurrency: 'USD' });
  });

  it('refuses a malformed occurredOn and a non-positive amount', () => {
    expect(refusal(() => conversionPatch(row(), { occurredOn: '2026-02-30' }))).toMatchObject({ reason: 'DATE_INVALID', field: 'occurredOn' });
    expect(refusal(() => conversionPatch(row(), { toAmount: '0.00' }))).toMatchObject({ reason: 'AMOUNT_INVALID', field: 'toAmount' });
  });
});
