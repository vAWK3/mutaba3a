import { describe, expect, it } from 'vitest';
import type { AgreementRecord, InstallmentRecord, PaymentRecord, ReceivableRecord } from '../../repositories/ports.js';
import { bucketize, customerStatus, fixedStatus, lastPaymentOn, projectFigures, retainerStatus, unallocatedOf } from '../compute.js';

const rec = (over: Partial<ReceivableRecord>): ReceivableRecord => ({ id: 'r', organizationId: 'o', customerId: 'c', projectId: 'p', agreementId: 'a', origin: 'INSTALLMENT', originId: null, currency: 'ILS', netMinor: 1000n, vatMinor: 0n, grossMinor: 1000n, paidMinor: 0n, creditedMinor: 0n, vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, dueDate: '2026-10-20', postingDate: '2026-10-01', postedAt: new Date(0), status: 'OPEN', title: null, createdByUserId: null, deletedAt: null, version: 1, createdAt: new Date(0), ...over });
const pay = (over: Partial<PaymentRecord>): PaymentRecord => ({ id: 'p', organizationId: 'o', customerId: 'c', projectId: null, number: 'PAY-2026-0001', currency: 'ILS', amountMinor: 500n, allocatedMinor: 0n, receivedOn: '2026-10-05', method: 'BANK', reference: null, notes: null, status: 'POSTED', reversedAt: null, reversalReason: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, version: 1, createdAt: new Date(0), updatedAt: new Date(0), ...over });
const agreement = (over: Partial<AgreementRecord>): AgreementRecord => ({ id: 'a', organizationId: 'o', projectId: 'p', customerId: 'c', type: 'FIXED', status: 'ACTIVE', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: 3000n, netMinor: 3000n, vatMinor: 0n, grossMinor: 3000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, cancelEffectiveMonth: null, cancelEffectiveDate: null, finalMonth: null, cancelledAt: null, commissionRateBasisPoints: null, upfrontTreatment: null, outcome: null, outcomeDate: null, awardedAmountMinor: null, outcomeNote: null, outcomeRecordedAt: null, version: 1, createdAt: new Date(0), updatedAt: new Date(0), ...over });
const inst = (over: Partial<InstallmentRecord>): InstallmentRecord => ({ id: 'i', organizationId: 'o', agreementId: 'a', position: 1, label: 'I', amountMinor: 1000n, netMinor: 1000n, vatMinor: 0n, grossMinor: 1000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'MANUAL', triggerDate: null, paymentTerms: null, dueDateOverride: null, postedAt: null, postingDate: null, receivableId: null, voidedAt: null, isCommission: false, version: 1, ...over });

describe('buckets', () => {
  it('splits open receivables into overdue / due today / not yet due and ignores settled ones', () => {
    const today = '2026-10-20';
    const b = bucketize([rec({ dueDate: '2026-10-19' }), rec({ dueDate: '2026-10-20', paidMinor: 400n }), rec({ dueDate: '2026-10-21', creditedMinor: 100n }), rec({ status: 'SETTLED', paidMinor: 1000n }), rec({ paidMinor: 1000n })], today);
    expect(b).toEqual({ outstanding: 2500n, overdue: 1000n, dueToday: 600n, notYetDue: 900n });
    expect(b.overdue + b.dueToday + b.notYetDue).toBe(b.outstanding);
  });

  it('leaves out an Owed dated after today until its day, then buckets it by its due date (MUT-392 D2)', () => {
    const future = rec({ origin: 'ADJUSTMENT', postingDate: '2026-11-11', dueDate: '2026-12-15' });
    const dated = rec({ id: 'd', dueDate: '2026-10-19' });
    expect(bucketize([future, dated], '2026-10-20')).toEqual({ outstanding: 1000n, overdue: 1000n, dueToday: 0n, notYetDue: 0n });
    expect(bucketize([future, dated], '2026-11-11')).toEqual({ outstanding: 2000n, overdue: 1000n, dueToday: 0n, notYetDue: 1000n });
    expect(bucketize([future], '2026-12-16')).toEqual({ outstanding: 1000n, overdue: 1000n, dueToday: 0n, notYetDue: 0n });
  });

  it('counts a future Owed on its own day, and never holds back an installment Malafat posted ahead (MUT-392 review)', () => {
    const today = '2026-10-20';
    const owedToday = rec({ id: 'o', origin: 'ADJUSTMENT', agreementId: null, postingDate: today, dueDate: '2026-11-15' });
    // An IMMEDIATE installment on an agreement dated ahead posts with that future postingDate (agreements/compose.ts postingDateFor).
    const installmentAhead = rec({ id: 'i', origin: 'INSTALLMENT', postingDate: '2026-12-01', dueDate: '2026-12-31' });
    const chargeAhead = rec({ id: 'c', origin: 'RETAINER_CHARGE', postingDate: '2026-11-01', dueDate: '2026-11-30' });
    expect(bucketize([owedToday, installmentAhead, chargeAhead], today)).toEqual({ outstanding: 3000n, overdue: 0n, dueToday: 0n, notYetDue: 3000n });
    expect(projectFigures({ agreements: [], installments: [], receivables: [installmentAhead], today }).postedMinor).toBe(1000n);
  });

  it('counts unallocated funds on POSTED payments only and the last POSTED received-on date', () => {
    const payments = [pay({ amountMinor: 500n, allocatedMinor: 200n }), pay({ id: 'q', amountMinor: 300n, allocatedMinor: 300n, receivedOn: '2026-10-09' }), pay({ id: 'r', status: 'REVERSED', amountMinor: 900n, receivedOn: '2026-12-01' })];
    expect(unallocatedOf(payments)).toEqual({ amount: 300n, count: 1 });
    expect(lastPaymentOn(payments)).toBe('2026-10-09');
    expect(lastPaymentOn([])).toBeNull();
  });
});

