import { describe, expect, it } from 'vitest';
import type { AgreementRecord, InstallmentRecord, PaymentRecord, ReceivableRecord } from '../../repositories/ports.js';
import { bucketize, customerStatus, fixedStatus, lastPaymentOn, projectFigures, retainerStatus, unallocatedOf } from '../compute.js';

const rec = (over: Partial<ReceivableRecord>): ReceivableRecord => ({ id: 'r', organizationId: 'o', customerId: 'c', projectId: 'p', agreementId: 'a', origin: 'INSTALLMENT', originId: null, currency: 'ILS', netMinor: 1000n, vatMinor: 0n, grossMinor: 1000n, paidMinor: 0n, creditedMinor: 0n, vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, dueDate: '2026-10-20', postingDate: '2026-10-01', postedAt: new Date(0), status: 'OPEN', version: 1, createdAt: new Date(0), ...over });
const pay = (over: Partial<PaymentRecord>): PaymentRecord => ({ id: 'p', organizationId: 'o', customerId: 'c', number: 'PAY-2026-0001', currency: 'ILS', amountMinor: 500n, allocatedMinor: 0n, receivedOn: '2026-10-05', method: 'BANK', reference: null, notes: null, status: 'POSTED', reversedAt: null, reversalReason: null, replacesPaymentId: null, requestId: null, version: 1, createdAt: new Date(0), updatedAt: new Date(0), ...over });
const agreement = (over: Partial<AgreementRecord>): AgreementRecord => ({ id: 'a', organizationId: 'o', projectId: 'p', customerId: 'c', type: 'FIXED', status: 'ACTIVE', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: 3000n, netMinor: 3000n, vatMinor: 0n, grossMinor: 3000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, cancelEffectiveMonth: null, cancelEffectiveDate: null, finalMonth: null, cancelledAt: null, version: 1, createdAt: new Date(0), updatedAt: new Date(0), ...over });
const inst = (over: Partial<InstallmentRecord>): InstallmentRecord => ({ id: 'i', organizationId: 'o', agreementId: 'a', position: 1, label: 'I', amountMinor: 1000n, netMinor: 1000n, vatMinor: 0n, grossMinor: 1000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'MANUAL', triggerDate: null, paymentTerms: null, dueDateOverride: null, postedAt: null, postingDate: null, receivableId: null, voidedAt: null, version: 1, ...over });

describe('buckets', () => {
  it('splits open receivables into overdue / due today / not yet due and ignores settled ones', () => {
    const today = '2026-10-20';
    const b = bucketize([rec({ dueDate: '2026-10-19' }), rec({ dueDate: '2026-10-20', paidMinor: 400n }), rec({ dueDate: '2026-10-21', creditedMinor: 100n }), rec({ status: 'SETTLED', paidMinor: 1000n }), rec({ paidMinor: 1000n })], today);
    expect(b).toEqual({ outstanding: 2500n, overdue: 1000n, dueToday: 600n, notYetDue: 900n });
    expect(b.overdue + b.dueToday + b.notYetDue).toBe(b.outstanding);
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

  it('retainer: monthly from the caller (terms in force), no agreed total; no agreements → NONE', () => {
    const r = projectFigures({ agreements: [agreement({ type: 'RECURRING', startMonth: '2026-10', billingDay: 1 })], installments: [], receivables: [rec({ origin: 'RETAINER_CHARGE', dueDate: '2026-11-30' })], monthlyMinor: 2360n, today: '2026-10-20' });
    expect(r).toMatchObject({ kind: 'RETAINER', agreedMinor: null, monthlyMinor: 2360n, status: 'UP_TO_DATE' });
    expect(projectFigures({ agreements: [], installments: [], receivables: [], today: '2026-10-20' })).toMatchObject({ kind: 'NONE', status: 'NONE', agreedMinor: null, monthlyMinor: null });
  });
});
