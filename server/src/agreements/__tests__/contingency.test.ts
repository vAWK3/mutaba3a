import { describe, expect, it } from 'vitest';
import { commissionMinor, isCommissionRate, planOutcome, upfrontCountedMinor, type UpfrontLine } from '../contingency.js';

// AC figures: VAT on top, upfront ₪1,500, rate 20 % (2000 bp); minor units are agorot.
const RATE = 2000;
const UPFRONT = 150_000n;
const line = (over: Partial<UpfrontLine> = {}): UpfrontLine => ({ amountMinor: UPFRONT, isCommission: false, voidedAt: null, receivableId: null, ...over });

describe('commission rate bounds', () => {
  it('accepts integers 1..10000 and refuses 0, 10001 and fractions', () => {
    expect([1, 2000, 2050, 10000].map(isCommissionRate)).toEqual([true, true, true, true]);
    expect([0, -1, 10001, 20.5, Number.NaN].map(isCommissionRate)).toEqual([false, false, false, false, false]);
  });
});

describe('commissionMinor', () => {
  it('is the award times the rate, rounded half up to minor units', () => {
    expect(commissionMinor(10_000_000n, RATE)).toBe(2_000_000n);
    // 100.01 × 33.33 % = 33.333333 → 33.33; 0.15 × 33.33 % = 0.049995 → 0.05
    expect(commissionMinor(10_001n, 3333)).toBe(3_333n);
    expect(commissionMinor(15n, 3333)).toBe(5n);
    // 20.5 %: 100.10 × 20.5 % = 20.5205 → 20.52; 0.10 × 20.5 % = 0.0205 → 0.02; 0.30 × 20.5 % = 0.0615 → 0.06
    expect(commissionMinor(10_010n, 2050)).toBe(2_052n);
    expect(commissionMinor(10n, 2050)).toBe(2n);
    expect(commissionMinor(30n, 2050)).toBe(6n);
    // exactly half a minor unit rounds up: 0.25 × 2 % = 0.005 → 0.01
    expect(commissionMinor(25n, 200)).toBe(1n);
  });
});

describe('planOutcome', () => {
  it('SEPARATE, award ₪100,000: bills the whole ₪20,000 commission', () => {
    expect(planOutcome({ outcome: 'AWARDED', treatment: 'SEPARATE', awardedMinor: 10_000_000n, rateBasisPoints: RATE, upfrontCountedMinor: UPFRONT })).toEqual({ commissionMinor: 2_000_000n, appliedUpfrontMinor: 0n, billableMinor: 2_000_000n });
  });

  it('CREDITED, award ₪100,000: the ₪1,500 upfront counts, ₪18,500 is billed', () => {
    expect(planOutcome({ outcome: 'AWARDED', treatment: 'CREDITED', awardedMinor: 10_000_000n, rateBasisPoints: RATE, upfrontCountedMinor: UPFRONT })).toEqual({ commissionMinor: 2_000_000n, appliedUpfrontMinor: UPFRONT, billableMinor: 1_850_000n });
  });

  it('CREDITED, award ₪5,000: the ₪1,000 commission is covered by the upfront, nothing is billed and nothing refunded', () => {
    expect(planOutcome({ outcome: 'AWARDED', treatment: 'CREDITED', awardedMinor: 500_000n, rateBasisPoints: RATE, upfrontCountedMinor: UPFRONT })).toEqual({ commissionMinor: 100_000n, appliedUpfrontMinor: 100_000n, billableMinor: 0n });
  });

  it('NO_RECOVERY: zeros under either treatment', () => {
    for (const treatment of ['SEPARATE', 'CREDITED'] as const) {
      expect(planOutcome({ outcome: 'NO_RECOVERY', treatment, awardedMinor: null, rateBasisPoints: RATE, upfrontCountedMinor: UPFRONT })).toEqual({ commissionMinor: 0n, appliedUpfrontMinor: 0n, billableMinor: 0n });
    }
  });

  it('CREDITED with a ₪0 upfront bills the whole commission', () => {
    expect(planOutcome({ outcome: 'AWARDED', treatment: 'CREDITED', awardedMinor: 10_000_000n, rateBasisPoints: RATE, upfrontCountedMinor: 0n }).billableMinor).toBe(2_000_000n);
  });
});

describe('upfrontCountedMinor', () => {
  const none = new Map<string, readonly { amountMinor: bigint; netMinor: bigint }[]>();

  it('counts every live upfront installment, posted or not, paid or not', () => {
    const installments = [line({ amountMinor: 100_000n, receivableId: 'r1' }), line({ amountMinor: 50_000n })];
    expect(upfrontCountedMinor({ installments, creditsByReceivableId: none, pricingBasis: 'VAT_EXCLUSIVE' })).toBe(UPFRONT);
  });

  it('never counts a voided installment or the commission line', () => {
    const installments = [line(), line({ voidedAt: new Date(0) }), line({ isCommission: true, receivableId: 'rc' })];
    expect(upfrontCountedMinor({ installments, creditsByReceivableId: none, pricingBasis: 'VAT_EXCLUSIVE' })).toBe(UPFRONT);
  });

  it('a ₪0 upfront (no installments) counts nothing', () => {
    expect(upfrontCountedMinor({ installments: [], creditsByReceivableId: none, pricingBasis: 'VAT_EXCLUSIVE' })).toBe(0n);
  });

  it('subtracts credits in the pricing basis: stored nets when VAT is on top, stored grosses when it is included', () => {
    const credits = new Map([['r1', [{ amountMinor: 11_800n, netMinor: 10_000n }]]]);
    expect(upfrontCountedMinor({ installments: [line({ receivableId: 'r1' })], creditsByReceivableId: credits, pricingBasis: 'VAT_EXCLUSIVE' })).toBe(140_000n);
    expect(upfrontCountedMinor({ installments: [line({ receivableId: 'r1' })], creditsByReceivableId: credits, pricingBasis: 'VAT_INCLUSIVE' })).toBe(138_200n);
  });

  it('uses the stored splits, which can differ by an agora from a recomputed split of their sum (R4/D6)', () => {
    // Two 1.00 credits at 18 %: each stored net is round(100 / 1.18) = 85, so 170 in all;
    // splitting the 2.00 sum again would give round(200 / 1.18) = 169.
    const credits = new Map([['r1', [{ amountMinor: 100n, netMinor: 85n }, { amountMinor: 100n, netMinor: 85n }]]]);
    expect(upfrontCountedMinor({ installments: [line({ receivableId: 'r1' })], creditsByReceivableId: credits, pricingBasis: 'VAT_EXCLUSIVE' })).toBe(UPFRONT - 170n);
  });

  it('ignores credits on receivables that are not upfront lines, and never goes below zero', () => {
    const credits = new Map([
      ['rc', [{ amountMinor: 999_999n, netMinor: 999_999n }]],
      ['r1', [{ amountMinor: 999_999n, netMinor: 999_999n }]],
    ]);
    const installments = [line({ receivableId: 'r1' }), line({ isCommission: true, receivableId: 'rc' })];
    expect(upfrontCountedMinor({ installments, creditsByReceivableId: credits, pricingBasis: 'VAT_EXCLUSIVE' })).toBe(0n);
  });
});