describe('statuses', () => {
  it('customer: settled, overdue, outstanding (due today), up to date', () => {
    expect(customerStatus({ outstanding: 0n, overdue: 0n, dueToday: 0n, notYetDue: 0n })).toBe('SETTLED');
    expect(customerStatus({ outstanding: 10n, overdue: 1n, dueToday: 0n, notYetDue: 9n })).toBe('OVERDUE');
    expect(customerStatus({ outstanding: 10n, overdue: 0n, dueToday: 1n, notYetDue: 9n })).toBe('OUTSTANDING');
    expect(customerStatus({ outstanding: 10n, overdue: 0n, dueToday: 0n, notYetDue: 10n })).toBe('UP_TO_DATE');
  });

  it('fixed project: pending until something posts, never paid in full while an installment is pending', () => {
    const none = { outstanding: 0n, overdue: 0n, dueToday: 0n, notYetDue: 0n };
    expect(fixedStatus(none, 0n, 2, 0n)).toBe('PENDING');
    expect(fixedStatus(none, 1000n, 1, 1000n)).toBe('PENDING');
    expect(fixedStatus(none, 1000n, 0, 1000n)).toBe('PAID_IN_FULL');
    expect(fixedStatus({ ...none, outstanding: 500n, notYetDue: 500n }, 0n, 0, 500n)).toBe('OUTSTANDING');
    expect(fixedStatus({ ...none, outstanding: 500n, notYetDue: 500n }, 500n, 0, 1000n)).toBe('PARTIALLY_PAID');
    expect(fixedStatus({ ...none, outstanding: 500n, overdue: 500n }, 500n, 0, 1000n)).toBe('OVERDUE');
  });

  it('retainer project: cancelled vs settled, overdue, outstanding, up to date', () => {
    const none = { outstanding: 0n, overdue: 0n, dueToday: 0n, notYetDue: 0n };
    expect(retainerStatus({ status: 'CANCELLED' }, { ...none, outstanding: 1n, notYetDue: 1n })).toBe('CANCELLED');
    expect(retainerStatus({ status: 'CANCELLED' }, none)).toBe('SETTLED');
    expect(retainerStatus({ status: 'ACTIVE' }, { ...none, outstanding: 1n, overdue: 1n })).toBe('OVERDUE');
    expect(retainerStatus({ status: 'ACTIVE' }, { ...none, outstanding: 1n, dueToday: 1n })).toBe('OUTSTANDING');
    expect(retainerStatus({ status: 'ACTIVE' }, { ...none, outstanding: 1n, notYetDue: 1n })).toBe('UP_TO_DATE');
    expect(retainerStatus({ status: 'ACTIVE' }, none)).toBe('UP_TO_DATE');
  });
});

