import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { composeDocument, parseQuantity, type ComposeInput } from '../compose.js';
import { copyLabel } from '../copies.js';
import { standardVatRateOn } from '../vat-rate.js';
import { DOC_TYPE_CODES, ISSUED_DOC_TYPES } from '../types.js';

/** MUT-568: the issuing core's pure rules — line math, VAT, discounts and who may issue what. */

const shekels = (n: number): bigint => BigInt(Math.round(n * 100));

const base = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  docType: 'TAX_INVOICE',
  currency: 'ILS',
  documentDate: '2026-11-22',
  dealerType: 'COMPANY',
  documentDiscountMinor: 0n,
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
    expect(DOC_TYPE_CODES).toEqual({ TAX_INVOICE: 305, TAX_INVOICE_RECEIPT: 320, CREDIT_NOTE: 330, RECEIPT: 400 });
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

describe('copyLabel', () => {
  it('reads ORIGINAL on the first copy only', () => {
    expect([0, 1, 2, 3].map(copyLabel)).toEqual(['ORIGINAL', 'COPY', 'COPY', 'COPY']);
  });
});
