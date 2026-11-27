import { describe, expect, it } from 'vitest';
import { IL_PACK } from '../../jurisdictions/il/index.js';
import { rulesFor } from '../rules.js';

/** MUT-743: the rules read's body, from the issuer's country and the countries that are live on this server. */
describe('rulesFor', () => {
  it('an Israeli profile gets Israel\'s rules, with the pack version', () => {
    const rules = rulesFor('IL', ['IL']);
    expect(rules).toMatchObject({ country: 'IL', live: true, rulesVersion: '1.0.0' });
    expect(rules.rules).toMatchObject({
      currency: { base: 'ILS', issuing: ['ILS'] },
      languages: { available: ['he', 'ar', 'en'], default: 'he' },
      taxId: { scheme: 'IL_TAX_ID', pattern: '^\\d{9}$', maxLength: 9 },
      vat: { perLineExemption: true },
      clearance: { kind: 'IL_ALLOCATION' },
    });
    expect(rules.rules!.documentTypes.map((t) => t.type)).toEqual(['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_NOTE', 'RECEIPT', 'PAYMENT_REQUEST']);
    expect(rules.rules!.documentTypes.find((t) => t.type === 'PAYMENT_REQUEST')).toEqual({ type: 'PAYMENT_REQUEST', vatBearing: true, takesPayment: false, hasDueDate: true, needsCustomer: true });
    expect(rules.rules!.dealerTypes.find((d) => d.value === 'EXEMPT')).toEqual({ value: 'EXEMPT', labelKey: 'IL.EXEMPT', issues: ['RECEIPT', 'PAYMENT_REQUEST'], exemptFromVat: true, defaultType: 'RECEIPT', entryTypes: { owed: ['PAYMENT_REQUEST'], received: ['RECEIPT'] } });
  });

  it('a country that is not live, or has no pack, is "not available yet": no rules, no version', () => {
    expect(rulesFor('JO', ['IL'])).toEqual({ country: 'JO', live: false, rulesVersion: null, rules: null });
    expect(rulesFor('IL', ['SA'])).toEqual({ country: 'IL', live: false, rulesVersion: null, rules: null });
    expect(rulesFor('SA', ['IL', 'SA'])).toEqual({ country: 'SA', live: false, rulesVersion: null, rules: null });
  });

  it('serves a pack that offers fewer dealer types and no clearance, so clients need no release for it', () => {
    const noClearance = { ...IL_PACK };
    delete noClearance.clearance;
    const slim = { ...noClearance, country: 'XX', dealer: { ...IL_PACK.dealer, types: IL_PACK.dealer.types.filter((d) => d.value === 'COMPANY') } };
    const rules = rulesFor('XX', ['XX'], (country) => (country === 'XX' ? slim : IL_PACK));
    expect(rules.rules!.dealerTypes.map((d) => d.value)).toEqual(['COMPANY']);
    expect(rules.rules!.clearance).toBeNull();
  });
});
