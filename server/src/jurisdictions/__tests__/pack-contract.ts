import { composeDocument, type ComposeInput } from '../../issuing/compose.js';
import { DOCUMENT_LANGUAGES } from '../../issuing/labels.js';
import { DEALER_TYPES, ISSUED_DOC_TYPES, type IssuedDocType } from '../../issuing/types.js';
import type { JurisdictionPack } from '../pack.js';
import type { PackFixture } from './fixtures/types.js';

/**
 * MUT-745 (ADR-287, jurisdiction-packs.md step 6): the contract every jurisdiction pack must pass, as pure checks. Each
 * returns what is wrong (empty when the pack keeps it), so the suite can run it for every registered pack and prove,
 * with deliberately broken packs, that each check fails when it should. What a pack's rules ARE lives in its fixture;
 * what any pack's rules must BE lives here. The issuing behaviour every pack gets from the core (numbering, idempotent
 * retry, immutability, clearance leaving no trace, the stamp) is the route contract, `routes-pack-contract.test.ts`.
 */
export interface PackContext {
  /** The current date (YYYY-MM-DD) in the pack's time zone. */
  readonly today: string;
  readonly fixture: PackFixture | undefined;
}

export interface PackCheck {
  readonly name: string;
  readonly check: (pack: JurisdictionPack, ctx: PackContext) => string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s: string): boolean => ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const validZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};
const dupes = <T>(xs: readonly T[]): T[] => xs.filter((x, i) => xs.indexOf(x) !== i);

