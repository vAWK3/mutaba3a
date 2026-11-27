import type { ComposeInput } from '../../../issuing/compose.js';
import type { DealerType, IssuedDocType } from '../../../issuing/types.js';
import type { AccountantHarness } from '../../../__tests__/helpers/accountants.js';
import type { DealerRule, DocumentTypeFacts } from '../../pack.js';

/**
 * MUT-745: what a pack's tests need from it, written out by hand. Every registered pack must have one (the contract suite
 * fails a pack without): its exact rules (`expected`), its golden documents (`golden`) and what the route contract issues
 * with (`route`). A fixture is the pack's spec: a value here changes only with a deliberate rules change (a new pack version).
 */
export interface PackFixture {
  readonly country: string;
  readonly expected: PackExpectations;
  readonly golden: PackGolden;
  readonly route: PackRouteFixture;
}

export interface PackExpectations {
  readonly identity: { country: string; version: string; timezone: string; currency: { base: string; issuing: readonly string[] }; retentionYears: number };
  readonly documentTypes: Readonly<Record<IssuedDocType, DocumentTypeFacts>>;
  /** Document types by ascending code: the order the authority numbers them in. */
  readonly codeOrder: readonly IssuedDocType[];
  /** `[date, basis points]`: the standard VAT rate on that document date, edges of each step included. */
  readonly vatOn: readonly (readonly [string, number])[];
  /** The business types in the order shown, each exactly as the pack must answer it. */
  readonly dealers: readonly DealerRule[];
  /** The reason every refusal of a dealer/document pair carries. */
  readonly refusalReason: string | null;
  readonly languages: { available: readonly string[]; default: string };
  readonly taxId: { scheme: string; pattern: string; maxLength: number; valid: readonly string[]; invalid: readonly string[] };
  readonly perLineExemption: boolean;
  readonly clearanceKind: string | null;
  readonly statutoryFileMime: string | null;
  readonly datedTables: readonly string[];
}

export interface GoldenCase {
  readonly name: string;
  readonly docType: IssuedDocType;
  readonly dealer: DealerType;
  readonly date: string;
  readonly extra?: Partial<Omit<ComposeInput, 'pack'>>;
  /** sha256 of the composed document (bigints as `<n>n`). */
  readonly sha: string;
}

export interface PackGolden {
  readonly currency: string;
  readonly lines: ComposeInput['lines'];
  readonly documentDiscountMinor: bigint;
  readonly pricesIncludeVat: boolean;
  readonly composed: readonly GoldenCase[];
  /** The pack's other golden outputs (a statutory file's bytes, …): each `actual` must equal its `expected`. */
  readonly files?: () => readonly { name: string; actual: unknown; expected: unknown }[];
}

export interface PackRouteFixture {
  /** The body of PUT /v1/issuer: a valid issuer of this country. */
  readonly issuer: Record<string, unknown>;
  /** A small document every issuer above may issue, with a customer, below any clearance threshold. */
  readonly document: (customerId: string) => Record<string, unknown>;
  /** Required when the pack has `clearance`: a harness where clearance is reachable, and how to make it refuse. */
  readonly clearanceFailure?: {
    readonly harness: () => AccountantHarness;
    /** After the issuer and numbering are set: connect, and script the authority to refuse the next request. */
    readonly prepare: (h: AccountantHarness, on: Record<string, string>) => Promise<void>;
    /** The customer the clearing document is for (a business with a tax ID). */
    readonly customer: Record<string, unknown>;
    /** A document that needs clearance. */
    readonly document: (customerId: string) => Record<string, unknown>;
    readonly reason: string;
  };
}
