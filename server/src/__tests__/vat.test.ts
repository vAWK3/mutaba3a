import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from '../money.js';
import { computeVat, roundHalfUpDiv, assertRateBasisPoints } from '../vat.js';

const ils = (s: string) => parseMoney(s, 'ILS').minor;
const fmt = (n: bigint) => formatMoney({ minor: n, currency: 'ILS' });

describe('roundHalfUpDiv', () => {
  it('rounds half up on minor units, symmetrically for negatives', () => {
    expect(roundHalfUpDiv(5n, 10n)).toBe(1n);
    expect(roundHalfUpDiv(4n, 10n)).toBe(0n);
    expect(roundHalfUpDiv(15n, 10n)).toBe(2n);
    expect(roundHalfUpDiv(-5n, 10n)).toBe(-1n);
    expect(roundHalfUpDiv(-4n, 10n)).toBe(0n);
    expect(roundHalfUpDiv(-15n, 10n)).toBe(-2n);
    expect(() => roundHalfUpDiv(1n, 0n)).toThrow();
  });
});

describe('computeVat', () => {
  it.each([
    // amount, basis, treatment, rate, net, vat, gross
    ['1000.00', 'VAT_EXCLUSIVE', 'STANDARD_RATED', 1800, '1000.00', '180.00', '1180.00'],
    ['1180.00', 'VAT_INCLUSIVE', 'STANDARD_RATED', 1800, '1000.00', '180.00', '1180.00'],
    ['100.00', 'VAT_INCLUSIVE', 'STANDARD_RATED', 1800, '84.75', '15.25', '100.00'],
    ['0.01', 'VAT_INCLUSIVE', 'STANDARD_RATED', 1800, '0.01', '0.00', '0.01'],
    ['0.01', 'VAT_EXCLUSIVE', 'STANDARD_RATED', 1800, '0.01', '0.00', '0.01'],
    ['1234.56', 'VAT_EXCLUSIVE', 'STANDARD_RATED', 1700, '1234.56', '209.88', '1444.44'],
    ['1234.56', 'VAT_EXCLUSIVE', 'STANDARD_RATED', 1600, '1234.56', '197.53', '1432.09'],
    ['1234.56', 'VAT_INCLUSIVE', 'STANDARD_RATED', 1600, '1064.28', '170.28', '1234.56'],
    ['1000.00', 'VAT_EXCLUSIVE', 'ZERO_RATED', 1800, '1000.00', '0.00', '1000.00'],
    ['1000.00', 'VAT_INCLUSIVE', 'EXEMPT', 1800, '1000.00', '0.00', '1000.00'],
    ['1000.00', 'VAT_INCLUSIVE', 'OUT_OF_SCOPE', 1800, '1000.00', '0.00', '1000.00'],
    ['1000.00', 'VAT_EXCLUSIVE', 'STANDARD_RATED', 0, '1000.00', '0.00', '1000.00'],
    ['1000.00', 'VAT_EXCLUSIVE', 'STANDARD_RATED', 10000, '1000.00', '1000.00', '2000.00'],
    ['-500.00', 'VAT_EXCLUSIVE', 'STANDARD_RATED', 1800, '-500.00', '-90.00', '-590.00'],
    ['-100.00', 'VAT_INCLUSIVE', 'STANDARD_RATED', 1800, '-84.75', '-15.25', '-100.00'],
  ] as const)('%s %s %s @%ibp → net %s vat %s gross %s', (amount, basis, treatment, rate, net, vat, gross) => {
    const r = computeVat({ amountMinor: ils(amount), pricingBasis: basis, treatment, rateBasisPoints: rate });
    expect(fmt(r.netMinor)).toBe(net);
    expect(fmt(r.vatMinor)).toBe(vat);
    expect(fmt(r.grossMinor)).toBe(gross);
    expect(r.netMinor + r.vatMinor).toBe(r.grossMinor);
    expect(r.rateBasisPoints).toBe(treatment === 'STANDARD_RATED' ? rate : 0);
  });

  it('rejects rates outside 0–10000 basis points or non-integers', () => {
    expect(() => assertRateBasisPoints(-1)).toThrow();
    expect(() => assertRateBasisPoints(10001)).toThrow();
    expect(() => assertRateBasisPoints(17.5)).toThrow();
    expect(() => assertRateBasisPoints(1800)).not.toThrow();
  });
});
