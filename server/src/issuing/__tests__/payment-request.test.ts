import { describe, expect, it } from 'vitest';
import { blocksCancel, paymentRequestFacts, type ReferringDocument } from '../payment-request.js';
import { documentNumberLabel } from '../labels.js';

/** MUT-662: a payment request's status, derived from the invoice-receipts and receipts that refer to it. */

const doc = (over: Partial<ReferringDocument> = {}): ReferringDocument => ({ id: 'd1', docType: 'TAX_INVOICE_RECEIPT', number: 1050, grossMinor: 100_000n, creditedMinor: 0n, ...over });
const cancelled = { number: 2, cancelledAt: new Date('2026-11-22T10:00:00Z'), reason: null };

describe('paymentRequestFacts', () => {
  it.each([
    ['nothing refers to it', [], null, 'UNPAID', 0n],
    ['one partial payment', [doc()], null, 'PARTLY_PAID', 100_000n],
    ['two partials cover it', [doc(), doc({ id: 'd2', number: 1051, grossMinor: 240_000n })], null, 'PAID', 340_000n],
    ['a receipt counts like an invoice-receipt (exempt dealer)', [doc({ docType: 'RECEIPT', grossMinor: 340_000n })], null, 'PAID', 340_000n],
    ['a credit note on a linked 320 takes its money back off', [doc(), doc({ id: 'd2', number: 1051, grossMinor: 240_000n, creditedMinor: 240_000n })], null, 'PARTLY_PAID', 100_000n],
    ['cancelled wins', [], cancelled, 'CANCELLED', 0n],
  ] as const)('%s', (_label, referring, cancellation, status, covered) => {
    const facts = paymentRequestFacts(340_000n, referring, cancellation);
    expect(facts.status).toBe(status);
    expect(facts.coveredMinor).toBe(covered);
    expect(facts.linked).toHaveLength(referring.length);
  });
});

describe('blocksCancel (D18)', () => {
  it('a live invoice-receipt or receipt blocks cancelling; one fully credited does not', () => {
    expect(blocksCancel([])).toBe(false);
    expect(blocksCancel([doc()])).toBe(true);
    expect(blocksCancel([doc({ docType: 'RECEIPT' })])).toBe(true);
    expect(blocksCancel([doc({ creditedMinor: 100_000n })])).toBe(false);
  });
});

describe('documentNumberLabel', () => {
  it('PR-0007 and CX-0002 on screen; other types print their plain number', () => {
    expect(documentNumberLabel('PAYMENT_REQUEST', 7)).toBe('PR-0007');
    expect(documentNumberLabel('CANCELLATION', 2)).toBe('CX-0002');
    expect(documentNumberLabel('TAX_INVOICE', 1044)).toBe('1044');
  });
});
