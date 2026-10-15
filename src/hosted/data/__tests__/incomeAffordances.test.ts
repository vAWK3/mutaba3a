import { describe, it, expect } from 'vitest';
import type { HostedProfile, Payment, Receivable } from '../../api/client';
import { profile } from '../../__tests__/harness';
import { payment, receivable } from '../../pages/__tests__/fixtures';
import { canRedateOwed, canRedatePayment, incomeAffordancesFor, isSettleable } from '../incomeAffordances';

const PERSONAL_RULES = { received: true, owed: true, customer: 'optional' } as const;
const MALAFAT_RULES = { received: true, owed: false, customer: 'linked-required' } as const;
const PERSONAL_ACCESS = { payments: 'read-write', capture: 'read-write', expenses: 'read-write' } as const;

function personal(overrides: Partial<HostedProfile> = {}): HostedProfile {
  return profile({ writerOfRecord: null, isPersonalDefault: true, owned: true, type: 'PERSONAL', access: { ...PERSONAL_ACCESS }, income: { ...PERSONAL_RULES }, ...overrides });
}

describe('incomeAffordancesFor (MUT-133 D-gate)', () => {
  it('offers both kinds and settling on the signed-in user\'s own personal profile', () => {
    expect(incomeAffordancesFor(personal())).toEqual({ kinds: ['received', 'owed'], customer: 'optional', canSettle: true });
  });

  it('offers nothing on a Malafat-fed profile even though its rules allow Received (MUT-61)', () => {
    const malafat = profile({ writerOfRecord: 'MALAFAT', isPersonalDefault: false, access: { payments: 'read', capture: 'read-write' }, income: { ...MALAFAT_RULES } });
    expect(incomeAffordancesFor(malafat)).toEqual({ kinds: [], customer: 'linked-required', canSettle: false });
  });

  it('offers both kinds and settling on a business profile the user created (MUT-182)', () => {
    const business = personal({ isPersonalDefault: false, owned: true, type: 'BUSINESS' });
    expect(incomeAffordancesFor(business)).toEqual({ kinds: ['received', 'owed'], customer: 'optional', canSettle: true });
  });

  it('offers nothing on a writable profile the user does not own, such as a writer-null firm (ADR-066)', () => {
    const firm = personal({ isPersonalDefault: false, owned: false, type: null });
    expect(incomeAffordancesFor(firm).kinds).toEqual([]);
    expect(incomeAffordancesFor(firm).canSettle).toBe(false);
  });

  it('gates Add on capture access and settling on payments access', () => {
    expect(incomeAffordancesFor(personal({ access: { ...PERSONAL_ACCESS, capture: 'read' } })).kinds).toEqual([]);
    const noPayments = incomeAffordancesFor(personal({ access: { ...PERSONAL_ACCESS, payments: 'read' } }));
    expect(noPayments.kinds).toEqual(['received', 'owed']);
    expect(noPayments.canSettle).toBe(false);
  });

  it('follows the published rules: no Owed means no Owed kind and nothing to settle', () => {
    const receivedOnly = incomeAffordancesFor(personal({ income: { received: true, owed: false, customer: 'optional' } }));
    expect(receivedOnly).toEqual({ kinds: ['received'], customer: 'optional', canSettle: false });
  });
});

describe('isSettleable', () => {
  const adjustment = (status: string, outstanding = '100.00'): Receivable => ({ ...receivable('r1', 'c1', 'p1', outstanding, status), origin: 'ADJUSTMENT' });

  it('accepts an open entry captured through /v1/income', () => {
    for (const status of ['PENDING', 'DUE', 'OVERDUE', 'PARTIALLY_PAID']) expect(isSettleable(adjustment(status))).toBe(true);
  });

  it('refuses a paid or void entry, and anything Malafat posted (the server would answer 404)', () => {
    expect(isSettleable(adjustment('PAID', '0.00'))).toBe(false);
    expect(isSettleable(adjustment('VOID'))).toBe(false);
    expect(isSettleable({ ...adjustment('DUE'), origin: 'INSTALLMENT' })).toBe(false);
    expect(isSettleable({ ...adjustment('DUE'), origin: 'RETAINER_CHARGE' })).toBe(false);
  });
});

describe('canRedateOwed (MUT-224)', () => {
  const owed = (status = 'DUE'): Receivable => ({ ...receivable('r1', 'c1', 'p1', '100.00', status), origin: 'ADJUSTMENT' });

  it('offers it for an Owed entry on a profile the user owns, open or settled', () => {
    expect(canRedateOwed(personal(), owed())).toBe(true);
    expect(canRedateOwed(personal(), owed('PAID'))).toBe(true);
  });

  it('refuses a void entry, anything Malafat posted, a profile without capture write, and any profile the user does not own', () => {
    expect(canRedateOwed(personal(), owed('VOID'))).toBe(false);
    expect(canRedateOwed(personal(), { ...owed(), origin: 'INSTALLMENT' })).toBe(false);
    expect(canRedateOwed(personal({ access: { ...PERSONAL_ACCESS, capture: 'read' } }), owed())).toBe(false);
    expect(canRedateOwed(personal({ owned: false }), owed())).toBe(false);
    expect(canRedateOwed(personal({ owned: false, writerOfRecord: 'MALAFAT', income: { ...MALAFAT_RULES } }), owed())).toBe(false);
  });
});

describe('canRedatePayment (MUT-224)', () => {
  const ME = 'u-me';
  const mine = (over: Partial<Payment> = {}): Payment => ({ ...payment('p1', 'PAY-2026-0001'), origin: 'capture', status: 'POSTED', capturedBy: { userId: ME, displayName: 'Me' }, ...over });

  it("offers it for the user's own posted capture on a profile they own, settle payments included", () => {
    expect(canRedatePayment(personal(), mine(), ME)).toBe(true);
    expect(canRedatePayment(personal(), mine({ allocated: '585.00', unallocated: '0.00' }), ME)).toBe(true);
  });

  it("refuses an undone payment, Malafat's payment, someone else's capture, no payments write, and a profile the user does not own", () => {
    expect(canRedatePayment(personal(), mine({ status: 'REVERSED' }), ME)).toBe(false);
    expect(canRedatePayment(personal(), mine({ origin: 'integration', capturedBy: null }), ME)).toBe(false);
    expect(canRedatePayment(personal(), mine({ capturedBy: { userId: 'u-other', displayName: 'Rami' } }), ME)).toBe(false);
    expect(canRedatePayment(personal({ access: { ...PERSONAL_ACCESS, payments: 'read' } }), mine(), ME)).toBe(false);
    expect(canRedatePayment(personal({ owned: false, writerOfRecord: 'MALAFAT', income: { ...MALAFAT_RULES } }), mine(), ME)).toBe(false);
  });
});
