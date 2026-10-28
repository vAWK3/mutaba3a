import { describe, expect, it } from 'vitest';
import { computeVat, type PricingBasis, type VatTreatment } from '../../vat.js';
import { amountForGrossAtLeast, planReduction, type OpenReceivable, type ReductionInput, type UnbilledInstallment } from '../reduce.js';

// Minor units are agorot. 1800 bp = 18 %.
const RATE = 1800;

function unbilled(id: string, position: number, amountMinor: bigint, opts: { basis?: PricingBasis; treatment?: VatTreatment; rate?: number } = {}): UnbilledInstallment {
  const treatment = opts.treatment ?? 'STANDARD_RATED';
  const vat = computeVat({ amountMinor, pricingBasis: opts.basis ?? 'VAT_INCLUSIVE', treatment, rateBasisPoints: opts.rate ?? RATE });
  return { id, position, amountMinor, netMinor: vat.netMinor, vatMinor: vat.vatMinor, grossMinor: vat.grossMinor, vatTreatment: treatment };
}

function open(id: string, postingDate: string, position: number, outstandingMinor: bigint, treatment: VatTreatment = 'STANDARD_RATED'): OpenReceivable {
  return { id, postingDate, position, outstandingMinor, vatTreatment: treatment, rateBasisPoints: treatment === 'STANDARD_RATED' ? RATE : 0 };
}

const base = (over: Partial<ReductionInput>): ReductionInput => ({ byGrossMinor: 0n, pricingBasis: 'VAT_INCLUSIVE', rateBasisPoints: RATE, unbilled: [], openReceivables: [], hasPosted: true, ...over });

describe('amountForGrossAtLeast (the gross-to-pricing-basis inverse)', () => {
  it('VAT-inclusive and non-standard treatments are the identity', () => {
    expect(amountForGrossAtLeast(11_800n, 'VAT_INCLUSIVE', 'STANDARD_RATED', RATE)).toBe(11_800n);
    expect(amountForGrossAtLeast(999n, 'VAT_EXCLUSIVE', 'ZERO_RATED', RATE)).toBe(999n);
    expect(amountForGrossAtLeast(999n, 'VAT_EXCLUSIVE', 'EXEMPT', RATE)).toBe(999n);
  });

  it('VAT-exclusive: the smallest net whose gross is at least the target, for every gross 1..20000 at 17 % and 18 %', () => {
    for (const rate of [1700, 1800]) {
      for (let target = 1n; target <= 20_000n; target += 1n) {
        const net = amountForGrossAtLeast(target, 'VAT_EXCLUSIVE', 'STANDARD_RATED', rate);
        const gross = (n: bigint) => computeVat({ amountMinor: n, pricingBasis: 'VAT_EXCLUSIVE', treatment: 'STANDARD_RATED', rateBasisPoints: rate }).grossMinor;
        expect(gross(net) >= target).toBe(true);
        expect(gross(net - 1n) < target).toBe(true);
        // Never more than one minor unit above the target: gross steps by 1 or 2 per net unit.
        expect(gross(net) - target <= 1n).toBe(true);
      }
    }
  });
});

