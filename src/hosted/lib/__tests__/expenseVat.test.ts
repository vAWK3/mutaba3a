import { describe, expect, it } from 'vitest';
import CASES from '../../../../server/src/__tests__/fixtures/expense-vat-cases.json';
import { basisPointsToPercent, percentToBasisPoints, vatPreview } from '../expenseVat';

/**
 * MUT-302 (ADR-231): the portal's display-only preview of the split the server computes. It may not import server
 * code, so it is held to the server by the shared case table.
 */
const decimal = (minor: string, exponent: number) => {
  const digits = minor.padStart(exponent + 1, '0');
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
};

describe('vatPreview against the shared case table', () => {
  it.each(CASES.map((c) => [`${c.amountMinor} @ ${c.treatment} ${c.rateBasisPoints}`, c] as const))('%s', (_label, c) => {
    const currency = c.currencyExponent === 3 ? 'JOD' : 'ILS';
    expect(vatPreview(decimal(c.amountMinor, c.currencyExponent), currency, c.treatment as 'STANDARD_RATED', c.rateBasisPoints)).toEqual({
      net: decimal(c.netMinor, c.currencyExponent),
      vat: decimal(c.vatMinor, c.currencyExponent),
    });
  });
});

describe('vatPreview', () => {
  it('reads Arabic-Indic digits and grouped thousands', () => {
    expect(vatPreview('١١٧٫٠٠', 'ILS', 'STANDARD_RATED', 1700)).toEqual({ net: '100.00', vat: '17.00' });
    expect(vatPreview('1,170.00', 'ILS', 'STANDARD_RATED', 1700)).toEqual({ net: '1000.00', vat: '170.00' });
  });

  it('shows nothing for an amount it cannot read, a zero amount, or a standard rate it cannot use', () => {
    expect(vatPreview('', 'ILS', 'STANDARD_RATED', 1700)).toBeNull();
    expect(vatPreview('abc', 'ILS', 'STANDARD_RATED', 1700)).toBeNull();
    expect(vatPreview('1.234', 'ILS', 'STANDARD_RATED', 1700)).toBeNull();
    expect(vatPreview('0.00', 'ILS', 'STANDARD_RATED', 1700)).toBeNull();
    expect(vatPreview('117.00', 'ILS', 'STANDARD_RATED', null)).toBeNull();
    expect(vatPreview('117.00', 'ILS', 'STANDARD_RATED', 0)).toBeNull();
  });

  it('the other treatments take no VAT out', () => {
    expect(vatPreview('117.00', 'ILS', 'EXEMPT', null)).toEqual({ net: '117.00', vat: '0.00' });
  });
});

describe('percentToBasisPoints', () => {
  it.each([
    ['17', 1700],
    ['17.5', 1750],
    ['17.50', 1750],
    ['0.01', 1],
    ['100', 10000],
    ['١٧٫٥', 1750],
    [' 18 ', 1800],
    ['18%', 1800],
  ])('reads %j as %i', (text, bp) => {
    expect(percentToBasisPoints(text)).toBe(bp);
  });

  it.each(['', '0', '0.00', '100.01', '101', '17.555', 'abc', '-5', '1e2', '17,5'])('refuses %j', (text) => {
    expect(percentToBasisPoints(text)).toBeNull();
  });
});

describe('basisPointsToPercent', () => {
  it.each([
    [1700, '17'],
    [1750, '17.5'],
    [1, '0.01'],
    [10000, '100'],
    [1605, '16.05'],
  ])('writes %i as %j', (bp, text) => {
    expect(basisPointsToPercent(bp)).toBe(text);
  });
});
