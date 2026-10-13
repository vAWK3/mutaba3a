import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { assertDifferentCurrencies, conversionDate, parseConversionAmount } from '../compose.js';

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