describe('planReduction: unbilled first (AC1)', () => {
  const three = [unbilled('i1', 1, 100_000n), unbilled('i2', 2, 100_000n), unbilled('i3', 3, 100_000n)];

  it('below the unbilled amount, the latest installment is lowered and nothing is credited', () => {
    const plan = planReduction(base({ byGrossMinor: 30_000n, unbilled: three, openReceivables: [open('r0', '2026-10-01', 0, 50_000n)] }));
    expect(plan).toMatchObject({ ok: true, voids: [], credits: [], appliedMinor: 30_000n, roundedByMinor: 0n });
    if (!plan.ok) throw new Error('refused');
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ id: 'i3', amountMinor: 70_000n, grossMinor: 70_000n });
  });

  it('lands exactly on an installment boundary: the latest is voided, no partial change', () => {
    const plan = planReduction(base({ byGrossMinor: 100_000n, unbilled: three }));
    expect(plan).toMatchObject({ ok: true, voids: ['i3'], changes: [], credits: [], appliedMinor: 100_000n });
  });

  it('spans installments latest first: one voided, the next one partly lowered', () => {
    const plan = planReduction(base({ byGrossMinor: 150_000n, unbilled: three }));
    if (!plan.ok) throw new Error('refused');
    expect(plan.voids).toEqual(['i3']);
    expect(plan.changes.map((c) => [c.id, c.grossMinor])).toEqual([['i2', 50_000n]]);
  });

  it('keeps VAT per installment: a zero-rated installment changes gross = net, a standard one splits VAT', () => {
    const mixed = [unbilled('std', 1, 118_000n), unbilled('zero', 2, 50_000n, { treatment: 'ZERO_RATED' })];
    const plan = planReduction(base({ byGrossMinor: 60_000n, unbilled: mixed }));
    if (!plan.ok) throw new Error('refused');
    expect(plan.voids).toEqual(['zero']);
    expect(plan.changes).toEqual([{ id: 'std', amountMinor: 108_000n, netMinor: 91_525n, vatMinor: 16_475n, grossMinor: 108_000n }]);
  });
});

describe('planReduction: the VAT-exclusive rounding gap (D5, O1)', () => {
  it('lowers to the smallest reachable gross at or above the target and reports roundedBy, never a credit', () => {
    // At 18 % VAT on top, nets 999.97 / 999.98 / 999.99 / 1,000.00 give gross 1,179.96 / 1,179.98 / 1,179.99 / 1,180.00:
    // gross 1,179.97 can't be reached. Lowering 1,180.00 by 0.03 lands on 1,179.98: taken off 0.02, rounded by 0.01.
    const plan = planReduction(base({ byGrossMinor: 3n, pricingBasis: 'VAT_EXCLUSIVE', unbilled: [unbilled('i1', 1, 100_000n, { basis: 'VAT_EXCLUSIVE' })], openReceivables: [open('r0', '2026-10-01', 0, 10_000n)] }));
    expect(plan).toMatchObject({ ok: true, credits: [], appliedMinor: 2n, roundedByMinor: 1n });
    if (!plan.ok) throw new Error('refused');
    expect(plan.changes[0]).toMatchObject({ id: 'i1', netMinor: 99_998n, grossMinor: 117_998n });
  });

  it('a reduction too small to move any gross applies 0 and is refused AMOUNT_INVALID', () => {
    // Net 999.98 → gross 1,179.98; one net agora less is 1,179.96, so lowering by 0.01 rounds back to 1,179.98.
    const plan = planReduction(base({ byGrossMinor: 1n, pricingBasis: 'VAT_EXCLUSIVE', unbilled: [unbilled('i1', 1, 99_998n, { basis: 'VAT_EXCLUSIVE' })] }));
    expect(plan).toEqual({ ok: false, reason: 'AMOUNT_INVALID' });
  });

  it('VAT-inclusive is always exact', () => {
    const plan = planReduction(base({ byGrossMinor: 1n, unbilled: [unbilled('i1', 1, 118_000n)] }));
    expect(plan).toMatchObject({ ok: true, appliedMinor: 1n, roundedByMinor: 0n });
  });
});

