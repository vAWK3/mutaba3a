import { describe, expect, it } from 'vitest';
import { addMoney, compareMoney, formatMoney, MoneyParseError, parseMoney, subtractMoney } from '../money.js';

describe('parseMoney', () => {
  it('parses whole and fractional canonical strings into minor units', () => {
    expect(parseMoney('10000', 'ILS').minor).toBe(1_000_000n);
    expect(parseMoney('10000.5', 'ILS').minor).toBe(1_000_050n);
    expect(parseMoney('10000.50', 'USD').minor).toBe(1_000_050n);
    expect(parseMoney('0.01', 'EUR').minor).toBe(1n);
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
    const big = '123456789012345678.99';
    expect(formatMoney(parseMoney(big, 'USD'))).toBe(big);
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
