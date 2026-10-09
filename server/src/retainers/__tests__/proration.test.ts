import { describe, expect, it } from 'vitest';
import type { ReceivableRecord, RetainerChargeRecord } from '../../repositories/ports.js';
import { cancelOutcome, prorate } from '../proration.js';

describe('prorate', () => {
  it('is calendar-day, inclusive of the cancellation day, half-up on minor units', () => {
    expect(prorate({ amountMinor: 200000n, effectiveDate: '2026-10-18' })).toEqual({ days: 18, daysInMonth: 31, amountMinor: 116129n }); // 2000 × 18/31 = 1161.29
    expect(prorate({ amountMinor: 200000n, effectiveDate: '2026-11-15' })).toEqual({ days: 15, daysInMonth: 30, amountMinor: 100000n });
    expect(prorate({ amountMinor: 200000n, effectiveDate: '2027-02-14' })).toEqual({ days: 14, daysInMonth: 28, amountMinor: 100000n });
    expect(prorate({ amountMinor: 200000n, effectiveDate: '2028-02-14' })).toEqual({ days: 14, daysInMonth: 29, amountMinor: 96552n }); // 965.517… → 965.52
    expect(prorate({ amountMinor: 200000n, effectiveDate: '2026-10-01' })).toEqual({ days: 1, daysInMonth: 31, amountMinor: 6452n }); // 64.516… → 64.52
    expect(prorate({ amountMinor: 200000n, effectiveDate: '2026-10-31' })).toEqual({ days: 31, daysInMonth: 31, amountMinor: 200000n });
    expect(prorate({ amountMinor: 1n, effectiveDate: '2026-10-15' })).toEqual({ days: 15, daysInMonth: 31, amountMinor: 0n }); // 0.48 → 0
    expect(prorate({ amountMinor: 1n, effectiveDate: '2026-10-16' })).toEqual({ days: 16, daysInMonth: 31, amountMinor: 1n }); // 0.516 → 1
  });
});

describe('cancelOutcome', () => {
  const terms = { monthlyAmountMinor: 200000n, pricingBasis: 'VAT_EXCLUSIVE' as const, vatTreatment: 'STANDARD_RATED' as const, rateBasisPoints: 1800 };
  const charge: RetainerChargeRecord = { id: 'ch1', organizationId: 'o1', agreementId: 'a1', version: 1, serviceMonth: '2026-10', chargeDate: '2026-10-01', amountMinor: 200000n, netMinor: 200000n, vatMinor: 36000n, grossMinor: 236000n, vatTreatment: 'STANDARD_RATED', rateBasisPoints: 1800, postedAt: new Date(0), receivableId: 'r1', createdAt: new Date(0) };
  const receivable = (paid: bigint, credited = 0n): ReceivableRecord => ({ id: 'r1', organizationId: 'o1', customerId: 'c1', projectId: 'p1', agreementId: 'a1', origin: 'RETAINER_CHARGE', originId: 'ch1', currency: 'ILS', netMinor: 200000n, vatMinor: 36000n, grossMinor: 236000n, paidMinor: paid, creditedMinor: credited, vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1800, dueDate: '2026-11-30', postingDate: '2026-10-01', postedAt: new Date(0), status: 'OPEN', version: 1, createdAt: new Date(0) });

  it('FULL keeps the whole month and never credits', () => {
    const out = cancelOutcome({ terms, effectiveDate: '2026-10-18', finalMonth: 'FULL', posted: { charge, receivable: receivable(0n) } });
    expect(out.finalCharge).toMatchObject({ serviceMonth: '2026-10', days: 31, daysInMonth: 31, amountMinor: 200000n, grossMinor: 236000n });
    expect(out.adjustment).toBeNull();
  });

  it('PRORATE on an unposted month charges the prorated part, VAT computed on it', () => {
    const out = cancelOutcome({ terms, effectiveDate: '2026-10-18', finalMonth: 'PRORATE', posted: null });
    expect(out.finalCharge).toEqual({ serviceMonth: '2026-10', days: 18, daysInMonth: 31, amountMinor: 116129n, netMinor: 116129n, vatMinor: 20903n, grossMinor: 137032n });
    expect(out.adjustment).toBeNull();
  });

  it('PRORATE on a posted month credits the difference, split at the receivable’s frozen rate', () => {
    const out = cancelOutcome({ terms, effectiveDate: '2026-10-18', finalMonth: 'PRORATE', posted: { charge, receivable: receivable(0n) } });
    expect(out.adjustment).toEqual({ amountMinor: 98968n, netMinor: 83871n, vatMinor: 15097n, limitedByPayments: false }); // 2360.00 − 1370.32 = 989.68
    expect(out.adjustment!.netMinor + out.adjustment!.vatMinor).toBe(98968n);
  });

  it('a credit never exceeds the outstanding: paid amounts are not refunded', () => {
    const out = cancelOutcome({ terms, effectiveDate: '2026-10-18', finalMonth: 'PRORATE', posted: { charge, receivable: receivable(200000n) } });
    expect(out.adjustment).toMatchObject({ amountMinor: 36000n, limitedByPayments: true });
    const settled = cancelOutcome({ terms, effectiveDate: '2026-10-18', finalMonth: 'WAIVE', posted: { charge, receivable: receivable(236000n) } });
    expect(settled.adjustment).toBeNull();
  });

  it('WAIVE on a posted month credits everything outstanding; unposted charges nothing', () => {
    const out = cancelOutcome({ terms, effectiveDate: '2026-10-18', finalMonth: 'WAIVE', posted: { charge, receivable: receivable(100000n, 36000n) } });
    expect(out.finalCharge).toBeNull();
    expect(out.adjustment).toMatchObject({ amountMinor: 100000n, limitedByPayments: true }); // 1000.00 was paid and stays paid
    const unpaid = cancelOutcome({ terms, effectiveDate: '2026-10-18', finalMonth: 'WAIVE', posted: { charge, receivable: receivable(0n, 36000n) } });
    expect(unpaid.adjustment).toMatchObject({ amountMinor: 200000n, limitedByPayments: false }); // the earlier 360.00 credit is not credited twice
    expect(cancelOutcome({ terms, effectiveDate: '2026-10-18', finalMonth: 'WAIVE', posted: null })).toEqual({ effectiveMonth: '2026-10', finalMonth: 'WAIVE', finalCharge: null, adjustment: null });
  });
});
