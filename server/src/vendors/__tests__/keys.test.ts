import { describe, expect, it } from 'vitest';
import { registrationKey, scoreVendorName, vendorNameKey } from '../keys.js';

/** MUT-254: the keys a typed vendor is matched by (exact on save, V1) and the typeahead's scorer. */
describe('vendorNameKey', () => {
  it('folds case, spacing and punctuation', () => {
    expect(vendorNameKey('  Super   DEAL!! ')).toBe('super deal');
    expect(vendorNameKey('super-deal')).toBe('super deal');
    expect(vendorNameKey('super_deal.')).toBe('super deal');
    expect(vendorNameKey('H&M')).toBe(vendorNameKey('H & M'));
  });

  it('folds Arabic letter forms, tashkeel, tatweel and Arabic punctuation', () => {
    expect(vendorNameKey('مخبز الأقصى')).toBe(vendorNameKey('مخبز الاقصى'));
    expect(vendorNameKey('صيدلية الشفاء')).toBe(vendorNameKey('صيدليه الشفاء'));
    expect(vendorNameKey('مقهى المدينة')).toBe(vendorNameKey('مقهي المدينه'));
    expect(vendorNameKey('سوبرماركـــت النُّور')).toBe(vendorNameKey('سوبرماركت النور'));
    expect(vendorNameKey('النور، للتجارة؛')).toBe('النور للتجاره');
  });

  it('keeps Arabic "ال" (part of the name) and strips only an English leading "the"', () => {
    expect(vendorNameKey('النور')).toBe('النور');
    expect(vendorNameKey('The Coffee House')).toBe('coffee house');
  });

  it('strips one trailing legal suffix in Latin, Hebrew and Arabic', () => {
    expect(vendorNameKey('Acme Ltd')).toBe('acme');
    expect(vendorNameKey('Acme, Inc.')).toBe('acme');
    expect(vendorNameKey('Acme GmbH')).toBe('acme');
    expect(vendorNameKey('סופר דיל בע"מ')).toBe('סופר דיל');
    expect(vendorNameKey('סופר דיל בע״מ')).toBe('סופר דיל');
    expect(vendorNameKey('سامح مول ش.م.م')).toBe('سامح مول');
    expect(vendorNameKey('سامح مول ذ.م.م')).toBe('سامح مول');
  });

  it('never strips a name down to nothing', () => {
    expect(vendorNameKey('Company')).toBe('company');
    expect(vendorNameKey('SA')).toBe('sa');
    expect(vendorNameKey('The Inc')).toBe('inc');
    expect(vendorNameKey('The')).toBe('the');
  });

  it('is empty for blank or punctuation-only input', () => {
    expect(vendorNameKey('')).toBe('');
    expect(vendorNameKey('   ')).toBe('');
    expect(vendorNameKey('...,')).toBe('');
  });
});

describe('registrationKey', () => {
  it('keeps digits only, folding Arabic-Indic and Extended Arabic-Indic digits', () => {
    expect(registrationKey('51-666-7276')).toBe('516667276');
    expect(registrationKey('٥١٦٦٦٧٢٧٦')).toBe('516667276');
    expect(registrationKey('۵۱۶۶۶۷۲۷۶')).toBe('516667276');
  });

  it('treats fewer than 5 digits as no registration number', () => {
    expect(registrationKey('1234')).toBeNull();
    expect(registrationKey('n/a')).toBeNull();
    expect(registrationKey(undefined)).toBeNull();
  });
});

describe('scoreVendorName', () => {
  it('ranks a prefix above a contains above a fuzzy match, and drops weak ones', () => {
    const prefix = scoreVendorName('super', 'super deal');
    const contains = scoreVendorName('deal', 'super deal');
    const fuzzy = scoreVendorName('super dell', 'super deal');
    expect(prefix).toBe(1);
    expect(contains).toBe(0.8);
    expect(fuzzy).toBeGreaterThanOrEqual(0.6);
    expect(fuzzy).toBeLessThan(contains);
    expect(scoreVendorName('xyz', 'super deal')).toBe(0);
  });

  it('works on Arabic and Hebrew keys', () => {
    expect(scoreVendorName(vendorNameKey('مخبز'), vendorNameKey('مخبز الأقصى'))).toBe(1);
    expect(scoreVendorName(vendorNameKey('דיל'), vendorNameKey('סופר דיל'))).toBe(0.8);
  });
});