describe('projectFigures', () => {
  it('fixed: agreed from the active agreement, posted / paid / credited sums, pending count and amount', () => {
    const f = projectFigures({
      agreements: [agreement({})],
      installments: [inst({ receivableId: 'r1' }), inst({ id: 'i2', position: 2 }), inst({ id: 'i3', position: 3, voidedAt: new Date(0) })],
      receivables: [rec({ paidMinor: 400n, creditedMinor: 100n, dueDate: '2026-10-19' })],
      today: '2026-10-20',
    });
    expect(f).toMatchObject({ kind: 'FIXED', agreedMinor: 3000n, monthlyMinor: null, postedMinor: 1000n, paidMinor: 400n, creditedMinor: 100n, pending: { count: 1, amountMinor: 1000n }, status: 'OVERDUE' });
    expect(f.buckets.outstanding).toBe(500n);
  });

  it('leaves a future-dated Owed with no money on it out of posted and the buckets until its day (MUT-392 D2)', () => {
    const future = rec({ id: 'f', origin: 'ADJUSTMENT', agreementId: null, postingDate: '2026-11-11', dueDate: '2026-12-15' });
    const before = projectFigures({ agreements: [], installments: [], receivables: [rec({}), future], today: '2026-10-20' });
    expect(before).toMatchObject({ postedMinor: 1000n, paidMinor: 0n, creditedMinor: 0n });
    expect(before.buckets.outstanding).toBe(1000n);
    const on = projectFigures({ agreements: [], installments: [], receivables: [rec({}), future], today: '2026-11-11' });
    expect(on).toMatchObject({ postedMinor: 2000n, paidMinor: 0n });
    expect(on.buckets.outstanding).toBe(2000n);
  });

  it('counts a future-dated Owed at once when a payment or credit has landed on it (MUT-392 D2: counts once money moves)', () => {
    const today = '2026-10-20';
    const paid = rec({ id: 'p', origin: 'ADJUSTMENT', agreementId: null, postingDate: '2026-11-11', dueDate: '2026-12-15', paidMinor: 200n });
    const credited = rec({ id: 'c', origin: 'ADJUSTMENT', agreementId: null, postingDate: '2026-11-11', dueDate: '2026-12-15', creditedMinor: 100n });
    const figures = projectFigures({ agreements: [], installments: [], receivables: [paid, credited], today });
    expect(figures).toMatchObject({ postedMinor: 2000n, paidMinor: 200n, creditedMinor: 100n });
    expect(figures.buckets).toEqual({ outstanding: 1700n, overdue: 0n, dueToday: 0n, notYetDue: 1700n });
    const settled = rec({ id: 's', origin: 'ADJUSTMENT', agreementId: null, postingDate: '2026-11-11', status: 'SETTLED', paidMinor: 1000n });
    expect(projectFigures({ agreements: [], installments: [], receivables: [settled], today })).toMatchObject({ postedMinor: 1000n, paidMinor: 1000n });
  });

  it('retainer: monthly from the caller (terms in force), no agreed total; no agreements → NONE', () => {
    const r = projectFigures({ agreements: [agreement({ type: 'RECURRING', startMonth: '2026-10', billingDay: 1 })], installments: [], receivables: [rec({ origin: 'RETAINER_CHARGE', dueDate: '2026-11-30' })], monthlyMinor: 2360n, today: '2026-10-20' });
    expect(r).toMatchObject({ kind: 'RETAINER', agreedMinor: null, monthlyMinor: 2360n, status: 'UP_TO_DATE' });
    expect(projectFigures({ agreements: [], installments: [], receivables: [], today: '2026-10-20' })).toMatchObject({ kind: 'NONE', status: 'NONE', agreedMinor: null, monthlyMinor: null });
  });
});

