import { describe, expect, it } from 'vitest';
import type { AgreementRecord, RetainerVersionRecord } from '../../repositories/ports.js';
import { applyChange, chargesKept, diffTerms, termsFor, termsTimeline, validateChange } from '../terms.js';

const agreement = (over: Partial<AgreementRecord> = {}): AgreementRecord => ({
  id: 'a1',
  organizationId: 'o1',
  projectId: 'p1',
  customerId: 'c1',
  type: 'RECURRING',
  status: 'ACTIVE',
  currency: 'ILS',
  pricingBasis: 'VAT_EXCLUSIVE',
  vatTreatment: 'STANDARD_RATED',
  vatRateBasisPoints: 1800,
  amountMinor: 200000n,
  netMinor: 200000n,
  vatMinor: 36000n,
  grossMinor: 236000n,
  agreementDate: '2026-10-08',
  description: null,
  paymentTerms: 'EOM_30',
  startMonth: '2026-10',
  billingDay: 1,
  endMonth: null,
  cancelEffectiveMonth: null,
  cancelEffectiveDate: null,
  finalMonth: null,
  cancelledAt: null,
  version: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

const version = (version: number, effectiveMonth: string, amount: bigint, over: Partial<RetainerVersionRecord> = {}): RetainerVersionRecord => ({
  id: `v${version}`,
  organizationId: 'o1',
  agreementId: 'a1',
  version,
  effectiveMonth,
  monthlyAmountMinor: amount,
  netMinor: amount,
  vatMinor: (amount * 18n) / 100n,
  grossMinor: amount + (amount * 18n) / 100n,
  pricingBasis: 'VAT_EXCLUSIVE',
  vatTreatment: 'STANDARD_RATED',
  rateBasisPoints: 1800,
  billingDay: 1,
  paymentTerms: 'EOM_30',
  endMonth: null,
  reason: 'review',
  requestId: null,
  createdAt: new Date(0),
  ...over,
});

describe('terms timeline', () => {
  it('synthesizes version 1 from the agreement and orders stored versions after it', () => {
    const timeline = termsTimeline(agreement(), [version(3, '2027-07', 300000n), version(2, '2027-04', 250000n)]);
    expect(timeline.map((t) => [t.version, t.effectiveMonth, t.monthlyAmountMinor])).toEqual([
      [1, '2026-10', 200000n],
      [2, '2027-04', 250000n],
      [3, '2027-07', 300000n],
    ]);
    expect(timeline[0]).toMatchObject({ grossMinor: 236000n, billingDay: 1, paymentTerms: 'EOM_30', endMonth: null, reason: null });
  });

  it('picks the latest version effective on or before a month', () => {
    const timeline = termsTimeline(agreement(), [version(2, '2027-04', 250000n)]);
    expect(termsFor(timeline, '2026-10').version).toBe(1);
    expect(termsFor(timeline, '2027-03').version).toBe(1);
    expect(termsFor(timeline, '2027-04').version).toBe(2);
    expect(termsFor(timeline, '2028-01').version).toBe(2);
    // before the start month: still version 1
    expect(termsFor(timeline, '2020-01').version).toBe(1);
  });
});

describe('validateChange', () => {
  const timeline = termsTimeline(agreement(), [version(2, '2027-04', 250000n)]);

  it('accepts a forward change that alters something and names what changed', () => {
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2027-05', monthlyAmountMinor: 260000n, paymentTerms: 'EOM' })).toEqual({ ok: true, changed: ['monthlyAmount', 'paymentTerms'] });
  });

  it('refuses a month not after the latest version, after the end or cancel month, or malformed', () => {
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2027-04', monthlyAmountMinor: 1n })).toMatchObject({ ok: false, reason: 'CHANGE_EFFECTIVE_INVALID' });
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2026-11', monthlyAmountMinor: 1n })).toMatchObject({ ok: false, reason: 'CHANGE_EFFECTIVE_INVALID' });
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2027-13', monthlyAmountMinor: 1n })).toMatchObject({ ok: false, reason: 'CHANGE_EFFECTIVE_INVALID' });
    const ended = termsTimeline(agreement({ endMonth: '2027-06' }), []);
    expect(validateChange(ended, agreement({ endMonth: '2027-06' }), { effectiveMonth: '2027-07', monthlyAmountMinor: 1n })).toMatchObject({ ok: false, reason: 'CHANGE_EFFECTIVE_INVALID' });
    // extending the end month in the same change is allowed
    expect(validateChange(ended, agreement({ endMonth: '2027-06' }), { effectiveMonth: '2027-07', endMonth: '2027-12' }).ok).toBe(true);
    const cancelled = agreement({ cancelEffectiveMonth: '2027-02' });
    expect(validateChange(termsTimeline(cancelled, []), cancelled, { effectiveMonth: '2027-03', monthlyAmountMinor: 1n })).toMatchObject({ ok: false, reason: 'CHANGE_EFFECTIVE_INVALID' });
  });

  it('refuses a change that changes nothing, a bad billing day, a bad or early end month, a non-positive amount', () => {
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2027-05', monthlyAmountMinor: 250000n, billingDay: 1 })).toEqual({ ok: false, reason: 'CHANGE_NOTHING_CHANGED' });
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2027-05' })).toEqual({ ok: false, reason: 'CHANGE_NOTHING_CHANGED' });
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2027-05', billingDay: 29 })).toEqual({ ok: false, reason: 'BILLING_DAY_INVALID' });
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2027-05', endMonth: '2027-1' })).toEqual({ ok: false, reason: 'END_MONTH_INVALID' });
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2027-05', endMonth: '2027-04' })).toEqual({ ok: false, reason: 'END_BEFORE_START' });
    expect(validateChange(timeline, agreement(), { effectiveMonth: '2027-05', monthlyAmountMinor: 0n })).toEqual({ ok: false, reason: 'AMOUNT_INVALID' });
  });

  it('clearing the end month counts as a change; applyChange merges onto the previous terms', () => {
    const ended = termsTimeline(agreement({ endMonth: '2027-06' }), []);
    expect(diffTerms(ended[0]!, { effectiveMonth: '2027-01', endMonth: null })).toEqual(['endMonth']);
    expect(applyChange(ended[0]!, { effectiveMonth: '2027-01', endMonth: null, billingDay: 15 })).toEqual({ effectiveMonth: '2027-01', monthlyAmountMinor: 200000n, pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'STANDARD_RATED', billingDay: 15, paymentTerms: 'EOM_30', endMonth: null });
  });

  it('names the generated months that keep their terms', () => {
    expect(chargesKept(['2026-10', '2026-11', '2026-12'], '2026-11')).toEqual(['2026-11', '2026-12']);
    expect(chargesKept(['2026-10'], '2027-01')).toEqual([]);
  });
});
