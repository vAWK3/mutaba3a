import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { composeDocument, parseQuantity, type ComposeInput } from '../compose.js';
import { copyLabel } from '../copies.js';
import { standardVatRateOn } from '../vat-rate.js';
import { DOC_TYPE_CODES, ISSUED_DOC_TYPES, TAX_DOCUMENTS, VAT_BEARING } from '../types.js';

/** MUT-568: the issuing core's pure rules — line math, VAT, discounts and who may issue what. */

const shekels = (n: number): bigint => BigInt(Math.round(n * 100));

const base = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  docType: 'TAX_INVOICE',
  currency: 'ILS',
  documentDate: '2026-11-22',
  dealerType: 'COMPANY',
  documentDiscountMinor: 0n,
  pricesIncludeVat: false,
  lines: [{ description: 'Sprint 3', kind: 'SERVICE', quantityMilli: 40_000n, unitPriceMinor: shekels(450), discountMinor: 0n }],
  ...over,
});

const reason = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return ((err as ApiError).details as { reason?: unknown } | undefined)?.reason;
  }
  throw new Error('expected an ApiError');
};

describe('document type codes', () => {
  it('match the uniform file and the allocation API', () => {
    expect(DOC_TYPE_CODES).toEqual({ TAX_INVOICE: 305, TAX_INVOICE_RECEIPT: 320, CREDIT_NOTE: 330, RECEIPT: 400, PAYMENT_REQUEST: 300 });
    expect([...ISSUED_DOC_TYPES].sort()).toEqual(Object.keys(DOC_TYPE_CODES).sort());
  });
});

describe('standardVatRateOn', () => {
  it.each([
    ['2015-10-01', 1700],
    ['2024-12-31', 1700],
    ['2025-01-01', 1800],
    ['2026-11-22', 1800],
  ] as const)('%s → %i bp', (date, rate) => {
    expect(standardVatRateOn(date)).toBe(rate);
  });
});

describe('parseQuantity', () => {
  it.each([
    ['40', 40_000n],
    ['1.5', 1_500n],
    ['0.125', 125n],
  ] as const)('%s → %s milli', (text, milli) => {
    expect(parseQuantity(text)).toBe(milli);
  });

  it.each(['0', '-1', '1.2345', 'abc', ''])('refuses %j', (text) => {
    expect(reason(() => parseQuantity(text))).toBe('QUANTITY_INVALID');
  });
});

