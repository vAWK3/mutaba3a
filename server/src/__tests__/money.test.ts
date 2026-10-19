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
  SUPPORTED_CURRENCIES,
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

  it('supports the Gulf currencies, appended after the original four (MUT-280)', () => {
    expect([...SUPPORTED_CURRENCIES]).toEqual(['ILS', 'USD', 'EUR', 'JOD', 'AED', 'SAR', 'QAR', 'BHD', 'OMR']);
    expect(Object.fromEntries(SUPPORTED_CURRENCIES.map((c) => [c, currencyExponent(c)]))).toEqual({
      ILS: 2, USD: 2, EUR: 2, JOD: 3, AED: 2, SAR: 2, QAR: 2, BHD: 3, OMR: 3,
    });
  });

  it.each(['KWD', 'GBP', 'aed', ''])('does not support %j', (code) => {
    expect(isSupportedCurrency(code)).toBe(false);
  });
});

describe('Gulf currencies (MUT-280)', () => {
  it('parses and formats AED, SAR and QAR at 2 decimals', () => {
    expect(parseMoney('1250.50', 'AED').minor).toBe(125_050n);
    expect(formatMoney(parseMoney('0.5', 'SAR'))).toBe('0.50');
    expect(formatMoney(parseMoney('3', 'QAR'))).toBe('3.00');
  });

  it('parses and formats BHD and OMR at 3 decimals (fils, baisa)', () => {
    expect(parseMoney('12.345', 'BHD').minor).toBe(12_345n);
    expect(formatMoney(parseMoney('0.001', 'OMR'))).toBe('0.001');
  });

  it('refuses more fractional digits than each carries', () => {
    expect(() => parseMoney('1.234', 'AED')).toThrow(MoneyParseError);
    expect(() => parseMoney('12.3456', 'BHD')).toThrow(MoneyParseError);
  });

  it('caps BHD at the same minor-unit bound as JOD', () => {
    expect(parseMoney('999999999999.999', 'BHD').minor).toBe(MAX_AMOUNT_MINOR);
    expect(() => parseMoney('1000000000000.000', 'BHD')).toThrow(MoneyParseError);
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
