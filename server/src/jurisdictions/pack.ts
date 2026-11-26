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
  };
  /** What each core document type is under this country's law. */
  readonly documentTypes: Readonly<Record<IssuedDocType, { readonly code: number; readonly vatBearing: boolean; readonly taxDocument: boolean }>>;
  readonly dealer: {
    /** A dealer with no VAT to charge (Israel: עוסק פטור). */
    readonly exemptFromVat: (dealer: DealerType) => boolean;
    /** Why this dealer may not issue this document, or null when it may. */
    readonly refusal: (dealer: DealerType, docType: IssuedDocType) => { readonly reason: string; readonly message: string } | null;
  };
  readonly vat: {
    /** The standard rate in basis points on a document date (YYYY-MM-DD). */
    readonly rateOn: (date: string) => number;
  };
  readonly retention: {
    /** Years an issued document is kept from its date. */
    readonly years: number;
  };
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
  readonly clearance?: Pick<typeof TaxAuthorityService, 'needsAllocation' | 'allocationInvoiceId' | 'approvalRequest' | 'allocator' | 'manualAllocator' | 'DEFAULT_MANUAL_ALLOCATION_URL' | 'statusOf'>;
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

/** What `composeDocument` needs from a pack. */
export type ComposePack = Pick<JurisdictionPack, 'currency' | 'documentTypes' | 'dealer' | 'vat'>;