describe('planReduction: then credits (AC2)', () => {
  it('voids every unbilled installment and credits the rest, latest posted first', () => {
    const plan = planReduction(
      base({
        byGrossMinor: 180_000n,
        unbilled: [unbilled('i2', 2, 50_000n), unbilled('i3', 3, 50_000n)],
        openReceivables: [open('rOld', '2026-08-01', 0, 100_000n), open('rNew', '2026-09-01', 1, 60_000n)],
      }),
    );
    if (!plan.ok) throw new Error('refused');
    expect(plan.voids.sort()).toEqual(['i2', 'i3']);
    expect(plan.changes).toEqual([]);
    expect(plan.credits).toEqual([
      { receivableId: 'rNew', amountMinor: 60_000n, netMinor: 50_847n, vatMinor: 9_153n },
      { receivableId: 'rOld', amountMinor: 20_000n, netMinor: 16_949n, vatMinor: 3_051n },
    ]);
    expect(plan).toMatchObject({ appliedMinor: 180_000n, roundedByMinor: 0n });
  });

  it('nothing unbilled: everything is a credit, split at each receivable’s own treatment', () => {
    const plan = planReduction(base({ byGrossMinor: 30_000n, openReceivables: [open('rExempt', '2026-09-01', 2, 20_000n, 'EXEMPT'), open('rStd', '2026-09-01', 1, 50_000n)] }));
    if (!plan.ok) throw new Error('refused');
    expect(plan.credits).toEqual([
      { receivableId: 'rExempt', amountMinor: 20_000n, netMinor: 20_000n, vatMinor: 0n },
      { receivableId: 'rStd', amountMinor: 10_000n, netMinor: 8_475n, vatMinor: 1_525n },
    ]);
  });

  it('same posting date: the later position goes first', () => {
    const plan = planReduction(base({ byGrossMinor: 1_000n, openReceivables: [open('a', '2026-09-01', 1, 5_000n), open('b', '2026-09-01', 2, 5_000n)] }));
    if (!plan.ok) throw new Error('refused');
    expect(plan.credits.map((c) => c.receivableId)).toEqual(['b']);
  });
});

describe('planReduction: refusals', () => {
  it('zero or negative is AMOUNT_INVALID', () => {
    expect(planReduction(base({ byGrossMinor: 0n, unbilled: [unbilled('i1', 1, 100n)] }))).toEqual({ ok: false, reason: 'AMOUNT_INVALID' });
    expect(planReduction(base({ byGrossMinor: -5n, unbilled: [unbilled('i1', 1, 100n)] }))).toEqual({ ok: false, reason: 'AMOUNT_INVALID' });
  });

  it('more than unbilled + outstanding is REDUCTION_EXCEEDS_OPEN with the figures (AC3)', () => {
    const plan = planReduction(base({ byGrossMinor: 160_001n, unbilled: [unbilled('i2', 2, 100_000n)], openReceivables: [open('r1', '2026-09-01', 1, 60_000n)] }));
    expect(plan).toEqual({ ok: false, reason: 'REDUCTION_EXCEEDS_OPEN', unbilledMinor: 100_000n, outstandingMinor: 60_000n, maximumMinor: 160_000n });
  });

  it('nothing posted and every installment would be voided: USE_CANCEL (D4)', () => {
    const plan = planReduction(base({ hasPosted: false, byGrossMinor: 200_000n, unbilled: [unbilled('i1', 1, 100_000n), unbilled('i2', 2, 100_000n)] }));
    expect(plan).toEqual({ ok: false, reason: 'USE_CANCEL' });
  });

  it('nothing posted, more than unbilled: the maximum is unbilled minus one minor unit (O-F9)', () => {
    const plan = planReduction(base({ hasPosted: false, byGrossMinor: 200_001n, unbilled: [unbilled('i1', 1, 100_000n), unbilled('i2', 2, 100_000n)] }));
    expect(plan).toEqual({ ok: false, reason: 'REDUCTION_EXCEEDS_OPEN', unbilledMinor: 200_000n, outstandingMinor: 0n, maximumMinor: 199_999n });
  });

  it('something posted (even settled): voiding every unbilled installment is allowed', () => {
    const plan = planReduction(base({ hasPosted: true, byGrossMinor: 200_000n, unbilled: [unbilled('i1', 1, 100_000n), unbilled('i2', 2, 100_000n)] }));
    expect(plan).toMatchObject({ ok: true, credits: [], appliedMinor: 200_000n });
  });
});
