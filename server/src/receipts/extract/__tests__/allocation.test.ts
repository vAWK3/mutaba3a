import { describe, expect, it } from 'vitest';
import type { ReceiptSuggestion } from '../../../repositories/ports.js';
import { extractReceipt } from '../extract.js';
import { expectsAllocationNumber, fillAbsent, isCompleteSuggestion } from '../merge.js';
import { receipt, REG_VALID_COMPANY } from './fixtures.js';

/** MUT-557 (D2, D3): the allocation number is read only beside its label, and a big ILS invoice without one is not complete. */

const READER = 'test-1';
const ALLOCATION = '304512876';
const allocation = (lines: ReturnType<typeof receipt>) => extractReceipt({ lines }, { readerVersion: READER }).allocationNumber?.value;

describe('reading the allocation number (D2)', () => {
  it.each([
    ['Hebrew label, same row', [`מספר הקצאה: ${ALLOCATION}`]],
    ['abbreviated with a geresh', [`מס' הקצאה ${ALLOCATION}`]],
    ['abbreviated with a Hebrew geresh', [`מס׳ הקצאה ${ALLOCATION}`]],
    ['English', [`Allocation No. ${ALLOCATION}`]],
    ['English, number spelled out', [`Allocation number: ${ALLOCATION}`]],
    ['Arabic', [`رقم التخصيص ${ALLOCATION}`]],
    ['the number on the row under its label', ['מספר הקצאה', ALLOCATION]],
    ['right to left: the number box before the label', [[{ text: ALLOCATION, x: 10 }, { text: 'מספר הקצאה', x: 250, script: 'hebr' }]]],
  ] as const)('%s', (_label, rows) => {
    expect(allocation(receipt(['ספק בע"מ', ...rows, 'סה"כ 100.00']))).toBe(ALLOCATION);
  });

  it('never takes a bare nine-digit number (a ח.פ or ע.מ looks the same)', () => {
    expect(allocation(receipt(['ספק בע"מ', ALLOCATION, 'סה"כ 100.00']))).toBeUndefined();
  });

  it('a registration number beside the label is not the allocation number', () => {
    expect(allocation(receipt(['ספק בע"מ', `ח.פ ${REG_VALID_COMPANY} מספר הקצאה ${ALLOCATION}`, 'סה"כ 100.00']))).toBe(ALLOCATION);
    expect(allocation(receipt(['ספק בע"מ', `מספר הקצאה ${ALLOCATION} ח.פ ${REG_VALID_COMPANY}`, 'סה"כ 100.00']))).toBe(ALLOCATION);
  });

  it('the row under the label is not read when it is a registration row', () => {
    expect(allocation(receipt(['ספק בע"מ', 'מספר הקצאה', `ח.פ ${REG_VALID_COMPANY}`, 'סה"כ 100.00']))).toBeUndefined();
  });

  it('eight or ten digits are not an allocation number', () => {
    expect(allocation(receipt([`מספר הקצאה ${ALLOCATION.slice(1)}`]))).toBeUndefined();
    expect(allocation(receipt([`מספר הקצאה ${ALLOCATION}1`]))).toBeUndefined();
  });

  it("never from a bill-to block's rows", () => {
    expect(allocation(receipt(['ספק בע"מ', `לכבוד משרד עורכי דין מספר הקצאה ${ALLOCATION}`, 'סה"כ 100.00']))).toBeUndefined();
  });

  it('reads a PDF text layer as pdf-text', () => {
    const s = extractReceipt({ pdfText: `ספק בע"מ\nמספר הקצאה ${ALLOCATION}\nסה"כ 100.00` }, { readerVersion: READER });
    expect(s.allocationNumber).toMatchObject({ value: ALLOCATION, source: 'pdf-text' });
  });

  it('an unsure row is left out', () => {
    expect(allocation(receipt([{ text: `מספר הקצאה ${ALLOCATION}`, conf: 0.4 }]))).toBeUndefined();
  });
});

const field = <T>(value: T) => ({ value, source: 'ocr' as const, confidence: 0.9 });
/** Every SUGGESTION_FIELDS member, an ILS invoice of ₪6,000 + ₪1,080 VAT on 2026-07-01. */
const big: ReceiptSuggestion = {
  readerVersion: 'phone-1',
  date: field('2026-07-01'),
  totalMinor: field('708000'),
  currency: field('ILS'),
  vatMinor: field('108000'),
  vatRateBasisPoints: field(1800),
  vendorName: field('ספק'),
  registrationNo: field(REG_VALID_COMPANY),
  phone: field('03-5555555'),
  email: field('a@b.co'),
};

describe('completeness (D3)', () => {
  it('a big ILS invoice with VAT and no number is not complete: the server reads it for the number', () => {
    expect(expectsAllocationNumber(big)).toBe(true);
    expect(isCompleteSuggestion(big)).toBe(false);
  });
  it('with the number it is complete', () => {
    expect(isCompleteSuggestion({ ...big, allocationNumber: field(ALLOCATION) })).toBe(true);
  });
  it('under the threshold it is complete without one', () => {
    expect(isCompleteSuggestion({ ...big, totalMinor: field('59000'), vatMinor: field('9000') })).toBe(true);
  });
  it('another currency is complete without one', () => {
    expect(isCompleteSuggestion({ ...big, currency: field('USD') })).toBe(true);
  });
  it('fillAbsent fills the number like any other field, and never replaces it', () => {
    const { merged, added } = fillAbsent(big, { readerVersion: 'server-ocr-3', allocationNumber: field(ALLOCATION) });
    expect(merged.allocationNumber?.value).toBe(ALLOCATION);
    expect(added).toEqual(['allocationNumber']);
    expect(fillAbsent(merged, { readerVersion: 'x', allocationNumber: field('111111111') }).added).toEqual([]);
  });
});
