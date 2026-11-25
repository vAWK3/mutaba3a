/**
 * MUT-735 (ADR-281): what is metered, in closed vocabularies. Kinds, meters, doors and details are checked here, in
 * code, never by a Postgres enum, so a new kind needs no migration. Pure.
 *
 * Privacy (brief §2.10): a usage row holds counts and these codes only. Never an amount, a name, an email, a client or
 * free text: `assertDetail` refuses anything outside a kind's vocabulary.
 */

export const USAGE_KINDS = [
  'DOCUMENT_ISSUED',
  'SCAN',
  'EXTERNAL_INVOICE_READ',
  'ALLOCATION_REQUESTED',
  'PROFILE_CREATED',
  'PARTNER_ADDED',
  'PARTNER_REMOVED',
  'RECORDS_EXPORTED',
  'PERIOD_DOWNLOAD',
  'UNIFORM_FILE',
  'MCP_TOOL_CALL',
  'MAIL_SENT',
] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** The capped monthly meters (MUT-731/733 read them). Businesses and partners are stock counts, read live (§2.5). */
export const USAGE_METERS = ['DOCUMENTS', 'SCANS'] as const;
export type UsageMeter = (typeof USAGE_METERS)[number];

/** How the action reached the server. */
export const USAGE_DOORS = ['PORTAL', 'PHONE', 'MCP', 'MALAFAT', 'OPERATOR', 'JOB'] as const;
export type UsageDoor = (typeof USAGE_DOORS)[number];

/** The payer's plan when the action happened. `starter` is MUT-731's; `none` = nothing covers the payer. */
export const USAGE_PLANS = ['starter', 'solo', 'business', 'firm', 'freelancer', 'malafat', 'none'] as const;
export type UsagePlan = (typeof USAGE_PLANS)[number];

const DOC_TYPES = ['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_NOTE', 'RECEIPT', 'PAYMENT_REQUEST'] as const;

/** Each kind's `detail` codes; null = the kind carries no detail. */
export const DETAIL_VOCABULARY: Readonly<Record<UsageKind, readonly string[] | null>> = {
  DOCUMENT_ISSUED: DOC_TYPES,
  SCAN: ['LIBRARY', 'EXPENSE'],
  EXTERNAL_INVOICE_READ: null,
  ALLOCATION_REQUESTED: ['AUTOMATIC', 'MANUAL'],
  PROFILE_CREATED: null,
  PARTNER_ADDED: null,
  PARTNER_REMOVED: null,
  RECORDS_EXPORTED: null,
  PERIOD_DOWNLOAD: null,
  UNIFORM_FILE: null,
  MCP_TOOL_CALL: null,
  MAIL_SENT: null,
};

/** Throws on a detail outside the kind's vocabulary (a programming error, never a person's input). */
export function assertDetail(kind: UsageKind, detail: string | null): void {
  const vocabulary = DETAIL_VOCABULARY[kind];
  if (detail === null) return;
  if (!vocabulary?.includes(detail)) throw new Error(`usage ${kind}: detail ${JSON.stringify(detail)} is not in its vocabulary`);
}

/**
 * The counter a kind moves. Basel (2026-11-25, brief §11a): every issued document type counts toward `DOCUMENTS`;
 * MUT-731's cap check, not the meter, lets a receipt for a payment on an already-issued document through.
 */
export function meterOf(kind: UsageKind): UsageMeter | null {
  if (kind === 'DOCUMENT_ISSUED') return 'DOCUMENTS';
  if (kind === 'SCAN') return 'SCANS';
  return null;
}

/** The parts of a principal the door is read from (structural, so this module imports nothing). */
export type DoorPrincipal =
  | { kind: 'session'; sessionKind: 'cookie' | 'device' | null; delegated: boolean }
  | { kind: 'apiKey' }
  | { kind: 'agent' }
  | { kind: 'operator' }
  | { kind: 'job' };

export function doorOf(principal: DoorPrincipal): UsageDoor {
  switch (principal.kind) {
    case 'session':
      // MUT-593: a delegated call is Malafat acting as the person.
      if (principal.delegated) return 'MALAFAT';
      return principal.sessionKind === 'device' ? 'PHONE' : 'PORTAL';
    case 'apiKey':
      return 'MALAFAT';
    case 'agent':
      return 'MCP';
    case 'operator':
      return 'OPERATOR';
    case 'job':
      return 'JOB';
  }
}
