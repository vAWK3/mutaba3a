import { describe, expect, it } from 'vitest';
import { entryAmount, fromEntryMode, type EntryState } from '../ledger-plan.js';

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
