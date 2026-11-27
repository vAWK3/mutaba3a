import type { DealerType, IssuedDocType } from '../issuing/types.js';
import type { IssuedDocumentRecord, IssuerDetailsRecord } from '../repositories/ports.js';
import type { aboveAllocationThreshold, allocationNumberRequired, normalizeAllocationNumber } from './il/allocation-number.js';
import type * as TaxAuthorityService from './il/tax-authority/service.js';
import type { UniformFile, UniformFileHouse } from './il/uniform-file/export.js';


/**
 * MUT-741 (ADR-287): a jurisdiction pack: the rules the issuing core asks the issuer's country for. It holds only what a
 * pack answers today (Israel's); MUT-742 (schema), MUT-743 (the rules read) and MUT-744 (paper packs for ZATCA and
 * JoFotara) widen it when a second country needs more. Rules are data and functions here, never `if (country === …)` in the core.
 */
export interface JurisdictionPack {
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
  /** The pack's own version, stamped with the core version when a document is issued. Bump when a rule here changes. */
  readonly version: string;
  /** The IANA zone "today" and a document's day are read in. */
  readonly timezone: string;
  readonly currency: {
    /** What a document is issued in and what a legal amount is expressed in (ISO 4217). */
    readonly base: string;
    readonly issuing: readonly string[];
    /** The refusal text's name for the list ("shekels (ILS)"). */
    readonly issuingLabel: string;
  };
  readonly taxId: {
    /** The stored form of a person's or company's tax number, or null when it is not a valid one. */
    readonly normalize: (raw: string) => string | null;
    /** Names how the stored number is read (Israel: `IL_TAX_ID`, the Israeli VAT, company or ID number with its check digit); kept with it (MUT-742). */
    readonly scheme: string;
    /** The regular expression (source) a typed number must match, and its longest length: what a form masks input with (the server's check is the authority, MUT-743). */
    readonly pattern: string;
    readonly maxLength: number;
  };
  /** What each core document type is under this country's law, and what its form asks of the person (MUT-743). */
  readonly documentTypes: Readonly<Record<IssuedDocType, DocumentTypeFacts>>;
  /** The languages a document may be printed in and the one a new business starts with (MUT-743). Values come from the core's closed list. */
  readonly languages: { readonly available: readonly string[]; readonly default: string };
  readonly dealer: {
    /** The business types this country offers, in the order shown. Values come from the core's closed list; a pack may offer fewer, never a new one (MUT-743). */
    readonly types: readonly DealerRule[];
    /** A dealer with no VAT to charge (Israel: עוסק פטור). */
    readonly exemptFromVat: (dealer: DealerType) => boolean;
    /** Why this dealer may not issue this document, or null when it may. */
    readonly refusal: (dealer: DealerType, docType: IssuedDocType) => { readonly reason: string; readonly message: string } | null;
  };
  readonly vat: {
    /** The standard rate in basis points on a document date (YYYY-MM-DD). */
    readonly rateOn: (date: string) => number;
    /** Whether a single line of a document may be marked VAT-exempt (MUT-743). */
    readonly perLineExemption: boolean;
  };
  readonly retention: {
    /** Years an issued document is kept from its date. */
    readonly years: number;
  };
  /**
   * MUT-745: every dated table of rates or thresholds the pack reads by date, by the dates each step starts. The pack
   * contract flags a table with no step in force on the current date (a rate that ran out, or one not started yet).
   */
  readonly datedTables: readonly DatedTable[];
  /**
   * What a purchase invoice's number-for-the-buyer rule asks of the expense side (Israel: the allocation number, MUT-557).
   * Every pack answers; a country without the rule answers false.
   */
  readonly expense: {
    readonly allocationNumberRequired: typeof allocationNumberRequired;
    readonly aboveAllocationThreshold: typeof aboveAllocationThreshold;
    readonly normalizeAllocationNumber: typeof normalizeAllocationNumber;
  };
  /**
   * The tax authority's pre-issue clearance (Israel: the allocation number, ADR-264). Absent where the country has none.
   * Israel-shaped until MUT-742/743 generalise it (the neutral `clearance` plan feature).
   */
  readonly clearance?: { readonly kind: string } & Pick<typeof TaxAuthorityService, 'needsAllocation' | 'allocationInvoiceId' | 'approvalRequest' | 'allocator' | 'manualAllocator' | 'DEFAULT_MANUAL_ALLOCATION_URL' | 'statusOf'>;
  /** The file the authority takes on request (Israel: the uniform file, מבנה אחיד 1.31). Absent where there is none. */
  readonly statutoryFile?: {
    readonly mime: string;
    readonly housePlaceholder: UniformFileHouse;
    /** The file and its zip for these documents; a 422 `UNIFORM_FILE_AMOUNT_TOO_LARGE` when a document will not fit. */
    readonly zipOf: (input: {
      house: UniformFileHouse;
      coreVersion: string;
      issuer: IssuerDetailsRecord;
      documents: IssuedDocumentRecord[];
      originals: Map<string, { docType: IssuedDocType; number: number }>;
      range: { from: string; to: string };
      now: Date;
      lang: 'ar' | 'en';
    }) => { file: UniformFile; zip: Uint8Array };
  };
}

/** One core document type under a country's law (MUT-741), and what its form asks of the person (MUT-743). */
export interface DocumentTypeFacts {
  readonly code: number;
  readonly vatBearing: boolean;
  readonly taxDocument: boolean;
  /** The form asks how the money came in. */
  readonly takesPayment: boolean;
  /** The form asks for a due date. */
  readonly hasDueDate: boolean;
  /** The form needs a client. */
  readonly needsCustomer: boolean;
}

/** One business type a country offers (MUT-743): what it may issue, and what the issue drawer starts with. */
export interface DealerRule {
  readonly value: DealerType;
  /** The key the client looks its label up by (the copy stays in the clients' own translations), `<country>.<value>`. */
  readonly labelKey: string;
  /** The document types it may issue, in the order shown; `dealer.refusal` refuses every other. */
  readonly issues: readonly IssuedDocType[];
  readonly exemptFromVat: boolean;
  /** What the drawer opens on. */
  readonly defaultType: IssuedDocType;
  /** What an entry that is already recorded may become: an Owed one, a Received one. */
  readonly entryTypes: { readonly owed: readonly IssuedDocType[]; readonly received: readonly IssuedDocType[] };
}

/** MUT-745: one dated table of a pack: its name (`vat.standardRate`) and the YYYY-MM-DD each step starts on, ascending. */
export interface DatedTable {
  readonly name: string;
  readonly starts: readonly string[];
}

/** What `composeDocument` needs from a pack. */
export type ComposePack = Pick<JurisdictionPack, 'currency' | 'documentTypes' | 'dealer' | 'vat'>;