/** The current date in a time zone, as YYYY-MM-DD. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: validZone(timezone) ? timezone : 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const identity: PackCheck = {
  name: 'identity: country, version, time zone, currencies, retention',
  check: (pack) => {
    const out: string[] = [];
    if (!/^[A-Z]{2}$/.test(pack.country)) out.push(`country "${pack.country}" is not ISO 3166-1 alpha-2`);
    if (!/^\d+\.\d+\.\d+$/.test(pack.version)) out.push(`version "${pack.version}" is not x.y.z`);
    if (!validZone(pack.timezone)) out.push(`time zone "${pack.timezone}" is not an IANA zone`);
    const { base, issuing, issuingLabel } = pack.currency;
    if (!/^[A-Z]{3}$/.test(base)) out.push(`base currency "${base}" is not ISO 4217`);
    if (issuing.length === 0) out.push('issues in no currency');
    for (const c of issuing) if (!/^[A-Z]{3}$/.test(c)) out.push(`issuing currency "${c}" is not ISO 4217`);
    if (!issuing.includes(base)) out.push(`the base currency ${base} is not one it issues in`);
    if (!issuingLabel.trim()) out.push('no name for its issuing currencies');
    if (!Number.isInteger(pack.retention.years) || pack.retention.years < 1) out.push(`retention of ${pack.retention.years} years`);
    return out;
  },
};

const documentTypes: PackCheck = {
  name: 'document types: every core type, each with its own positive code',
  check: (pack) => {
    const out: string[] = [];
    const keys = Object.keys(pack.documentTypes).sort();
    if (keys.join() !== [...ISSUED_DOC_TYPES].sort().join()) out.push(`document types ${keys.join(', ')} are not the core's ${[...ISSUED_DOC_TYPES].sort().join(', ')}`);
    const codes = ISSUED_DOC_TYPES.map((t) => pack.documentTypes[t]?.code);
    for (const [i, code] of codes.entries()) if (!Number.isInteger(code) || (code as number) <= 0) out.push(`${ISSUED_DOC_TYPES[i]} has code ${code}`);
    for (const code of dupes(codes)) out.push(`code ${code} names two document types`);
    return out;
  },
};

const dealers: PackCheck = {
  name: 'dealers: one table, each type issuing exactly what the dealer rule accepts',
  check: (pack) => {
    const out: string[] = [];
    const { types } = pack.dealer;
    if (types.length === 0) out.push('offers no business type');
    for (const v of dupes(types.map((d) => d.value))) out.push(`business type ${v} offered twice`);
    for (const d of types) {
      if (!(DEALER_TYPES as readonly string[]).includes(d.value)) out.push(`business type ${d.value} is not in the core's list`);
      if (d.labelKey !== `${pack.country}.${d.value}`) out.push(`${d.value}: label key "${d.labelKey}" is not "${pack.country}.${d.value}"`);
      if (d.issues.length === 0) out.push(`${d.value} issues nothing`);
      for (const t of dupes(d.issues)) out.push(`${d.value} lists ${t} twice`);
      for (const docType of ISSUED_DOC_TYPES) {
        const refusal = pack.dealer.refusal(d.value, docType);
        if (d.issues.includes(docType) !== (refusal === null)) out.push(`${d.value} ${docType}: the table says ${d.issues.includes(docType) ? 'issues' : 'refused'}, the dealer rule ${refusal ? 'refuses' : 'accepts'}`);
        if (refusal && (!refusal.reason || !refusal.message)) out.push(`${d.value} ${docType}: a refusal with no reason or message`);
      }
      if (!d.issues.includes(d.defaultType)) out.push(`${d.value} opens on ${d.defaultType}, which it does not issue`);
      for (const t of [...d.entryTypes.owed, ...d.entryTypes.received]) if (!d.issues.includes(t)) out.push(`${d.value} may turn an entry into ${t}, which it does not issue`);
      if (d.exemptFromVat !== pack.dealer.exemptFromVat(d.value)) out.push(`${d.value}: the table and exemptFromVat disagree`);
    }
    return out;
  },
};

const languages: PackCheck = {
  name: 'languages: from the core list, the default among them',
  check: (pack) => {
    const out: string[] = [];
    const { available, default: dflt } = pack.languages;
    if (available.length === 0) out.push('prints in no language');
    for (const l of available) if (!(DOCUMENT_LANGUAGES as readonly string[]).includes(l)) out.push(`language ${l} is not in the core's list`);
    for (const l of dupes(available)) out.push(`language ${l} listed twice`);
    if (!available.includes(dflt)) out.push(`the default language ${dflt} is not available`);
    return out;
  },
};

const taxId: PackCheck = {
  name: 'tax IDs: a scheme, a mask that compiles, and the fixture numbers read as they should',
  check: (pack, { fixture }) => {
    const out: string[] = [];
    const { scheme, pattern, maxLength, normalize } = pack.taxId;
    if (!scheme.trim()) out.push('no tax ID scheme');
    let mask: RegExp | null = null;
    try {
      mask = new RegExp(pattern);
    } catch {
      out.push(`the tax ID mask "${pattern}" does not compile`);
    }
    if (!Number.isInteger(maxLength) || maxLength < 1) out.push(`tax ID max length ${maxLength}`);
    if (normalize('') !== null) out.push('an empty tax ID reads as valid');
    for (const raw of fixture?.expected.taxId.valid ?? []) {
      const stored = normalize(raw);
      if (stored === null) out.push(`valid tax ID ${raw} is refused`);
      else if ((mask && !mask.test(stored)) || stored.length > maxLength) out.push(`tax ID ${raw} is stored as ${stored}, which its own mask refuses`);
    }
    for (const raw of fixture?.expected.taxId.invalid ?? []) if (normalize(raw) !== null) out.push(`invalid tax ID ${raw} is accepted`);
    return out;
  },
};

const datedRules: PackCheck = {
  name: 'dated rules: every rate and threshold table has a step in force today',
  check: (pack, { today }) => {
    const out: string[] = [];
    if (!pack.datedTables.some((t) => t.name === 'vat.standardRate')) out.push('declares no vat.standardRate table');
    for (const v of dupes(pack.datedTables.map((t) => t.name))) out.push(`table ${v} declared twice`);
    for (const table of pack.datedTables) {
      if (table.starts.length === 0) out.push(`${table.name} has no steps`);
      for (const s of table.starts) if (!isIsoDate(s)) out.push(`${table.name}: "${s}" is not a date`);
      for (let i = 1; i < table.starts.length; i += 1) if (table.starts[i]! <= table.starts[i - 1]!) out.push(`${table.name}: ${table.starts[i]} does not come after ${table.starts[i - 1]}`);
      if (table.starts.length > 0 && table.starts[0]! > today) out.push(`${table.name} has no entry for ${today}: its first step starts ${table.starts[0]}`);
    }
    const rate = pack.vat.rateOn(today);
    if (!Number.isInteger(rate) || rate < 0 || rate > 10_000) out.push(`the VAT rate today is ${rate} basis points`);
    return out;
  },
};

const SAMPLE_LINES: ComposeInput['lines'] = [
  { description: 'a', kind: 'SERVICE', quantityMilli: 2_000n, unitPriceMinor: 50_000n, discountMinor: 0n },
  { description: 'b', kind: 'GOODS', quantityMilli: 1_500n, unitPriceMinor: 12_035n, discountMinor: 1_000n, vatExempt: true },
  { description: 'c', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: 9_999n, discountMinor: 0n, pricesIncludeVat: true },
  { description: 'd', kind: 'SERVICE', quantityMilli: 3_333n, unitPriceMinor: 777n, discountMinor: 3n },
];

const linesAddUp: PackCheck = {
  name: 'documents: every type each dealer issues composes, and its lines add up to it',
  check: (pack, { today }) => {
    const out: string[] = [];
    for (const d of pack.dealer.types) {
      for (const docType of ISSUED_DOC_TYPES) {
        const label = `${d.value} ${docType}`;
        const input = (t: IssuedDocType): ComposeInput => ({ pack, docType: t, currency: pack.currency.base, documentDate: today, dealerType: d.value, documentDiscountMinor: 3_333n, pricesIncludeVat: false, lines: SAMPLE_LINES });
        let doc: ReturnType<typeof composeDocument>;
        try {
          doc = composeDocument(input(docType));
        } catch (err) {
          if (d.issues.includes(docType)) out.push(`${label}: does not compose (${(err as Error).message})`);
          continue;
        }
        if (!d.issues.includes(docType)) {
          out.push(`${label}: composes, though the dealer may not issue it`);
          continue;
        }
        const sum = (pick: (l: (typeof doc.lines)[number]) => bigint) => doc.lines.reduce((s, l) => s + pick(l), 0n);
        if (sum((l) => l.netMinor) !== doc.subtotalMinor) out.push(`${label}: line nets ${sum((l) => l.netMinor)} ≠ subtotal ${doc.subtotalMinor}`);
        if (doc.subtotalMinor - doc.discountMinor !== doc.netMinor) out.push(`${label}: subtotal − discount ≠ net`);
        if (sum((l) => l.vatMinor) !== doc.vatMinor) out.push(`${label}: line VAT ${sum((l) => l.vatMinor)} ≠ document VAT ${doc.vatMinor}`);
        if (doc.netMinor + doc.vatMinor !== doc.grossMinor) out.push(`${label}: net + VAT ≠ gross`);
        const rate = pack.documentTypes[docType].vatBearing && !pack.dealer.exemptFromVat(d.value) ? pack.vat.rateOn(today) : 0;
        if (doc.vatRateBasisPoints !== rate) out.push(`${label}: VAT at ${doc.vatRateBasisPoints}, the pack says ${rate}`);
        for (const l of doc.lines) if (l.vatExempt && l.vatMinor !== 0n) out.push(`${label}: exempt line ${l.index} carries VAT`);
      }
    }
    return out;
  },
};

const hooks: PackCheck = {
  name: 'hooks: expense rule answers, clearance and statutory file are named when present',
  check: (pack, { today }) => {
    const out: string[] = [];
    const nothing = { currency: pack.currency.base, occurredOn: today, netMinor: 0n, vatMinor: 0n };
    if (pack.expense.aboveAllocationThreshold(nothing)) out.push('an expense of nothing is above the threshold');
    if (pack.expense.allocationNumberRequired({ ...nothing, firm: false, vatTreatment: null })) out.push('an expense off a firm profile needs a number');
    if (pack.clearance && !pack.clearance.kind.trim()) out.push('a clearance with no kind');
    if (pack.statutoryFile && !pack.statutoryFile.mime.trim()) out.push('a statutory file with no media type');
    return out;
  },
};

const fixturePresent: PackCheck = {
  name: 'fixture: the pack has one, for its country, with a clearance failure when it clears',
  check: (pack, { fixture }) => {
    if (!fixture) return [`${pack.country} has no fixture in jurisdictions/__tests__/fixtures`];
    const out: string[] = [];
    if (fixture.country !== pack.country) out.push(`the fixture is for ${fixture.country}`);
    if (fixture.golden.composed.length === 0) out.push('the fixture has no golden documents');
    if (pack.clearance && !fixture.route.clearanceFailure) out.push('the pack clears documents but its fixture has no clearance failure for the route contract');
    return out;
  },
};

/** Every check, in the order the suite reports them. */
export const PACK_CHECKS: readonly PackCheck[] = [fixturePresent, identity, documentTypes, dealers, languages, taxId, datedRules, linesAddUp, hooks];

/** Every violation of the contract, as `check: problem`. Empty: the pack passes. */
export function packViolations(pack: JurisdictionPack, ctx: PackContext): string[] {
  return PACK_CHECKS.flatMap((c) => c.check(pack, ctx).map((p) => `${c.name}: ${p}`));
}
