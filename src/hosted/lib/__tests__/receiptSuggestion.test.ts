import { describe, expect, it } from 'vitest';
import { HOSTED_CURRENCIES } from '../../format/currencies';
import { isoExponent, minorDigitsToDecimal, suggestionToFormValues, type ReceiptSuggestion } from '../receiptSuggestion';

const field = <T,>(value: T, confidence = 0.9) => ({ value, source: 'qr' as const, confidence });
const read = (extra: Partial<ReceiptSuggestion>): ReceiptSuggestion => ({ readerVersion: 'phone-1', ...extra });
const prefill = (s: ReceiptSuggestion | null, firm = false) => suggestionToFormValues(s, { currencies: HOSTED_CURRENCIES, firm });

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
    expect(prefill(null)).toEqual({ values: {}, prefilled: {}, unsupported: null, vatRead: null });
    expect(prefill(read({}))).toEqual({ values: {}, prefilled: {}, unsupported: null, vatRead: null });
  });

  it('ignores VAT on a non-firm profile (OV1), registration number, phone and email, and a zero total', () => {
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

  describe('VAT on a firm profile (MUT-302)', () => {
    it('a read rate prefills Standard at that rate and hints it', () => {
      const out = prefill(read({ vatRateBasisPoints: field(1700, 0.8), vatMinor: field('1700'), totalMinor: field('11700'), currency: field('ILS') }), true);
      expect(out.values).toMatchObject({ vatTreatment: 'STANDARD_RATED', vatRate: '17' });
      expect(out.prefilled.vat).toBe(0.8);
      expect(out.vatRead).toBeNull();
    });

    it('a fractional rate keeps its decimals', () => {
      expect(prefill(read({ vatRateBasisPoints: field(1750) }), true).values).toEqual({ vatTreatment: 'STANDARD_RATED', vatRate: '17.5' });
    });

    it('D6: a VAT amount without a rate prefills nothing and only says what the receipt read', () => {
      const out = prefill(read({ vatMinor: field('1700'), totalMinor: field('11700'), currency: field('ILS') }), true);
      expect(out.values).not.toHaveProperty('vatTreatment');
      expect(out.prefilled).not.toHaveProperty('vat');
      expect(out.vatRead).toBe('17.00');
    });

    it('OV5: a read rate of 0 prefills nothing (an unsavable Standard form), only the hint', () => {
      const out = prefill(read({ vatRateBasisPoints: field(0), vatMinor: field('0'), currency: field('ILS') }), true);
      expect(out.values).toEqual({ currency: 'ILS' });
      expect(out.vatRead).toBe('0.00');
    });

    it('a VAT amount in a currency the form doesn\'t offer is not hinted (its digits are unknown to the form)', () => {
      expect(prefill(read({ vatMinor: field('1700'), currency: field('BHD') }), true).vatRead).toBeNull();
    });
  });
});
