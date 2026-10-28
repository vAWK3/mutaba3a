import { describe, expect, it } from 'vitest';
import { agreedAmountOf, agreementTypeOf, approveTokenParts, draftChanged, storedDraftOf, toAgreementBody, toRetainerBody, type AgreementDraft } from '../draft.js';

/** MUT-479 (D1, D2, D5): the pure half of a proposal's stored draft agreement. */
const FIXED: AgreementDraft = {
  kind: 'FIXED',
  amount: '10000.00',
  pricingBasis: 'VAT_EXCLUSIVE',
  paymentTerms: 'EOM',
  installments: [
    { label: 'On signing', percentBasisPoints: 3000, trigger: { type: 'IMMEDIATE' } },
    { label: 'On judgment', percentBasisPoints: 7000, trigger: { type: 'MANUAL' } },
  ],
};
const CONTINGENCY: AgreementDraft = {
  kind: 'CONTINGENCY',
  amount: '0.00',
  pricingBasis: 'VAT_EXCLUSIVE',
  paymentTerms: 'EOM',
  installments: [],
  contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' },
};
const RETAINER: AgreementDraft = { kind: 'RETAINER', monthlyAmount: '1500.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth: '2026-11', billingDay: 1, paymentTerms: 'EOM' };

describe('agreementTypeOf', () => {
  it('maps each kind to the agreement it makes', () => {
    expect(agreementTypeOf(FIXED)).toBe('FIXED');
    expect(agreementTypeOf(CONTINGENCY)).toBe('CONTINGENCY');
    expect(agreementTypeOf(RETAINER)).toBe('RECURRING');
  });
});

describe('agreedAmountOf (D2, D5)', () => {
  it('is the fixed total, the contingency upfront, or the retainer monthly amount, in minor units', () => {
    expect(agreedAmountOf(FIXED, 'ILS')).toBe(1_000_000n);
    expect(agreedAmountOf(CONTINGENCY, 'ILS')).toBe(0n);
    expect(agreedAmountOf(RETAINER, 'ILS')).toBe(150_000n);
  });

  it('refuses an amount the currency cannot hold with AMOUNT_INVALID', () => {
    expect(() => agreedAmountOf({ ...RETAINER, monthlyAmount: '1.234' } as AgreementDraft, 'ILS')).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'AMOUNT_INVALID', field: 'agreement.monthlyAmount' }) }));
  });
});

describe('toAgreementBody / toRetainerBody (D1)', () => {
  it('a FIXED draft becomes the agreement body on the proposal’s project, dated the approval, with no contingency', () => {
    const body = toAgreementBody(FIXED, 'p-1', '2026-10-28');
    expect(body).toEqual({ projectId: 'p-1', agreementDate: '2026-10-28', amount: '10000.00', pricingBasis: 'VAT_EXCLUSIVE', paymentTerms: 'EOM', installments: FIXED.kind === 'FIXED' ? FIXED.installments : [] });
    expect('contingency' in body).toBe(false);
    expect('kind' in body).toBe(false);
  });

  it('a CONTINGENCY draft keeps its terms', () => {
    expect(toAgreementBody(CONTINGENCY, 'p-1', '2026-10-28').contingency).toEqual({ commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' });
  });

  it('a RETAINER draft becomes the retainer body', () => {
    expect(toRetainerBody(RETAINER, 'p-1', '2026-10-28')).toEqual({ projectId: 'p-1', agreementDate: '2026-10-28', monthlyAmount: '1500.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth: '2026-11', billingDay: 1, paymentTerms: 'EOM' });
  });

  it('each refuses the other family', () => {
    expect(() => toAgreementBody(RETAINER, 'p-1', '2026-10-28')).toThrow();
    expect(() => toRetainerBody(FIXED, 'p-1', '2026-10-28')).toThrow();
  });
});

describe('storedDraftOf (R3)', () => {
  it('stamps schemaVersion 1 and keeps only JSON (no undefined keys)', () => {
    const stored = storedDraftOf({ ...RETAINER, endMonth: undefined, description: 'Monthly advice' } as AgreementDraft);
    expect(stored).toEqual({ schemaVersion: 1, ...RETAINER, description: 'Monthly advice' });
    expect(Object.keys(stored)).not.toContain('endMonth');
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });
});

describe('draftChanged (D5)', () => {
  it('is false for the stored draft itself, whatever the key order, and true for any edit', () => {
    const stored = storedDraftOf(FIXED);
    const reordered = Object.fromEntries(Object.entries(FIXED).reverse()) as AgreementDraft;
    expect(draftChanged(stored, reordered)).toBe(false);
    expect(draftChanged(stored, { ...FIXED, amount: '9000.00' } as AgreementDraft)).toBe(true);
  });

  it('is null when the proposal stored no draft (a legacy proposal)', () => {
    expect(draftChanged(null, FIXED)).toBeNull();
  });
});

describe('approveTokenParts (D4, R5)', () => {
  it('names the proposal, its version, the resolved date, the agreement and the rate', () => {
    expect(approveTokenParts('o-1', { id: 'fp-1', version: 3 }, '2026-10-28', FIXED, 1800)).toEqual(['o-1', 'proposal-approve', 'fp-1', 3, '2026-10-28', FIXED, 1800]);
  });
});