describe('projectFigures with contingency agreements (MUT-100)', () => {
  const contingency = (over: Partial<AgreementRecord> = {}) => agreement({ id: 'k', type: 'CONTINGENCY', grossMinor: 1770n, commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', ...over });
  const upfront = inst({ id: 'u', agreementId: 'k', grossMinor: 1770n, receivableId: 'ru' });
  const paidUpfront = rec({ id: 'ru', agreementId: 'k', grossMinor: 1770n, paidMinor: 1770n, status: 'SETTLED' });

  it('a contingency-only project is fixed-like: kind FIXED, agreed = the upfront, and the terms in a contingency block', () => {
    const f = projectFigures({ agreements: [contingency()], installments: [upfront], receivables: [rec({ id: 'ru', agreementId: 'k', grossMinor: 1770n })], today: '2026-10-13' });
    expect(f).toMatchObject({ kind: 'FIXED', agreedMinor: 1770n, contingency: { agreementId: 'k', commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', outcome: 'AWAITING', awardedMinor: null } });
  });

  it('awaiting the outcome with the upfront paid is PENDING, never PAID_IN_FULL', () => {
    const f = projectFigures({ agreements: [contingency()], installments: [upfront], receivables: [paidUpfront], today: '2026-10-13' });
    expect(f.status).toBe('PENDING');
  });

  it('after AWARDED the posted commission is owed like any fixed line: OUTSTANDING when nothing is paid, PARTIALLY_PAID once the upfront is', () => {
    const awarded = contingency({ outcome: 'AWARDED', outcomeDate: '2026-10-12', awardedAmountMinor: 10_000_000n, grossMinor: 2_537_000n });
    const commission = inst({ id: 'c', agreementId: 'k', position: 2, isCommission: true, grossMinor: 2_360_000n, receivableId: 'rc' });
    const commissionReceivable = rec({ id: 'rc', agreementId: 'k', grossMinor: 2_360_000n, dueDate: '2026-10-31' });
    const unpaid = projectFigures({ agreements: [awarded], installments: [upfront, commission], receivables: [rec({ id: 'ru', agreementId: 'k', grossMinor: 1770n, dueDate: '2026-10-31' }), commissionReceivable], today: '2026-10-13' });
    expect(unpaid).toMatchObject({ status: 'OUTSTANDING', agreedMinor: 2_537_000n, contingency: { outcome: 'AWARDED', awardedMinor: 10_000_000n } });
    const upfrontPaid = projectFigures({ agreements: [awarded], installments: [upfront, commission], receivables: [paidUpfront, commissionReceivable], today: '2026-10-13' });
    expect(upfrontPaid.status).toBe('PARTIALLY_PAID');
  });

  it('a recorded outcome with everything paid is PAID_IN_FULL again', () => {
    const settled = contingency({ outcome: 'NO_RECOVERY', outcomeDate: '2026-10-12' });
    expect(projectFigures({ agreements: [settled], installments: [upfront], receivables: [paidUpfront], today: '2026-10-13' }).status).toBe('PAID_IN_FULL');
  });

  it('a FIXED hearing agreement and a contingency agreement: agreed sums both', () => {
    const f = projectFigures({ agreements: [agreement({ id: 'h', grossMinor: 944n }), contingency()], installments: [upfront], receivables: [], today: '2026-10-13' });
    expect(f).toMatchObject({ kind: 'FIXED', agreedMinor: 2714n });
  });

  it('only an ACTIVE contingency agreement shows; the latest wins when there are several; none → null', () => {
    const f = projectFigures({ agreements: [contingency({ id: 'k1', commissionRateBasisPoints: 1000 }), contingency({ id: 'k2', commissionRateBasisPoints: 3000 }), contingency({ id: 'k3', status: 'CANCELLED' })], installments: [], receivables: [], today: '2026-10-13' });
    expect(f.contingency).toMatchObject({ agreementId: 'k2', commissionRateBasisPoints: 3000 });
    expect(projectFigures({ agreements: [agreement({})], installments: [], receivables: [], today: '2026-10-13' }).contingency).toBeNull();
  });

  it('regression (R5/D7): a FIXED + RETAINER mix → kind FIXED, monthly set, agreed = the FIXED sum', () => {
    const f = projectFigures({ agreements: [agreement({ grossMinor: 3000n }), agreement({ id: 'r', type: 'RECURRING', grossMinor: 2360n, startMonth: '2026-10', billingDay: 1 })], installments: [], receivables: [], monthlyMinor: 2360n, today: '2026-10-13' });
    expect(f).toMatchObject({ kind: 'FIXED', agreedMinor: 3000n, monthlyMinor: 2360n, contingency: null });
  });
});
