import { describe, expect, it } from 'vitest';
import { DEALER_TYPES, ISSUED_DOC_TYPES } from '../../issuing/types.js';
import { IL_PACK } from '../il/index.js';
import type { JurisdictionPack } from '../pack.js';
import { packFor, registeredCountries } from '../registry.js';
import { IL_FIXTURE } from './fixtures/il.js';
import { PACK_FIXTURES } from './fixtures/index.js';
import { PACK_CHECKS, packViolations, todayIn, type PackContext } from './pack-contract.js';

/**
 * MUT-745 (ADR-287, jurisdiction-packs.md step 6): every registered pack passes the contract and answers exactly its
 * fixture; a deliberately broken pack fails each check. The issuing behaviour every pack gets from the core is
 * `src/__tests__/routes-pack-contract.test.ts`; the golden documents are `golden.test.ts`.
 */
const contextFor = (pack: JurisdictionPack): PackContext => ({ today: todayIn(pack.timezone), fixture: PACK_FIXTURES[pack.country] });

describe('every registered pack has a fixture, and every fixture a pack', () => {
  it('the fixtures name exactly the registered countries', () => {
    expect(Object.keys(PACK_FIXTURES).sort()).toEqual(registeredCountries().sort());
  });
});

describe.each(registeredCountries())('the %s pack: the contract', (country) => {
  const pack = packFor(country);
  it.each(PACK_CHECKS.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(c.check(pack, contextFor(pack))).toEqual([]);
  });
});

describe.each(registeredCountries().filter((c) => PACK_FIXTURES[c]))('the %s pack answers exactly its fixture', (country) => {
  const pack = packFor(country);
  const want = PACK_FIXTURES[country]!.expected;

  it('identity: country, version, time zone, currencies, retention', () => {
    expect(pack).toMatchObject({ country: want.identity.country, version: want.identity.version, timezone: want.identity.timezone, currency: want.identity.currency, retention: { years: want.identity.retentionYears } });
  });

  it('document types: codes and every flag', () => {
    expect(pack.documentTypes).toEqual(want.documentTypes);
    expect([...ISSUED_DOC_TYPES].sort((a, b) => pack.documentTypes[a].code - pack.documentTypes[b].code)).toEqual(want.codeOrder);
  });

  it.each(want.vatOn.map(([date, rate]) => [date, rate] as const))('VAT on %s is %i basis points', (date, rate) => {
    expect(pack.vat.rateOn(date)).toBe(rate);
  });

  it('dealers: the order, what each issues, opens on and turns entries into, and who is VAT-exempt', () => {
    expect(pack.dealer.types).toEqual(want.dealers);
    expect(DEALER_TYPES.filter((d) => pack.dealer.exemptFromVat(d))).toEqual(want.dealers.filter((d) => d.exemptFromVat).map((d) => d.value));
    for (const dealer of want.dealers) {
      for (const docType of ISSUED_DOC_TYPES) {
        const refused = pack.dealer.refusal(dealer.value, docType);
        if (dealer.issues.includes(docType)) expect(refused, `${dealer.value} ${docType}`).toBeNull();
        else expect(refused, `${dealer.value} ${docType}`).toMatchObject({ reason: want.refusalReason });
      }
    }
  });

  it('languages, the tax-ID scheme and mask, per-line VAT exemption, clearance and statutory file', () => {
    expect(pack.languages).toEqual(want.languages);
    expect(pack.taxId).toMatchObject({ scheme: want.taxId.scheme, pattern: want.taxId.pattern, maxLength: want.taxId.maxLength });
    for (const raw of want.taxId.valid) expect(pack.taxId.normalize(raw)).toBe(raw);
    for (const raw of want.taxId.invalid) expect(pack.taxId.normalize(raw)).toBeNull();
    expect(pack.vat.perLineExemption).toBe(want.perLineExemption);
    expect(pack.clearance?.kind ?? null).toBe(want.clearanceKind);
    expect(pack.statutoryFile?.mime ?? null).toBe(want.statutoryFileMime);
    expect(pack.datedTables.map((t) => t.name)).toEqual(want.datedTables);
  });
});

