import { describe, expect, it } from 'vitest';
import { entryAmount, fromEntryMode, ledgerPlan, postsNewOwed, type EntryState } from '../ledger-plan.js';
import type { IssueDocumentInput } from '../../repositories/ports.js';

/** MUT-660: whether a document takes its entry over (MUT-648's path) or is linked to it, leaving its money as recorded. */

const owed = (over: Partial<EntryState> = {}): EntryState => ({
  kind: 'receivable',
  origin: 'ADJUSTMENT',
  deleted: false,
  posted: true,
  customerId: 'c1',
  currency: 'ILS',
  grossMinor: 340_000n,
  creditedMinor: 0n,
  allocatedMinor: 0n,
  documented: false,
  ...over,
});
const received = (over: Partial<EntryState> = {}): EntryState => owed({ kind: 'payment', origin: 'CAPTURE', grossMinor: 100_000n, ...over });

describe('fromEntryMode', () => {
  it('an untouched recorded Owed is taken over by its tax invoice', () => {
    expect(fromEntryMode(owed(), 'TAX_INVOICE')).toBe('take');
  });

  it('an agreement\'s charge, or a credited Owed, gets its tax invoice linked: its money and agreement stay', () => {
    expect(fromEntryMode(owed({ origin: 'INSTALLMENT' }), 'TAX_INVOICE')).toBe('link');
    expect(fromEntryMode(owed({ origin: 'RETAINER_CHARGE' }), 'TAX_INVOICE')).toBe('link');
    expect(fromEntryMode(owed({ creditedMinor: 40_000n }), 'TAX_INVOICE')).toBe('link');
    expect(fromEntryMode(owed({ origin: 'INSTALLMENT' }), 'RECEIPT')).toBeNull();
  });

  it('an Owed that is deleted, document-owned, already documented or fully credited takes no document', () => {
    expect(fromEntryMode(owed({ deleted: true }), 'TAX_INVOICE')).toBeNull();
    expect(fromEntryMode(owed({ origin: 'ISSUED_DOCUMENT' }), 'TAX_INVOICE')).toBeNull();
    expect(fromEntryMode(owed({ origin: 'INSTALLMENT', documented: true }), 'TAX_INVOICE')).toBeNull();
    expect(fromEntryMode(owed({ origin: 'INSTALLMENT', creditedMinor: 340_000n }), 'TAX_INVOICE')).toBeNull();
  });

  it('an unallocated captured Received is taken over (an invoice-receipt needs a client for its Owed)', () => {
    expect(fromEntryMode(received(), 'TAX_INVOICE_RECEIPT')).toBe('take');
    expect(fromEntryMode(received(), 'RECEIPT')).toBe('take');
    expect(fromEntryMode(received({ customerId: null }), 'RECEIPT')).toBe('take');
  });

  it('an allocated Received, or no-client money taking an invoice-receipt, gets the document linked: nothing is posted', () => {
    expect(fromEntryMode(received({ allocatedMinor: 40_000n }), 'TAX_INVOICE_RECEIPT')).toBe('link');
    expect(fromEntryMode(received({ allocatedMinor: 100_000n }), 'RECEIPT')).toBe('link');
    expect(fromEntryMode(received({ customerId: null }), 'TAX_INVOICE_RECEIPT')).toBe('link');
  });

  it('a Received that is reversed, document-made, recorded elsewhere or already documented takes no document', () => {
    expect(fromEntryMode(received({ posted: false }), 'RECEIPT')).toBeNull();
    expect(fromEntryMode(received({ origin: 'ISSUED_DOCUMENT' }), 'RECEIPT')).toBeNull();
    expect(fromEntryMode(received({ origin: 'INTEGRATION' }), 'RECEIPT')).toBeNull();
    expect(fromEntryMode(received({ documented: true, allocatedMinor: 1n }), 'RECEIPT')).toBeNull();
    expect(fromEntryMode(received(), 'TAX_INVOICE')).toBeNull();
    expect(fromEntryMode(null, 'RECEIPT')).toBeNull();
  });

  it('the amount a document must match: an Owed\'s gross less credits, a Received\'s amount', () => {
    expect(entryAmount(owed({ creditedMinor: 40_000n }))).toBe(300_000n);
    expect(entryAmount(received({ allocatedMinor: 50n }))).toBe(100_000n);
  });
});

describe('MUT-662: payment request ledger rows', () => {
  const composed = { lines: [], subtotalMinor: 340_000n, discountMinor: 0n, netMinor: 340_000n, vatRateBasisPoints: 1800, vatMinor: 61_200n, grossMinor: 401_200n, pricesIncludeVat: false };
  const issue = (over: Partial<IssueDocumentInput> = {}) =>
    ({ docType: 'PAYMENT_REQUEST', customerId: 'c1', currency: 'ILS', composed, titlePrefix: 'דרישת תשלום', documentDate: '2026-11-22', dueDate: null, payment: null, appliesToDocumentId: null, fromEntry: null, ...over }) as IssueDocumentInput;

  it('from an Owed: always linked, never taking it over, posting nothing', () => {
    expect(fromEntryMode(owed(), 'PAYMENT_REQUEST')).toBe('link');
    expect(fromEntryMode(owed({ origin: 'INSTALLMENT' }), 'PAYMENT_REQUEST')).toBe('link');
    expect(fromEntryMode(owed({ documented: true }), 'PAYMENT_REQUEST')).toBeNull();
    expect(ledgerPlan(issue({ fromEntry: { kind: 'receivable', id: 'r1' } }), 7)).toEqual({ receivable: null, payment: null, credit: null });
    expect(postsNewOwed(issue({ fromEntry: { kind: 'receivable', id: 'r1' } }))).toBe(false);
  });

  it('with no entry: an ordinary Owed (ADJUSTMENT) that cancelling the request leaves', () => {
    const plan = ledgerPlan(issue(), 7);
    expect(plan.receivable).toMatchObject({ origin: 'ADJUSTMENT', grossMinor: 401_200n, title: 'דרישת תשלום 7' });
    expect(plan.payment).toBeNull();
    expect(postsNewOwed(issue())).toBe(true);
  });

  it("an invoice-receipt that settles a request posts only a Received paying the request's Owed", () => {
    const plan = ledgerPlan(issue({ docType: 'TAX_INVOICE_RECEIPT', appliesToDocumentId: 'pr7', payment: { method: 'BANK', reference: null, receivedOn: '2026-11-22' } }), 1050);
    expect(plan.receivable).toBeNull();
    expect(plan.payment).toMatchObject({ allocate: 'applies', amountMinor: 401_200n });
    expect(postsNewOwed(issue({ docType: 'TAX_INVOICE_RECEIPT', appliesToDocumentId: 'pr7' }))).toBe(false);
    expect(postsNewOwed(issue({ docType: 'TAX_INVOICE_RECEIPT' }))).toBe(true);
  });
});