describe('composeDocument', () => {
  it('computes quantity × price, 18% VAT and the total', () => {
    const doc = composeDocument(base());
    expect(doc.subtotalMinor).toBe(shekels(18_000));
    expect(doc.netMinor).toBe(shekels(18_000));
    expect(doc.vatRateBasisPoints).toBe(1800);
    expect(doc.vatMinor).toBe(shekels(3_240));
    expect(doc.grossMinor).toBe(shekels(21_240));
    expect(doc.lines[0]!).toMatchObject({ index: 1, netMinor: shekels(18_000), vatMinor: shekels(3_240), vatRateBasisPoints: 1800 });
  });

  it('takes the line discount off the line and the document discount off the subtotal', () => {
    const doc = composeDocument(
      base({
        documentDiscountMinor: shekels(1_000),
        lines: [
          { description: 'App', kind: 'SERVICE', quantityMilli: 40_000n, unitPriceMinor: shekels(450), discountMinor: 0n },
          { description: 'API', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: shekels(6_500), discountMinor: 0n },
          { description: 'Hosting', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: shekels(1_300), discountMinor: shekels(100) },
        ],
      }),
    );
    expect(doc.subtotalMinor).toBe(shekels(25_700));
    expect(doc.discountMinor).toBe(shekels(1_000));
    expect(doc.netMinor).toBe(shekels(24_700));
    expect(doc.vatMinor).toBe(shekels(4_446));
    expect(doc.grossMinor).toBe(shekels(29_146));
    expect(doc.lines.map((l) => l.netMinor)).toEqual([shekels(18_000), shekels(6_500), shekels(1_200)]);
  });

  it('spreads the document VAT over the lines so the lines always add up to the document', () => {
    const doc = composeDocument(
      base({
        documentDiscountMinor: 1n,
        lines: [1, 2, 3].map((i) => ({ description: `L${i}`, kind: 'GOODS' as const, quantityMilli: 1_000n, unitPriceMinor: 333n, discountMinor: 0n })),
      }),
    );
    expect(doc.lines.reduce((sum, l) => sum + l.vatMinor, 0n)).toBe(doc.vatMinor);
  });

  it('rounds VAT half up on the document net', () => {
    const doc = composeDocument(base({ lines: [{ description: 'x', kind: 'GOODS', quantityMilli: 1_000n, unitPriceMinor: 25n, discountMinor: 0n }] }));
    expect(doc.vatMinor).toBe(5n); // 25 × 18% = 4.5 → 5
  });

  it('rounds a fractional quantity × price half up to the agora', () => {
    const doc = composeDocument(base({ lines: [{ description: 'x', kind: 'GOODS', quantityMilli: 1_500n, unitPriceMinor: 333n, discountMinor: 0n }] }));
    expect(doc.lines[0]!.netMinor).toBe(500n); // 499.5 → 500
  });

  it('charges no VAT on a receipt', () => {
    const doc = composeDocument(base({ docType: 'RECEIPT' }));
    expect(doc.vatMinor).toBe(0n);
    expect(doc.vatRateBasisPoints).toBe(0);
    expect(doc.grossMinor).toBe(doc.netMinor);
  });

  it('lets an exempt dealer issue only receipts, without VAT', () => {
    expect(reason(() => composeDocument(base({ dealerType: 'EXEMPT' })))).toBe('EXEMPT_DEALER_TAX_INVOICE');
    expect(reason(() => composeDocument(base({ dealerType: 'EXEMPT', docType: 'TAX_INVOICE_RECEIPT' })))).toBe('EXEMPT_DEALER_TAX_INVOICE');
    expect(reason(() => composeDocument(base({ dealerType: 'EXEMPT', docType: 'CREDIT_NOTE' })))).toBe('EXEMPT_DEALER_TAX_INVOICE');
    expect(composeDocument(base({ dealerType: 'EXEMPT', docType: 'RECEIPT' })).vatMinor).toBe(0n);
  });

  it('issues in shekels only', () => {
    expect(reason(() => composeDocument(base({ currency: 'USD' })))).toBe('CURRENCY_NOT_SUPPORTED');
  });

  it('refuses no lines, too many lines and a blank description', () => {
    expect(reason(() => composeDocument(base({ lines: [] })))).toBe('LINES_REQUIRED');
    const line = base().lines[0]!;
    expect(reason(() => composeDocument(base({ lines: Array.from({ length: 201 }, () => line) })))).toBe('TOO_MANY_LINES');
    expect(reason(() => composeDocument(base({ lines: [{ ...line, description: '  ' }] })))).toBe('DESCRIPTION_REQUIRED');
  });

  it('refuses a negative price, a discount above its line and one above the subtotal', () => {
    const line = base().lines[0]!;
    expect(reason(() => composeDocument(base({ lines: [{ ...line, unitPriceMinor: -1n }] })))).toBe('AMOUNT_INVALID');
    expect(reason(() => composeDocument(base({ lines: [{ ...line, discountMinor: shekels(18_001) }] })))).toBe('DISCOUNT_INVALID');
    expect(reason(() => composeDocument(base({ documentDiscountMinor: shekels(18_001) })))).toBe('DISCOUNT_INVALID');
  });

  it('refuses a document whose total is zero', () => {
    const line = base().lines[0]!;
    expect(reason(() => composeDocument(base({ lines: [{ ...line, unitPriceMinor: 0n }] })))).toBe('TOTAL_NOT_POSITIVE');
  });
});