describe('a deliberately broken pack fails the contract (AC2)', () => {
  const CTX: PackContext = { today: '2026-11-27', fixture: IL_FIXTURE };
  const with_ = (over: Partial<JurisdictionPack>): JurisdictionPack => ({ ...IL_PACK, ...over });
  const dealer = (over: Partial<JurisdictionPack['dealer']>) => with_({ dealer: { ...IL_PACK.dealer, ...over } });
  const firstDealer = (over: Partial<JurisdictionPack['dealer']['types'][number]>) => dealer({ types: [{ ...IL_PACK.dealer.types[0]!, ...over }, ...IL_PACK.dealer.types.slice(1)] });

  const BROKEN: [string, string, JurisdictionPack, PackContext?][] = [
    ['no fixture', 'fixture', IL_PACK, { ...CTX, fixture: undefined }],
    ['clears, but the fixture has no clearance failure', 'fixture', IL_PACK, { ...CTX, fixture: { ...IL_FIXTURE, route: { issuer: IL_FIXTURE.route.issuer, document: IL_FIXTURE.route.document } } }],
    ['a three-letter country', 'identity', with_({ country: 'ISR' })],
    ['a version that is not x.y.z', 'identity', with_({ version: '1.0' })],
    ['a time zone that does not exist', 'identity', with_({ timezone: 'Asia/Atlantis' })],
    ['issues in a currency other than its base', 'identity', with_({ currency: { ...IL_PACK.currency, issuing: ['USD'] } })],
    ['keeps documents for no years', 'identity', with_({ retention: { years: 0 } })],
    ['misses a document type', 'document types', with_({ documentTypes: { ...IL_PACK.documentTypes, RECEIPT: undefined } as unknown as JurisdictionPack['documentTypes'] })],
    ['gives two types one code', 'document types', with_({ documentTypes: { ...IL_PACK.documentTypes, RECEIPT: { ...IL_PACK.documentTypes.RECEIPT, code: 305 } } })],
    ['a table that disagrees with its dealer rule', 'dealers', dealer({ refusal: () => null })],
    ['a dealer that opens on a type it may not issue', 'dealers', firstDealer({ issues: ['RECEIPT'], defaultType: 'TAX_INVOICE', entryTypes: { owed: [], received: ['RECEIPT'] } })],
    ['a label key of another country', 'dealers', firstDealer({ labelKey: 'JO.LICENSED' })],
    ['the same dealer twice', 'dealers', dealer({ types: [...IL_PACK.dealer.types, IL_PACK.dealer.types[0]!] })],
    ['a VAT exemption the table and the rule disagree on', 'dealers', dealer({ exemptFromVat: () => false })],
    ['a default language it does not print in', 'languages', with_({ languages: { available: ['he'], default: 'en' } })],
    ['a language outside the core list', 'languages', with_({ languages: { available: ['he', 'fr'], default: 'he' } })],
    ['a tax-ID mask that does not compile', 'tax IDs', with_({ taxId: { ...IL_PACK.taxId, pattern: '^(\\d{9}$' } })],
    ['a tax-ID check that refuses a valid number', 'tax IDs', with_({ taxId: { ...IL_PACK.taxId, normalize: () => null } })],
    ['a tax-ID check that accepts anything', 'tax IDs', with_({ taxId: { ...IL_PACK.taxId, normalize: (raw) => raw } })],
    ['a VAT table that starts after today', 'dated rules', with_({ datedTables: [{ name: 'vat.standardRate', starts: ['2027-01-01'] }] })],
    ['a threshold table with no steps', 'dated rules', with_({ datedTables: [...IL_PACK.datedTables, { name: 'expense.other', starts: [] }] })],
    ['a dated table out of order', 'dated rules', with_({ datedTables: [{ name: 'vat.standardRate', starts: ['2025-01-01', '2015-10-01'] }] })],
    ['no VAT table at all', 'dated rules', with_({ datedTables: [] })],
    ['a VAT rate above 100%', 'dated rules', with_({ vat: { ...IL_PACK.vat, rateOn: () => 12_000 } })],
    ['a VAT rate that is not whole basis points (lines no longer add up)', 'documents', with_({ vat: { ...IL_PACK.vat, rateOn: () => 1800.5 } })],
    ['issues in a currency compose refuses', 'documents', with_({ currency: { ...IL_PACK.currency, base: 'USD' } })],
    ['a clearance with no kind', 'hooks', with_({ clearance: { ...IL_PACK.clearance!, kind: '' } })],
    ['an expense of nothing above the threshold', 'hooks', with_({ expense: { ...IL_PACK.expense, aboveAllocationThreshold: () => true } })],
  ];

  it('the Israel pack itself has no violation on that date', () => {
    expect(packViolations(IL_PACK, CTX)).toEqual([]);
  });

  it.each(BROKEN)('%s fails the "%s" check', (_what, checkPrefix, pack, ctx = CTX) => {
    const check = PACK_CHECKS.find((c) => c.name.startsWith(checkPrefix))!;
    expect(check, checkPrefix).toBeDefined();
    expect(check.check(pack, ctx)).not.toEqual([]);
    expect(packViolations(pack, ctx).length).toBeGreaterThan(0);
  });

  it('every check is proven by at least one broken pack', () => {
    const proven = new Set(BROKEN.map(([, prefix]) => PACK_CHECKS.find((c) => c.name.startsWith(prefix))?.name));
    expect(PACK_CHECKS.filter((c) => !proven.has(c.name)).map((c) => c.name)).toEqual([]);
  });
});
