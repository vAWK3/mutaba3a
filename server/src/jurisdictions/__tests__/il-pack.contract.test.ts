import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVE_JURISDICTIONS } from '../../issuing/jurisdictions.js';
import { DOC_TYPE_RANK, DEALER_TYPES, ISSUED_DOC_TYPES } from '../../issuing/types.js';
import { IL_DOC_TYPE_CODES } from '../il/documents.js';
import { IL_PACK } from '../il/index.js';
import { assertPacksFor, defaultPack, hasPack, packFor, registeredCountries } from '../registry.js';

/** MUT-741 (ADR-287): the Israel pack answers exactly what the core used to hard-code, and the registry finds it. */
describe('IL pack: today\'s Israeli rules, unchanged', () => {
  it('identity: Israel, version 1.0.0, Jerusalem time, shekels only, seven years', () => {
    expect(IL_PACK).toMatchObject({ country: 'IL', version: '1.0.0', timezone: 'Asia/Jerusalem', currency: { base: 'ILS', issuing: ['ILS'] }, retention: { years: 7 } });
  });

  it('document types: the Tax Authority codes, VAT-bearing and tax-document flags', () => {
    expect(IL_DOC_TYPE_CODES).toEqual({ TAX_INVOICE: 305, TAX_INVOICE_RECEIPT: 320, CREDIT_NOTE: 330, RECEIPT: 400, PAYMENT_REQUEST: 300 });
    expect(Object.keys(IL_PACK.documentTypes).sort()).toEqual([...ISSUED_DOC_TYPES].sort());
    const flags = (pick: 'vatBearing' | 'taxDocument') => ISSUED_DOC_TYPES.filter((t) => IL_PACK.documentTypes[t][pick]).sort();
    expect(flags('vatBearing')).toEqual(['CREDIT_NOTE', 'PAYMENT_REQUEST', 'TAX_INVOICE', 'TAX_INVOICE_RECEIPT']);
    expect(flags('taxDocument')).toEqual(['CREDIT_NOTE', 'TAX_INVOICE', 'TAX_INVOICE_RECEIPT']);
  });

  it('the core sort order (DOC_TYPE_RANK) equals ascending Israeli code order', () => {
    const byRank = [...ISSUED_DOC_TYPES].sort((a, b) => DOC_TYPE_RANK[a] - DOC_TYPE_RANK[b]);
    const byCode = [...ISSUED_DOC_TYPES].sort((a, b) => IL_DOC_TYPE_CODES[a] - IL_DOC_TYPE_CODES[b]);
    expect(byRank).toEqual(byCode);
  });

  it.each([
    ['2015-09-30', 1700], // before the table starts: the first rate
    ['2015-10-01', 1700],
    ['2024-12-31', 1700],
    ['2025-01-01', 1800],
    ['2026-11-26', 1800],
  ])('VAT on %s is %i basis points', (date, rate) => {
    expect(IL_PACK.vat.rateOn(date)).toBe(rate);
  });

  it('dealers: only an exempt dealer (עוסק פטור) is VAT-exempt and is refused tax documents', () => {
    expect(DEALER_TYPES.filter((d) => IL_PACK.dealer.exemptFromVat(d))).toEqual(['EXEMPT']);
    for (const docType of ISSUED_DOC_TYPES) {
      const refused = IL_PACK.dealer.refusal('EXEMPT', docType);
      if (docType === 'RECEIPT' || docType === 'PAYMENT_REQUEST') expect(refused).toBeNull();
      else expect(refused).toMatchObject({ reason: 'EXEMPT_DEALER_TAX_INVOICE' });
      for (const dealer of ['LICENSED', 'COMPANY', 'NONPROFIT'] as const) expect(IL_PACK.dealer.refusal(dealer, docType)).toBeNull();
    }
  });

  it('tax IDs: the Israeli check digit', () => {
    expect(IL_PACK.taxId.normalize('515151512')).toBe('515151512');
    expect(IL_PACK.taxId.normalize('515151515')).toBeNull();
  });
});

describe('registry', () => {
  it('finds Israel; refuses a country with no pack; the default pack is the default country\'s', () => {
    expect(packFor('IL')).toBe(IL_PACK);
    expect(hasPack('IL')).toBe(true);
    expect(hasPack('JO')).toBe(false);
    expect(() => packFor('JO')).toThrow(/No jurisdiction pack for JO/);
    expect(defaultPack()).toBe(IL_PACK);
    expect(registeredCountries()).toEqual(['IL']);
  });

  it('the boot check refuses a live country with no pack', () => {
    expect(() => assertPacksFor(['IL'])).not.toThrow();
    expect(() => assertPacksFor(['IL', 'SA'])).toThrow(/lists SA: no jurisdiction pack for it/);
  });

  it('every country live by default has a pack', () => {
    for (const country of DEFAULT_LIVE_JURISDICTIONS) expect(hasPack(country), country).toBe(true);
  });
});
