import { describe, expect, it } from 'vitest';
import { documentsDue, olderThan, type DocumentsDueInput, type DuePaymentInput, type DueReceivableInput } from '../documents-due.js';

/** MUT-660: what each income entry is due, derived from the client's preference and what's already issued or attached. */

const ils = (n: number): bigint => BigInt(Math.round(n * 100));

const owed = (over: Partial<DueReceivableInput> = {}): DueReceivableInput => ({
  id: 'r1',
  number: 'CHG-2026-0001',
  customerId: 'rami',
  origin: 'ADJUSTMENT',
  currency: 'ILS',
  grossMinor: ils(3400),
  paidMinor: 0n,
  creditedMinor: 0n,
  postingDate: '2026-11-02',
  notForInvoice: false,
  deleted: false,
  documented: false,
  taxInvoiceId: null,
  externalInvoice: false,
  ...over,
});

const paid = (over: Partial<DuePaymentInput> = {}): DuePaymentInput => ({
  id: 'p1',
  number: 'PAY-2026-0001',
  customerId: 'rami',
  origin: 'CAPTURE',
  status: 'POSTED',
  currency: 'ILS',
  amountMinor: ils(1000),
  receivedOn: '2026-11-15',
  notForInvoice: false,
  receiptNumber: null,
  documented: false,
  externalInvoice: false,
  allocations: [],
  ...over,
});

const input = (over: Partial<DocumentsDueInput> = {}): DocumentsDueInput => ({
  dealerType: 'LICENSED',
  defaultPreference: 'ON_PAYMENT',
  preferences: new Map([
    ['rami', 'TAX_INVOICE_FIRST'],
    ['nour', null],
    ['quds', 'PAYMENT_REQUEST_FIRST'],
    ['zaid', 'NO_DOCUMENT'],
  ]),
  receivables: [],
  payments: [],
  ...over,
});

const kinds = (i: DocumentsDueInput) => documentsDue(i).map((d) => `${d.entry.kind}:${d.entry.id}:${d.kind}:${d.amountMinor}`);

describe('documentsDue: receivables (Owed)', () => {
  it('AC2: tax invoice first, an Owed of 3,400 is due a tax invoice for 3,400', () => {
    const [item] = documentsDue(input({ receivables: [owed()] }));
    expect(item).toMatchObject({ kind: 'TAX_INVOICE', amountMinor: ils(3400), currency: 'ILS', customerId: 'rami', date: '2026-11-02', issuable: true, linkOnly: false });
    expect(item?.entry).toEqual({ kind: 'receivable', id: 'r1', number: 'CHG-2026-0001' });
  });

  it('a tax invoice or an attached invoice settles the Owed', () => {
    expect(kinds(input({ receivables: [owed({ documented: true, taxInvoiceId: 'd305' })] }))).toEqual([]);
    expect(kinds(input({ receivables: [owed({ externalInvoice: true })] }))).toEqual([]);
  });

  it('payment request first: due a payment request, listed but not issuable until MUT-662', () => {
    const [item] = documentsDue(input({ receivables: [owed({ customerId: 'quds' })] }));
    expect(item).toMatchObject({ kind: 'PAYMENT_REQUEST', issuable: false, reason: 'PAYMENT_REQUEST_PENDING' });
  });

  it('on payment (the default, also a null preference) and no document: an Owed is due nothing', () => {
    expect(kinds(input({ receivables: [owed({ customerId: 'nour' })] }))).toEqual([]);
    expect(kinds(input({ receivables: [owed({ customerId: 'zaid' })] }))).toEqual([]);
    expect(kinds(input({ receivables: [owed({ customerId: 'unknown' })] }))).toEqual([]);
  });

  it('the profile default applies to a client with no preference', () => {
    expect(kinds(input({ defaultPreference: 'TAX_INVOICE_FIRST', receivables: [owed({ customerId: 'nour' })] }))).toEqual([`receivable:r1:TAX_INVOICE:${ils(3400)}`]);
  });

  it('not for invoice, deleted, fully credited and document-owned Owed are due nothing', () => {
    expect(kinds(input({ receivables: [owed({ notForInvoice: true })] }))).toEqual([]);
    expect(kinds(input({ receivables: [owed({ deleted: true })] }))).toEqual([]);
    expect(kinds(input({ receivables: [owed({ creditedMinor: ils(3400) })] }))).toEqual([]);
    expect(kinds(input({ receivables: [owed({ origin: 'ISSUED_DOCUMENT' })] }))).toEqual([]);
  });

  it('a partly credited Owed is due its remainder, issued linked only', () => {
    const [item] = documentsDue(input({ receivables: [owed({ creditedMinor: ils(400) })] }));
    expect(item).toMatchObject({ amountMinor: ils(3000), linkOnly: true, issuable: true });
  });

  it('installment and retainer Owed are due a tax invoice, issued linked only so the agreement keeps its charge', () => {
    for (const origin of ['INSTALLMENT', 'RETAINER_CHARGE'] as const) {
      const [item] = documentsDue(input({ receivables: [owed({ origin })] }));
      expect(item).toMatchObject({ kind: 'TAX_INVOICE', issuable: true, linkOnly: true });
    }
  });

  it('a fully paid Owed with no tax invoice is still due one under tax invoice first', () => {
    expect(kinds(input({ receivables: [owed({ paidMinor: ils(3400) })] }))).toEqual([`receivable:r1:TAX_INVOICE:${ils(3400)}`]);
  });

  it('a non-shekel Owed is listed, not issuable', () => {
    const [item] = documentsDue(input({ receivables: [owed({ currency: 'USD' })] }));
    expect(item).toMatchObject({ issuable: false, reason: 'CURRENCY_NOT_ILS', currency: 'USD' });
  });

  it('an exempt dealer issues receipts only: an Owed is never due', () => {
    expect(kinds(input({ dealerType: 'EXEMPT', receivables: [owed()] }))).toEqual([]);
  });
});

