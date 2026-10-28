import { describe, expect, it } from 'vitest';
import { carriedReceiptNumber, normalizeReceiptNumber, RECEIPT_NUMBER_MAX } from '../receipt-number.js';

describe('normalizeReceiptNumber (D3)', () => {
  it('trims and keeps any script, digits and separators', () => {
    expect(normalizeReceiptNumber('  2041 ')).toEqual({ ok: true, value: '2041' });
    expect(normalizeReceiptNumber('קבלה 2041/26')).toEqual({ ok: true, value: 'קבלה 2041/26' });
    expect(normalizeReceiptNumber('إيصال-٢٠٤١')).toEqual({ ok: true, value: 'إيصال-٢٠٤١' });
  });

  it('null means none', () => {
    expect(normalizeReceiptNumber(null)).toEqual({ ok: true, value: null });
  });

  it('allows 64 characters after trimming and refuses 65', () => {
    expect(normalizeReceiptNumber(` ${'9'.repeat(RECEIPT_NUMBER_MAX)} `)).toEqual({ ok: true, value: '9'.repeat(64) });
    expect(normalizeReceiptNumber('9'.repeat(RECEIPT_NUMBER_MAX + 1))).toEqual({ ok: false });
  });

  it('refuses empty, whitespace-only and control characters', () => {
    for (const bad of ['', '   ', '\t', '20\n41', '20\u000041', 'A\u007fB']) expect(normalizeReceiptNumber(bad)).toEqual({ ok: false });
  });
});

describe('carriedReceiptNumber (D1)', () => {
  const replaced = { receiptNumber: '2041' };

  it('a correction that leaves the field out keeps the replaced payment’s number', () => {
    expect(carriedReceiptNumber({ given: undefined, replaced })).toEqual({ value: '2041', carried: true });
  });

  it('a correction that says null clears it, and one that gives a number changes it', () => {
    expect(carriedReceiptNumber({ given: null, replaced })).toEqual({ value: null, carried: false });
    expect(carriedReceiptNumber({ given: '2042', replaced })).toEqual({ value: '2042', carried: false });
  });

  it('a new payment without the field has none', () => {
    expect(carriedReceiptNumber({ given: undefined, replaced: null })).toEqual({ value: null, carried: false });
    expect(carriedReceiptNumber({ given: undefined, replaced: { receiptNumber: null } })).toEqual({ value: null, carried: false });
  });
});
