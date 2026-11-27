import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVE_JURISDICTIONS } from '../../issuing/jurisdictions.js';
import { DOC_TYPE_RANK, ISSUED_DOC_TYPES } from '../../issuing/types.js';
import { IL_DOC_TYPE_CODES } from '../il/documents.js';
import { IL_PACK } from '../il/index.js';
import { assertPacksFor, defaultPack, hasPack, packFor, registeredCountries } from '../registry.js';

/**
 * MUT-741 (ADR-287): what only Israel's pack promises, and the registry. MUT-745 moved the rest of what this file
 * asserted (identity, codes, flags, VAT steps, dealers, forms, languages, mask, clearance, version) into the Israel
 * fixture (`fixtures/il.ts`), which `pack.contract.test.ts` checks the pack against, value for value.
 */
describe('IL pack: what only Israel promises', () => {
  it('the Tax Authority codes, as the uniform file and the allocation API read them', () => {
    expect(IL_DOC_TYPE_CODES).toEqual({ TAX_INVOICE: 305, TAX_INVOICE_RECEIPT: 320, CREDIT_NOTE: 330, RECEIPT: 400, PAYMENT_REQUEST: 300 });
  });

  it('the core sort order (DOC_TYPE_RANK) equals ascending Israeli code order', () => {
    const byRank = [...ISSUED_DOC_TYPES].sort((a, b) => DOC_TYPE_RANK[a] - DOC_TYPE_RANK[b]);
    const byCode = [...ISSUED_DOC_TYPES].sort((a, b) => IL_DOC_TYPE_CODES[a] - IL_DOC_TYPE_CODES[b]);
    expect(byRank).toEqual(byCode);
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