describe('documentsDue: payments (Received)', () => {
  it('AC2: after the tax invoice, a payment of 1,000 is due a receipt for 1,000 on it, and a second payment its own receipt', () => {
    const r = owed({ documented: true, taxInvoiceId: 'd305', paidMinor: ils(1500) });
    const p1 = paid({ allocations: [{ receivableId: 'r1', amountMinor: ils(1000) }] });
    const p2 = paid({ id: 'p2', number: 'PAY-2026-0002', amountMinor: ils(500), receivedOn: '2026-11-20', allocations: [{ receivableId: 'r1', amountMinor: ils(500) }] });
    const items = documentsDue(input({ receivables: [r], payments: [p1, p2] }));
    expect(items.map((i) => [i.entry.id, i.kind, i.amountMinor, i.appliesToDocumentId, i.linkOnly])).toEqual([
      ['p1', 'RECEIPT', ils(1000), 'd305', true],
      ['p2', 'RECEIPT', ils(500), 'd305', true],
    ]);
  });

  it('tax invoice first: a payment allocated to an Owed with no tax invoice yet waits; the Owed is due its invoice (no double invoicing)', () => {
    const items = documentsDue(input({ receivables: [owed({ paidMinor: ils(1000) })], payments: [paid({ allocations: [{ receivableId: 'r1', amountMinor: ils(1000) }] })] }));
    expect(items.map((i) => `${i.entry.kind}:${i.kind}`)).toEqual(['receivable:TAX_INVOICE']);
  });

  it('tax invoice first: an unallocated payment from a client with an open tax invoice is due a receipt on it', () => {
    const r = owed({ documented: true, taxInvoiceId: 'd305' });
    const [item] = documentsDue(input({ receivables: [r], payments: [paid()] }));
    expect(item).toMatchObject({ kind: 'RECEIPT', appliesToDocumentId: 'd305', linkOnly: false, issuable: true });
  });

  it('tax invoice first: the open tax invoice must cover the payment, else an invoice-receipt is due', () => {
    const r = owed({ documented: true, taxInvoiceId: 'd305', grossMinor: ils(500) });
    expect(documentsDue(input({ receivables: [r], payments: [paid()] }))[0]?.kind).toBe('TAX_INVOICE_RECEIPT');
  });

  it('AC3: on payment, each payment, partial ones included, is due an invoice-receipt for its own amount', () => {
    const r = owed({ customerId: 'nour', paidMinor: ils(1700) });
    const items = documentsDue(input({
      receivables: [r],
      payments: [
        paid({ customerId: 'nour', amountMinor: ils(700), allocations: [{ receivableId: 'r1', amountMinor: ils(700) }] }),
        paid({ id: 'p2', customerId: 'nour', amountMinor: ils(1000) }),
      ],
    }));
    expect(items.map((i) => [i.entry.id, i.kind, i.amountMinor, i.linkOnly, i.issuable])).toEqual([
      ['p1', 'TAX_INVOICE_RECEIPT', ils(700), true, true],
      ['p2', 'TAX_INVOICE_RECEIPT', ils(1000), false, true],
    ]);
  });

  it('AC3: payment request first, a partial payment is due an invoice-receipt (the payment request is listed apart)', () => {
    const r = owed({ customerId: 'quds' });
    const items = documentsDue(input({ receivables: [r], payments: [paid({ customerId: 'quds', amountMinor: ils(700), allocations: [{ receivableId: 'r1', amountMinor: ils(700) }] })] }));
    expect(items.map((i) => `${i.entry.kind}:${i.kind}:${i.amountMinor}`)).toEqual([`receivable:PAYMENT_REQUEST:${ils(3400)}`, `payment:TAX_INVOICE_RECEIPT:${ils(700)}`]);
  });

  it('N1: money received with no client is due an invoice-receipt', () => {
    expect(documentsDue(input({ payments: [paid({ customerId: null })] }))[0]).toMatchObject({ kind: 'TAX_INVOICE_RECEIPT', customerId: null });
  });

  it('AC4: no document, and not for invoice (the payment or its Owed), are due nothing', () => {
    expect(kinds(input({ payments: [paid({ customerId: 'zaid' })] }))).toEqual([]);
    expect(kinds(input({ payments: [paid({ customerId: 'nour', notForInvoice: true })] }))).toEqual([]);
    const r = owed({ customerId: 'nour', notForInvoice: true });
    expect(kinds(input({ receivables: [r], payments: [paid({ customerId: 'nour', allocations: [{ receivableId: 'r1', amountMinor: ils(1000) }] })] }))).toEqual([]);
  });

  it('an issued or attached document settles the payment; a receipt number settles only a receipt', () => {
    expect(kinds(input({ payments: [paid({ customerId: 'nour', documented: true })] }))).toEqual([]);
    expect(kinds(input({ payments: [paid({ customerId: 'nour', externalInvoice: true })] }))).toEqual([]);
    expect(kinds(input({ payments: [paid({ customerId: 'nour', receiptNumber: 'R-17' })] }))).toEqual([`payment:p1:TAX_INVOICE_RECEIPT:${ils(1000)}`]);
    const r = owed({ documented: true, taxInvoiceId: 'd305' });
    expect(kinds(input({ receivables: [r], payments: [paid({ receiptNumber: 'R-17', allocations: [{ receivableId: 'r1', amountMinor: ils(1000) }] })] }))).toEqual([]);
  });

  it('an invoice attached to the Owed, then a payment: the payment is due a receipt with nothing to apply to', () => {
    const r = owed({ externalInvoice: true });
    const [item] = documentsDue(input({ receivables: [r], payments: [paid({ allocations: [{ receivableId: 'r1', amountMinor: ils(1000) }] })] }));
    expect(item).toMatchObject({ kind: 'RECEIPT', linkOnly: true, issuable: true });
    expect(item).not.toHaveProperty('appliesToDocumentId');
  });

  it('reversed payments and document-made payments are due nothing', () => {
    expect(kinds(input({ payments: [paid({ customerId: 'nour', status: 'REVERSED' })] }))).toEqual([]);
    expect(kinds(input({ payments: [paid({ customerId: 'nour', origin: 'ISSUED_DOCUMENT' })] }))).toEqual([]);
  });

  it('a payment split across Owed entries, all without documents, is one invoice-receipt issued linked only', () => {
    const rs = [owed({ customerId: 'nour' }), owed({ id: 'r2', customerId: 'nour' })];
    const [item] = documentsDue(input({ receivables: rs, payments: [paid({ customerId: 'nour', allocations: [{ receivableId: 'r1', amountMinor: ils(400) }, { receivableId: 'r2', amountMinor: ils(600) }] })] }));
    expect(item).toMatchObject({ kind: 'TAX_INVOICE_RECEIPT', amountMinor: ils(1000), linkOnly: true, issuable: true });
  });

  it('a payment split between an invoiced and an uninvoiced Owed is listed, not issuable', () => {
    const rs = [owed({ customerId: 'nour', documented: true, taxInvoiceId: 'd305' }), owed({ id: 'r2', customerId: 'nour' })];
    const [item] = documentsDue(input({ receivables: rs, payments: [paid({ customerId: 'nour', allocations: [{ receivableId: 'r1', amountMinor: ils(400) }, { receivableId: 'r2', amountMinor: ils(600) }] })] }));
    expect(item).toMatchObject({ issuable: false, reason: 'MIXED_ALLOCATION' });
  });

  it('a payment split between a not-for-invoice Owed and another is listed for its counted share, not issuable', () => {
    const rs = [owed({ customerId: 'nour', notForInvoice: true }), owed({ id: 'r2', customerId: 'nour' })];
    const [item] = documentsDue(input({ receivables: rs, payments: [paid({ customerId: 'nour', allocations: [{ receivableId: 'r1', amountMinor: ils(400) }, { receivableId: 'r2', amountMinor: ils(600) }] })] }));
    expect(item).toMatchObject({ amountMinor: ils(600), issuable: false, reason: 'MIXED_ALLOCATION' });
  });

  it('a payment recorded through the API or a connected app is listed, not issuable here', () => {
    expect(documentsDue(input({ payments: [paid({ customerId: 'nour', origin: 'INTEGRATION' })] }))[0]).toMatchObject({ issuable: false, reason: 'RECORDED_ELSEWHERE' });
  });

  it('a non-shekel payment is listed, not issuable', () => {
    expect(documentsDue(input({ payments: [paid({ customerId: 'nour', currency: 'USD' })] }))[0]).toMatchObject({ issuable: false, reason: 'CURRENCY_NOT_ILS', currency: 'USD' });
  });

  it('an exempt dealer: every counted payment is due a receipt, and a receipt number settles it', () => {
    expect(documentsDue(input({ dealerType: 'EXEMPT', payments: [paid({ customerId: 'nour' })] }))[0]).toMatchObject({ kind: 'RECEIPT', issuable: true });
    expect(kinds(input({ dealerType: 'EXEMPT', payments: [paid({ customerId: 'nour', receiptNumber: 'R-1' })] }))).toEqual([]);
    expect(kinds(input({ dealerType: 'EXEMPT', payments: [paid({ customerId: 'zaid' })] }))).toEqual([]);
  });
});

