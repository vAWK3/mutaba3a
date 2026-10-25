import { describe, expect, it } from 'vitest';
import { HOSTED_CURRENCIES } from '../../format/currencies';
import { isoExponent, minorDigitsToDecimal, suggestionToFormValues, type ReceiptSuggestion } from '../receiptSuggestion';

const field = <T,>(value: T, confidence = 0.9) => ({ value, source: 'qr' as const, confidence });
const read = (extra: Partial<ReceiptSuggestion>): ReceiptSuggestion => ({ readerVersion: 'phone-1', ...extra });
const prefill = (s: ReceiptSuggestion | null) => suggestionToFormValues(s, { currencies: HOSTED_CURRENCIES });

describe('suggestionToFormValues (MUT-260 D7)', () => {
  it('JOD keeps three decimals', () => {
    const out = prefill(read({ totalMinor: field('45678'), currency: field('JOD') }));
    expect(out.values).toEqual({ amount: '45.678', currency: 'JOD' });
    expect(Object.keys(out.prefilled).sort()).toEqual(['amount', 'currency']);
  });

  it('ILS has two decimals, and small totals keep their leading zero', () => {
    expect(prefill(read({ totalMinor: field('8420'), currency: field('ILS') })).values.amount).toBe('84.20');
    expect(prefill(read({ totalMinor: field('5'), currency: field('USD') })).values.amount).toBe('0.05');
  });

  it('maps the date, the vendor and every field\'s confidence, whatever the source', () => {
    const out = prefill(read({ date: field('2026-10-24', 0.3), vendorName: { value: 'Shufersal', source: 'ocr', confidence: 0.4 }, totalMinor: field('1000'), currency: field('EUR', 0.2) }));
    expect(out.values).toEqual({ occurredAt: '2026-10-24', vendor: 'Shufersal', amount: '10.00', currency: 'EUR' });
    expect(out.prefilled).toEqual({ date: 0.3, vendor: 0.4, amount: 0.9, currency: 0.2 });
    expect(out.unsupported).toBeNull();
  });

  it('an unsupported currency fills neither currency nor amount, and says what the receipt read (A13/A14)', () => {
    const out = prefill(read({ totalMinor: field('12345'), currency: field('BHD') }));
    expect(out.values).toEqual({});
    expect(out.prefilled).toEqual({});
    expect(out.unsupported).toEqual({ currency: 'BHD', amount: '12.345' });
  });

  it('a total with no currency fills nothing; a currency with no total fills only the currency', () => {
    expect(prefill(read({ totalMinor: field('8420') })).values).toEqual({});
    expect(prefill(read({ currency: field('ILS') })).values).toEqual({ currency: 'ILS' });
  });

  it('a date only, and nothing at all', () => {
    expect(prefill(read({ date: field('2026-10-01') })).values).toEqual({ occurredAt: '2026-10-01' });
    expect(prefill(null)).toEqual({ values: {}, prefilled: {}, unsupported: null });
    expect(prefill(read({}))).toEqual({ values: {}, prefilled: {}, unsupported: null });
  });

  it('ignores VAT, registration number, phone and email, and a zero total', () => {
    const out = prefill(read({ vatMinor: field('100'), vatRateBasisPoints: field(1700), registrationNo: field('5123'), phone: field('03-1'), email: field('a@b.c'), totalMinor: field('0'), currency: field('ILS') }));
    expect(out.values).toEqual({ currency: 'ILS' });
  });
});

describe('minor-unit helpers', () => {
  it('splits digits at the exponent', () => {
    expect(minorDigitsToDecimal('100', 0)).toBe('100');
    expect(minorDigitsToDecimal('1', 3)).toBe('0.001');
    expect(minorDigitsToDecimal('123456789012345678', 2)).toBe('1234567890123456.78');
  });
  it('knows ISO exponents and refuses a malformed code', () => {
    expect(isoExponent('JPY')).toBe(0);
    expect(isoExponent('KWD')).toBe(3);
    expect(isoExponent('X1')).toBeNull();
  });
});
