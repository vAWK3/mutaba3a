import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from '../../money.js';
import { MAX_INSTALLMENTS, splitInstallments, type InstallmentSpec } from '../schedule.js';

const ils = (s: string) => parseMoney(s, 'ILS').minor;
const fmt = (n: bigint) => formatMoney({ minor: n, currency: 'ILS' });
const immediate = { type: 'IMMEDIATE' as const };

function split(amount: string, installments: InstallmentSpec[], opts: Partial<Parameters<typeof splitInstallments>[0]> = {}) {
  return splitInstallments({ amountMinor: ils(amount), pricingBasis: 'VAT_EXCLUSIVE', defaultTreatment: 'STANDARD_RATED', rateBasisPoints: 1800, installments, ...opts });
}

describe('splitInstallments', () => {
  it('accepts amounts that sum exactly and computes VAT per installment', () => {
    const r = split('1000.00', [
      { label: 'A', amount: ils('333.33'), trigger: immediate },
      { label: 'B', amount: ils('333.33'), trigger: immediate },
      { label: 'C', amount: ils('333.34'), trigger: immediate },
    ]);
    if (!r.ok) throw new Error(r.error.reason);
    expect(r.items.map((i) => fmt(i.amountMinor))).toEqual(['333.33', '333.33', '333.34']);
    expect(r.items.map((i) => fmt(i.vatMinor))).toEqual(['60.00', '60.00', '60.00']);
    expect(r.items.map((i) => fmt(i.grossMinor))).toEqual(['393.33', '393.33', '393.34']);
    expect(fmt(r.totals.netMinor)).toBe('1000.00');
    expect(fmt(r.totals.vatMinor)).toBe('180.00');
    expect(fmt(r.totals.grossMinor)).toBe('1180.00');
    expect(r.items.map((i) => i.position)).toEqual([1, 2, 3]);
  });

  it('rejects amounts that do not sum, naming the difference', () => {
    const r = split('1000.00', [
      { label: 'A', amount: ils('333.33'), trigger: immediate },
      { label: 'B', amount: ils('333.33'), trigger: immediate },
      { label: 'C', amount: ils('333.33'), trigger: immediate },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({ reason: 'INSTALLMENTS_DO_NOT_SUM', differenceMinor: 1n });
  });

  it('splits percents with the last installment absorbing the remainder', () => {
    const r = split('1000.00', [
      { label: 'A', percentBasisPoints: 3333, trigger: immediate },
      { label: 'B', percentBasisPoints: 3333, trigger: immediate },
      { label: 'C', percentBasisPoints: 3334, trigger: immediate },
    ]);
    if (!r.ok) throw new Error(r.error.reason);
    expect(r.items.map((i) => fmt(i.amountMinor))).toEqual(['333.30', '333.30', '333.40']);
    const r2 = split('0.03', [
      { label: 'A', percentBasisPoints: 5000, trigger: immediate },
      { label: 'B', percentBasisPoints: 5000, trigger: immediate },
    ]);
    if (!r2.ok) throw new Error(r2.error.reason);
    expect(r2.items.map((i) => fmt(i.amountMinor))).toEqual(['0.02', '0.01']);
  });

  it('rejects percents that do not sum to 100 %, mixed bases, empty, too many, and non-positive results', () => {
    expect(split('100.00', [{ label: 'A', percentBasisPoints: 9999, trigger: immediate }])).toMatchObject({ ok: false, error: { reason: 'PERCENTS_DO_NOT_SUM', totalBasisPoints: 9999 } });
    expect(split('100.00', [{ label: 'A', amount: ils('50.00'), trigger: immediate }, { label: 'B', percentBasisPoints: 5000, trigger: immediate }])).toMatchObject({ ok: false, error: { reason: 'MIXED_INSTALLMENT_BASIS' } });
    expect(split('100.00', [])).toMatchObject({ ok: false, error: { reason: 'NO_INSTALLMENTS' } });
    const many = Array.from({ length: MAX_INSTALLMENTS + 1 }, (_, i) => ({ label: `I${i}`, percentBasisPoints: 0, trigger: immediate }));
    expect(split('100.00', many)).toMatchObject({ ok: false, error: { reason: 'TOO_MANY_INSTALLMENTS' } });
    expect(split('0.01', [{ label: 'A', percentBasisPoints: 5000, trigger: immediate }, { label: 'B', percentBasisPoints: 5000, trigger: immediate }])).toMatchObject({ ok: false, error: { reason: 'NON_POSITIVE_INSTALLMENT', position: 2 } });
    expect(split('100.00', [{ label: 'A', amount: ils('100.00'), trigger: immediate }, { label: 'B', amount: 0n, trigger: immediate }])).toMatchObject({ ok: false, error: { reason: 'NON_POSITIVE_INSTALLMENT', position: 2 } });
  });

  it('applies per-installment VAT treatment and the agreement default; totals are the sums', () => {
    const r = split(
      '1000.00',
      [
        { label: 'Local', amount: ils('600.00'), trigger: immediate },
        { label: 'Foreign', amount: ils('400.00'), vatTreatment: 'OUT_OF_SCOPE', trigger: immediate },
      ],
      { defaultTreatment: 'STANDARD_RATED' },
    );
    if (!r.ok) throw new Error(r.error.reason);
    expect(r.items.map((i) => [i.vatTreatment, fmt(i.vatMinor), i.rateBasisPoints])).toEqual([
      ['STANDARD_RATED', '108.00', 1800],
      ['OUT_OF_SCOPE', '0.00', 0],
    ]);
    expect(fmt(r.totals.vatMinor)).toBe('108.00');
    expect(fmt(r.totals.grossMinor)).toBe('1108.00');
  });

  it('inclusive basis: installments split the gross and net is extracted per installment; sums reconcile', () => {
    const specs = [7, 11, 13, 17, 19, 23, 10].map((p, i) => ({ label: `I${i}`, percentBasisPoints: p * 100, trigger: immediate }));
    const r = split('1180.00', specs, { pricingBasis: 'VAT_INCLUSIVE' });
    if (!r.ok) throw new Error(r.error.reason);
    const sumGross = r.items.reduce((a, i) => a + i.grossMinor, 0n);
    const sumNet = r.items.reduce((a, i) => a + i.netMinor, 0n);
    const sumVat = r.items.reduce((a, i) => a + i.vatMinor, 0n);
    expect(fmt(sumGross)).toBe('1180.00');
    expect(sumNet + sumVat).toBe(sumGross);
    expect(r.totals.netMinor).toBe(sumNet);
    expect(r.totals.vatMinor).toBe(sumVat);
    for (const i of r.items) expect(i.netMinor + i.vatMinor).toBe(i.grossMinor);
  });

  it('carries trigger, terms and due-date overrides through', () => {
    const r = split('100.00', [{ label: 'M', amount: ils('100.00'), trigger: { type: 'MANUAL' }, paymentTerms: 'EOM_30', dueDate: '2026-12-01' }]);
    if (!r.ok) throw new Error(r.error.reason);
    expect(r.items[0]).toMatchObject({ trigger: { type: 'MANUAL' }, paymentTerms: 'EOM_30', dueDate: '2026-12-01' });
  });
});
