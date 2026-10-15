import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  currencyExponent,
  formatMoney,
  isSupportedCurrency,
  MAX_AMOUNT_MINOR,
  MoneyParseError,
  parseMoney,
  subtractMoney,
} from '../money.js';

describe('parseMoney', () => {
  it('parses whole and fractional canonical strings into minor units', () => {
    expect(parseMoney('10000', 'ILS').minor).toBe(1_000_000n);
    expect(parseMoney('10000.5', 'ILS').minor).toBe(1_000_050n);
    expect(parseMoney('10000.50', 'USD').minor).toBe(1_000_050n);
    expect(parseMoney('0.01', 'EUR').minor).toBe(1n);
  });

  it('parses JOD at 3 fractional digits (fils) — the one 3-decimal currency here', () => {
    expect(parseMoney('10000.123', 'JOD').minor).toBe(10_000_123n);
    expect(parseMoney('0.001', 'JOD').minor).toBe(1n);
  });

  it('rejects a 4th fractional digit for JOD same as it rejects a 3rd for 2-decimal currencies', () => {
    expect(() => parseMoney('1.0005', 'JOD')).toThrow(MoneyParseError);
  });

  it('parses negative amounts (supplements can be negative, plan §3.4)', () => {
    expect(parseMoney('-3000.00', 'ILS').minor).toBe(-300_000n);
  });

  it('rejects more fractional digits than the currency carries', () => {
    expect(() => parseMoney('1.005', 'ILS')).toThrow(MoneyParseError);
  });

  it('rejects locale separators, exponents, whitespace and symbols', () => {
    for (const bad of ['1,000', '1 000', '1e3', ' 10', '10 ', '₪10', '10.', '.5', '+5']) {
      expect(() => parseMoney(bad, 'ILS'), bad).toThrow(MoneyParseError);
    }
  });

  it('never loses precision on large values', () => {
    expect(formatMoney({ minor: 12345678901234567899n, currency: 'USD' })).toBe('123456789012345678.99');
    expect(formatMoney(parseMoney('9999999999999.99', 'USD'))).toBe('9999999999999.99');
  });

  it('accepts the largest amount, 999,999,999,999,999 minor units, either sign (MUT-126)', () => {
    expect(parseMoney('9999999999999.99', 'USD').minor).toBe(MAX_AMOUNT_MINOR);
    expect(parseMoney('-9999999999999.99', 'ILS').minor).toBe(-MAX_AMOUNT_MINOR);
    expect(parseMoney('999999999999.999', 'JOD').minor).toBe(MAX_AMOUNT_MINOR);
  });

  it('refuses an amount above the bound, so it never reaches a BIGINT column (MUT-126)', () => {
    expect(() => parseMoney('10000000000000.00', 'USD')).toThrow(MoneyParseError);
    expect(() => parseMoney('-10000000000000.00', 'USD')).toThrow(MoneyParseError);
    expect(() => parseMoney('1000000000000.000', 'JOD')).toThrow(MoneyParseError);
    expect(() => parseMoney('99999999999999999999.00', 'ILS')).toThrow(/largest amount/);
  });
});

describe('formatMoney', () => {
  it('always emits the currency exponent', () => {
    expect(formatMoney({ minor: 5n, currency: 'ILS' })).toBe('0.05');
    expect(formatMoney({ minor: 0n, currency: 'ILS' })).toBe('0.00');
    expect(formatMoney({ minor: -300_000n, currency: 'ILS' })).toBe('-3000.00');
  });

  it('round-trips with parseMoney', () => {
    for (const s of ['0.00', '1.00', '99.99', '-0.01', '1000000.00']) {
      expect(formatMoney(parseMoney(s, 'EUR'))).toBe(s);
    }
  });

  it('round-trips JOD at 3 decimals', () => {
    for (const s of ['0.000', '1.000', '99.999', '-0.001', '1000000.000']) {
      expect(formatMoney(parseMoney(s, 'JOD'))).toBe(s);
    }
  });
});

describe('currency support', () => {
  it('recognizes JOD as supported, at a 3-decimal exponent', () => {
    expect(isSupportedCurrency('JOD')).toBe(true);
    expect(currencyExponent('JOD')).toBe(3);
  });

  it('existing currencies stay at a 2-decimal exponent', () => {
    expect(currencyExponent('ILS')).toBe(2);
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and compares in the same currency', () => {
    const a = parseMoney('4000.00', 'ILS');
    const b = parseMoney('3000.00', 'ILS');
    expect(formatMoney(addMoney(a, b))).toBe('7000.00');
    expect(formatMoney(subtractMoney(a, b))).toBe('1000.00');
    expect(compareMoney(a, b)).toBe(1);
    expect(compareMoney(b, a)).toBe(-1);
    expect(compareMoney(a, a)).toBe(0);
  });

  it('refuses to combine currencies (ADR-004 — never sum across currencies)', () => {
    expect(() => addMoney(parseMoney('1', 'ILS'), parseMoney('1', 'USD'))).toThrow(MoneyParseError);
  });
});
