import { describe, expect, it } from 'vitest';
import { vendorDefaultFills, type VendorDefaults } from '../vendorDefaults';

/** MUT-303 (plan §3, R4–R6): a vendor's last currency and VAT fill only fields that are empty, unread and unedited. */
describe('vendorDefaultFills', () => {
  const eur16: VendorDefaults = { currency: 'EUR', vat: { treatment: 'STANDARD_RATED', rateBasisPoints: 1600 } };
  const blank = { currency: 'ILS' as const, amount: '', vatTreatment: '' as const };
  const open = { currency: false, vat: false };

  it('fills currency and VAT on a fresh firm form', () => {
    expect(vendorDefaultFills(eur16, blank, open, true)).toEqual({ currency: 'EUR', vatTreatment: 'STANDARD_RATED', vatRate: '16' });
  });

  it('a non-standard treatment carries no rate', () => {
    expect(vendorDefaultFills({ currency: null, vat: { treatment: 'EXEMPT', rateBasisPoints: 0 } }, blank, open, true)).toEqual({ vatTreatment: 'EXEMPT', vatRate: '' });
  });

  it('R6: no currency once an amount is typed (it would re-read the typed number)', () => {
    expect(vendorDefaultFills(eur16, { ...blank, amount: '100' }, open, true)).toEqual({ vatTreatment: 'STANDARD_RATED', vatRate: '16' });
  });

  it('R5: what the receipt read or the person changed is never replaced', () => {
    expect(vendorDefaultFills(eur16, blank, { currency: true, vat: false }, true)).toEqual({ vatTreatment: 'STANDARD_RATED', vatRate: '16' });
    expect(vendorDefaultFills(eur16, blank, { currency: false, vat: true }, true)).toEqual({ currency: 'EUR' });
  });

  it('a VAT row that already records VAT keeps it', () => {
    expect(vendorDefaultFills(eur16, { ...blank, vatTreatment: 'ZERO_RATED' }, open, true)).toEqual({ currency: 'EUR' });
  });

  it('R10: no VAT off firm profiles', () => {
    expect(vendorDefaultFills(eur16, blank, open, false)).toEqual({ currency: 'EUR' });
  });

  it('nothing when there are no defaults, or the currency is already the vendor’s', () => {
    expect(vendorDefaultFills(null, blank, open, true)).toEqual({});
    expect(vendorDefaultFills({ currency: 'ILS', vat: null }, blank, open, true)).toEqual({});
  });
});
