import { describe, expect, it } from 'vitest';
import { splitIncome, splitPayment, type IncomeClassContext, type ClassPaymentInput } from '../invoice-class.js';

/** MUT-660: Invoice income vs Not for invoice. Every payment's money lands in exactly one of the two, per currency. */

const ils = (n: number): bigint => BigInt(Math.round(n * 100));

const ctx = (over: Partial<IncomeClassContext> = {}): IncomeClassContext => ({
  defaultPreference: 'ON_PAYMENT',
  preferences: new Map([['nour', null], ['zaid', 'NO_DOCUMENT']]),
  receivables: new Map([
    ['r1', { customerId: 'nour', notForInvoice: false }],
    ['r2', { customerId: 'nour', notForInvoice: true }],
    ['r3', { customerId: 'zaid', notForInvoice: false }],
  ]),
  ...over,
});

const pay = (over: Partial<ClassPaymentInput> = {}): ClassPaymentInput => ({
  currency: 'ILS',
  amountMinor: ils(1000),
  customerId: 'nour',
  origin: 'CAPTURE',
  notForInvoice: false,
  documented: false,
  externalInvoice: false,
  allocations: [],
  ...over,
});

describe('splitPayment', () => {
  it('ordinary money counts as invoice income, issued yet or not', () => {
    expect(splitPayment(pay(), ctx())).toEqual({ invoiceMinor: ils(1000), notForInvoiceMinor: 0n });
  });

  it('the payment\'s own mark, and a No document client, put it outside invoice income', () => {
    expect(splitPayment(pay({ notForInvoice: true }), ctx())).toEqual({ invoiceMinor: 0n, notForInvoiceMinor: ils(1000) });
    expect(splitPayment(pay({ customerId: 'zaid' }), ctx())).toEqual({ invoiceMinor: 0n, notForInvoiceMinor: ils(1000) });
  });

  it('a linked or attached document, or a document-made payment, is invoice income whatever the marks say', () => {
    for (const over of [{ documented: true }, { externalInvoice: true }, { origin: 'ISSUED_DOCUMENT' as const }]) {
      expect(splitPayment(pay({ notForInvoice: true, customerId: 'zaid', ...over }), ctx())).toEqual({ invoiceMinor: ils(1000), notForInvoiceMinor: 0n });
    }
  });

  it('an allocated share follows its Owed (marked, or a No document client); the unallocated rest follows the payment', () => {
    const p = pay({ allocations: [{ receivableId: 'r1', amountMinor: ils(300) }, { receivableId: 'r2', amountMinor: ils(200) }, { receivableId: 'r3', amountMinor: ils(100) }] });
    expect(splitPayment(p, ctx())).toEqual({ invoiceMinor: ils(300 + 400), notForInvoiceMinor: ils(200 + 100) });
  });

  it('an allocation to an Owed it can\'t see counts as invoice income', () => {
    expect(splitPayment(pay({ allocations: [{ receivableId: 'gone', amountMinor: ils(1000) }] }), ctx())).toEqual({ invoiceMinor: ils(1000), notForInvoiceMinor: 0n });
  });
});

describe('splitIncome', () => {
  it('AC9: all income = invoice income + not for invoice, per currency, never summed across currencies', () => {
    const rows = splitIncome([pay(), pay({ notForInvoice: true, amountMinor: ils(250) }), pay({ currency: 'USD', amountMinor: ils(90) }), pay({ currency: 'USD', customerId: 'zaid', amountMinor: ils(10) })], ctx());
    expect(rows).toEqual([
      { currency: 'ILS', invoiceMinor: ils(1000), notForInvoiceMinor: ils(250), allMinor: ils(1250) },
      { currency: 'USD', invoiceMinor: ils(90), notForInvoiceMinor: ils(10), allMinor: ils(100) },
    ]);
  });

  it('AC9 property: for random payments and allocations the split always reconciles to the total', () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    for (let run = 0; run < 200; run++) {
      const payments = Array.from({ length: 1 + rand(8) }, () => {
        const amount = BigInt(1 + rand(100000));
        const a1 = BigInt(rand(Number(amount) + 1));
        const a2 = BigInt(rand(Number(amount - a1) + 1));
        return pay({
          currency: ['ILS', 'USD', 'EUR'][rand(3)]!,
          amountMinor: amount,
          customerId: [null, 'nour', 'zaid'][rand(3)]!,
          notForInvoice: rand(4) === 0,
          documented: rand(5) === 0,
          allocations: [{ receivableId: ['r1', 'r2', 'r3', 'gone'][rand(4)]!, amountMinor: a1 }, { receivableId: ['r1', 'r2', 'r3'][rand(3)]!, amountMinor: a2 }],
        });
      });
      for (const row of splitIncome(payments, ctx())) {
        const total = payments.filter((p) => p.currency === row.currency).reduce((s, p) => s + p.amountMinor, 0n);
        expect(row.invoiceMinor + row.notForInvoiceMinor).toBe(row.allMinor);
        expect(row.allMinor).toBe(total);
        expect(row.invoiceMinor >= 0n && row.notForInvoiceMinor >= 0n).toBe(true);
      }
    }
  });
});

describe('invoiceStatusOf (exports)', () => {
  it('issued, not for invoice (own mark or every Owed marked), no document, else due', async () => {
    const { invoiceStatusOf } = await import('../invoice-class.js');
    expect(invoiceStatusOf(pay({ documented: true, notForInvoice: true }), ctx())).toBe('issued');
    expect(invoiceStatusOf(pay({ origin: 'ISSUED_DOCUMENT' }), ctx())).toBe('issued');
    expect(invoiceStatusOf(pay({ notForInvoice: true }), ctx())).toBe('not_for_invoice');
    expect(invoiceStatusOf(pay({ allocations: [{ receivableId: 'r2', amountMinor: ils(1000) }] }), ctx())).toBe('not_for_invoice');
    expect(invoiceStatusOf(pay({ customerId: 'zaid' }), ctx())).toBe('no_document');
    expect(invoiceStatusOf(pay({ customerId: null, allocations: [{ receivableId: 'r3', amountMinor: ils(1000) }] }), ctx())).toBe('no_document');
    expect(invoiceStatusOf(pay(), ctx())).toBe('due');
  });
});
