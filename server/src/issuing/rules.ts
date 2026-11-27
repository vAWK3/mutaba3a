import { hasPack, packFor, type JurisdictionPack } from '../jurisdictions/index.js';
import { isLive } from './jurisdictions.js';
import { ISSUED_DOC_TYPES, type DealerType, type IssuedDocType } from './types.js';

/**
 * MUT-743 (ADR-287): what the clients show and ask for in the invoicing setup and the issue drawer, from the issuer's
 * jurisdiction pack, so they stop hard-coding Israel. The pack may offer fewer values than the core's closed lists
 * (dealer types, document types, languages), relabel and reorder them, and change the currency, the tax-ID mask and the
 * clearance; a genuinely new value is a server and schema change plus a client release. Display data only: the server
 * keeps refusing what the pack refuses (`EXEMPT_DEALER_TAX_INVOICE`, `CURRENCY_NOT_SUPPORTED`, `VAT_ID_INVALID`).
 */
export interface IssuingRules {
  country: string;
  live: boolean;
  /** The pack's version; null when the country is not live (nothing to read). */
  rulesVersion: string | null;
  /** Null when the country is not live: the client shows "not available yet". */
  rules: {
    currency: { base: string; issuing: string[] };
    languages: { available: string[]; default: string };
    taxId: { scheme: string; pattern: string; maxLength: number };
    vat: { perLineExemption: boolean };
    documentTypes: Array<{ type: IssuedDocType; vatBearing: boolean; takesPayment: boolean; hasDueDate: boolean; needsCustomer: boolean }>;
    dealerTypes: Array<{
      value: DealerType;
      labelKey: string;
      issues: IssuedDocType[];
      exemptFromVat: boolean;
      defaultType: IssuedDocType;
      entryTypes: { owed: IssuedDocType[]; received: IssuedDocType[] };
    }>;
    /** The tax authority's pre-issue clearance, or null where the country has none. */
    clearance: { kind: string } | null;
  } | null;
}

/** The pack of a country, or undefined when there is none. */
export type PackFinder = (country: string) => JurisdictionPack | undefined;
const registered: PackFinder = (country) => (hasPack(country) ? packFor(country) : undefined);

/** `live` is the server's INVOICING_JURISDICTIONS: a country answers only when it is on that list AND has a pack. */
export function rulesFor(country: string, live: readonly string[], find: PackFinder = registered): IssuingRules {
  const pack = isLive(live, country) ? find(country) : undefined;
  if (!pack) return { country, live: false, rulesVersion: null, rules: null };
  return {
    country,
    live: true,
    rulesVersion: pack.version,
    rules: {
      currency: { base: pack.currency.base, issuing: [...pack.currency.issuing] },
      languages: { available: [...pack.languages.available], default: pack.languages.default },
      taxId: { scheme: pack.taxId.scheme, pattern: pack.taxId.pattern, maxLength: pack.taxId.maxLength },
      vat: { perLineExemption: pack.vat.perLineExemption },
      documentTypes: ISSUED_DOC_TYPES.map((type) => {
        const t = pack.documentTypes[type];
        return { type, vatBearing: t.vatBearing, takesPayment: t.takesPayment, hasDueDate: t.hasDueDate, needsCustomer: t.needsCustomer };
      }),
      dealerTypes: pack.dealer.types.map((d) => ({
        value: d.value,
        labelKey: d.labelKey,
        issues: [...d.issues],
        exemptFromVat: d.exemptFromVat,
        defaultType: d.defaultType,
        entryTypes: { owed: [...d.entryTypes.owed], received: [...d.entryTypes.received] },
      })),
      clearance: pack.clearance ? { kind: pack.clearance.kind } : null,
    },
  };
}