describe('composeDocument: prices that include VAT (V1-a)', () => {
  const line = (unit: number, over: Partial<ComposeInput['lines'][number]> = {}) => ({ description: 'x', kind: 'SERVICE' as const, quantityMilli: 1_000n, unitPriceMinor: shekels(unit), discountMinor: 0n, ...over });

  it('takes the VAT out of an inclusive invoice so the customer pays exactly the typed total', () => {
    const doc = composeDocument(base({ pricesIncludeVat: true, lines: [line(1_180)] }));
    expect(doc).toMatchObject({ netMinor: shekels(1_000), vatMinor: shekels(180), grossMinor: shekels(1_180), pricesIncludeVat: true });
    const odd = composeDocument(base({ pricesIncludeVat: true, lines: [line(100), line(33.33), line(0.07)] }));
    expect(odd.grossMinor).toBe(shekels(133.4));
    expect(odd.netMinor + odd.vatMinor).toBe(odd.grossMinor);
  });

  it('lets a line override the invoice: an exclusive line on an inclusive invoice, and the other way round', () => {
    const mixed = composeDocument(base({ pricesIncludeVat: true, lines: [line(1_180), line(1_000, { pricesIncludeVat: false })] }));
    expect(mixed).toMatchObject({ netMinor: shekels(2_000), vatMinor: shekels(360), grossMinor: shekels(2_360) });
    expect(mixed.lines.map((l) => l.pricesIncludeVat)).toEqual([true, false]);
    const other = composeDocument(base({ pricesIncludeVat: false, lines: [line(1_000), line(1_180, { pricesIncludeVat: true })] }));
    expect(other).toMatchObject({ netMinor: shekels(2_000), vatMinor: shekels(360), grossMinor: shekels(2_360) });
  });

  it('charges no VAT on a VAT-exempt line', () => {
    const doc = composeDocument(base({ lines: [line(1_000), line(250, { vatExempt: true })] }));
    expect(doc).toMatchObject({ netMinor: shekels(1_250), vatMinor: shekels(180), grossMinor: shekels(1_430) });
    expect(doc.lines[1]).toMatchObject({ vatRateBasisPoints: 0, vatMinor: 0n, vatExempt: true });
  });

  it('spreads an inclusive document discount over the lines in each line\'s own terms', () => {
    const doc = composeDocument(base({ pricesIncludeVat: true, documentDiscountMinor: shekels(118), lines: [line(1_180)] }));
    expect(doc).toMatchObject({ subtotalMinor: shekels(1_000), discountMinor: shekels(100), netMinor: shekels(900), vatMinor: shekels(162), grossMinor: shekels(1_062) });
  });

  it('always adds up: line nets and VAT sum to the document', () => {
    const doc = composeDocument(base({ pricesIncludeVat: true, documentDiscountMinor: 7n, lines: [line(99.99), line(12.34, { pricesIncludeVat: false }), line(5, { vatExempt: true })] }));
    expect(doc.lines.reduce((s, l) => s + l.vatMinor, 0n)).toBe(doc.vatMinor);
    expect(doc.subtotalMinor - doc.discountMinor).toBe(doc.netMinor);
    expect(doc.netMinor + doc.vatMinor).toBe(doc.grossMinor);
  });
});

describe('composeDocument: review fixes', () => {
  const line = (unit: number, over: Partial<ComposeInput['lines'][number]> = {}) => ({ description: 'x', kind: 'SERVICE' as const, quantityMilli: 1_000n, unitPriceMinor: shekels(unit), discountMinor: 0n, ...over });

  it('a credit note uses its tax invoice\'s rate, not the rate of its own date', () => {
    const doc = composeDocument(base({ docType: 'CREDIT_NOTE', documentDate: '2025-01-05', vatRateBasisPoints: 1700, lines: [line(1_000)] }));
    expect(doc).toMatchObject({ vatRateBasisPoints: 1700, vatMinor: shekels(170) });
  });

  it('refuses a document discount above the subtotal in the document\'s own terms, never capping it silently', () => {
    expect(reason(() => composeDocument(base({ documentDiscountMinor: shekels(201), lines: [line(118, { pricesIncludeVat: true }), line(100)] })))).toBe('DISCOUNT_INVALID');
    const ok = composeDocument(base({ documentDiscountMinor: shekels(190), lines: [line(118, { pricesIncludeVat: true }), line(100)] }));
    expect(ok.discountMinor).toBe(shekels(190));
  });
});

describe('copyLabel', () => {
  it('reads ORIGINAL on the first copy only', () => {
    expect([0, 1, 2, 3].map(copyLabel)).toEqual(['ORIGINAL', 'COPY', 'COPY', 'COPY']);
  });
});

describe('MUT-662: payment request', () => {
  it('a licensed dealer\'s request carries VAT like a tax invoice, so the invoice-receipts that follow match it', () => {
    const doc = composeDocument(base({ docType: 'PAYMENT_REQUEST', dealerType: 'LICENSED' }));
    expect(doc.vatRateBasisPoints).toBe(1800);
    expect(doc.grossMinor).toBe(shekels(18000 * 1.18));
  });

  it('an exempt dealer may issue one, at rate 0; a tax invoice is still refused', () => {
    const doc = composeDocument(base({ docType: 'PAYMENT_REQUEST', dealerType: 'EXEMPT' }));
    expect(doc.vatRateBasisPoints).toBe(0);
    expect(doc.vatMinor).toBe(0n);
    expect(doc.grossMinor).toBe(shekels(18000));
    expect(reason(() => composeDocument(base({ dealerType: 'EXEMPT' })))).toBe('EXEMPT_DEALER_TAX_INVOICE');
  });

  it('is not a tax document: VAT and tax totals leave it out', () => {
    expect(TAX_DOCUMENTS.has('PAYMENT_REQUEST')).toBe(false);
    expect(VAT_BEARING.has('PAYMENT_REQUEST')).toBe(true);
  });
});
