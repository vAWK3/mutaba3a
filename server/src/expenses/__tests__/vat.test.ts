import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ApiError } from '../../errors.js';
import { computeVat, VAT_TREATMENTS, type VatTreatment } from '../../vat.js';
import { assertExpenseVatColumns, expenseVat, NO_EXPENSE_VAT } from '../vat.js';

/** MUT-302 (ADR-231): an expense's amount is what was paid, so its VAT is always split out of the gross. */

interface VatCase {
  amountMinor: string;
  currencyExponent: number;
  treatment: VatTreatment;
  rateBasisPoints: number;
  netMinor: string;
  vatMinor: string;
}

const CASES = JSON.parse(readFileSync(new URL('../../__tests__/fixtures/expense-vat-cases.json', import.meta.url), 'utf8')) as VatCase[];

describe('the shared case table (server, portal and phone hold to it)', () => {
  it('has the edge rows the plan names', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
    expect(CASES.some((c) => c.amountMinor === '1')).toBe(true);
    expect(CASES.some((c) => c.currencyExponent === 3)).toBe(true);
    expect(CASES.some((c) => c.rateBasisPoints === 10000)).toBe(true);
    expect(new Set(CASES.map((c) => c.treatment))).toEqual(new Set(VAT_TREATMENTS));
  });

  it.each(CASES.map((c) => [`${c.amountMinor} @ ${c.treatment} ${c.rateBasisPoints}`, c] as const))('%s matches computeVat and expenseVat', (_label, c) => {
    const gross = BigInt(c.amountMinor);
    const want = computeVat({ amountMinor: gross, pricingBasis: 'VAT_INCLUSIVE', treatment: c.treatment, rateBasisPoints: c.rateBasisPoints });
    expect([String(want.netMinor), String(want.vatMinor)]).toEqual([c.netMinor, c.vatMinor]);
    const columns = expenseVat(gross, { treatment: c.treatment, rateBasisPoints: c.rateBasisPoints });
    expect(columns).toEqual({ vatTreatment: c.treatment, vatRateBasisPoints: want.rateBasisPoints, netMinor: want.netMinor, vatMinor: want.vatMinor });
  });
});

describe('expenseVat', () => {
  it('records no VAT for absent or null input, never a guessed split', () => {
    expect(expenseVat(11700n, undefined)).toEqual(NO_EXPENSE_VAT);
    expect(expenseVat(11700n, null)).toEqual(NO_EXPENSE_VAT);
    expect(NO_EXPENSE_VAT).toEqual({ vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null });
  });

  it('splits 117.00 at 17 % into 100.00 + 17.00', () => {
    expect(expenseVat(11700n, { treatment: 'STANDARD_RATED', rateBasisPoints: 1700 })).toEqual({ vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1700, netMinor: 10000n, vatMinor: 1700n });
  });

  it('adds up exactly for any gross and rate (property)', () => {
    let seed = 302;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return 1 + (seed % max);
    };
    for (let i = 0; i < 2000; i++) {
      const gross = BigInt(next(1_000_000_000));
      const rate = next(10000);
      const v = expenseVat(gross, { treatment: 'STANDARD_RATED', rateBasisPoints: rate });
      expect(v.netMinor! + v.vatMinor!).toBe(gross);
      expect(v.vatMinor).toBe(computeVat({ amountMinor: gross, pricingBasis: 'VAT_INCLUSIVE', treatment: 'STANDARD_RATED', rateBasisPoints: rate }).vatMinor);
    }
  });

  it.each(['ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'] as const)('%s stores a 0 rate and 0 VAT, whatever rate was sent', (treatment) => {
    expect(expenseVat(5000n, { treatment, rateBasisPoints: 1700 })).toEqual({ vatTreatment: treatment, vatRateBasisPoints: 0, netMinor: 5000n, vatMinor: 0n });
  });

  it.each([0, -1, 10001, 17.5])('refuses a standard rate of %s with VAT_RATE_INVALID on vat.rateBasisPoints', (rate) => {
    let err: unknown;
    try {
      expenseVat(11700n, { treatment: 'STANDARD_RATED', rateBasisPoints: rate });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VALIDATION_FAILED');
    expect((err as ApiError).details).toMatchObject({ reason: 'VAT_RATE_INVALID', field: 'vat.rateBasisPoints' });
  });
});

describe('assertExpenseVatColumns (the memory store mirrors the Postgres CHECKs)', () => {
  const ok = { amountMinor: 11700n, vatTreatment: 'STANDARD_RATED' as const, vatRateBasisPoints: 1700, netMinor: 10000n, vatMinor: 1700n };

  it('accepts a split that adds up, and a row with no VAT', () => {
    expect(() => assertExpenseVatColumns(ok)).not.toThrow();
    expect(() => assertExpenseVatColumns({ amountMinor: 5n, ...NO_EXPENSE_VAT })).not.toThrow();
  });

  it.each([
    ['all or none', { ...ok, vatMinor: null }, 'expenses_vat_all_or_none'],
    ['adds up', { ...ok, amountMinor: 11800n }, 'expenses_vat_adds_up'],
    ['zero unless standard', { ...ok, vatTreatment: 'EXEMPT' as const }, 'expenses_vat_zero_unless_standard'],
    ['standard rate in range', { ...ok, vatRateBasisPoints: 0, netMinor: 11700n, vatMinor: 0n }, 'expenses_vat_standard_rate'],
  ])('refuses a row that breaks %s', (_label, row, constraint) => {
    expect(() => assertExpenseVatColumns(row)).toThrow(constraint);
  });
});