describe('documentsDue: order and the older-than filter', () => {
  it('groups by client (no client last), oldest first within a client', () => {
    const items = documentsDue(input({
      payments: [
        paid({ id: 'a', customerId: null, receivedOn: '2026-01-01' }),
        paid({ id: 'b', customerId: 'nour', receivedOn: '2026-11-19' }),
        paid({ id: 'c', customerId: 'nour', receivedOn: '2026-10-28' }),
      ],
      receivables: [owed({ id: 'r9', postingDate: '2026-11-02' })],
    }));
    expect(items.map((i) => i.entry.id)).toEqual(['c', 'b', 'r9', 'a']);
  });

  it('olderThan keeps items dated before today minus N months, month ends included', () => {
    const items = documentsDue(input({
      payments: [
        paid({ id: 'old', customerId: 'nour', receivedOn: '2026-05-21' }),
        paid({ id: 'edge', customerId: 'nour', receivedOn: '2026-05-22' }),
        paid({ id: 'new', customerId: 'nour', receivedOn: '2026-11-01' }),
      ],
    }));
    expect(olderThan(items, 6, '2026-11-22').map((i) => i.entry.id)).toEqual(['old']);
    expect(olderThan(items, 0, '2026-11-22')).toHaveLength(3);
    expect(olderThan(items.slice(0, 1), 3, '2026-05-31').map((i) => i.entry.id)).toEqual([]);
    expect(olderThan([{ ...items[0]!, date: '2026-02-27' }], 3, '2026-05-31').map((i) => i.date)).toEqual(['2026-02-27']);
  });
});
