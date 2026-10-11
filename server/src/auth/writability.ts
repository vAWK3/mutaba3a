import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import { isScope, type Scope } from './scopes.js';

/**
 * The writability matrix (hosted-portal.md §5, ADR-037 decision 7) — the one
 * table that says what each principal may do per domain on a hosted profile.
 * The brief's table between the `writability-matrix` markers and this const
 * must stay identical (MUT-39 drift test).
 *
 * MUT-38 derives a session's effective scopes and the `access` map of
 * GET /v1/me from it; MUT-39 maps a refused write to READ_ONLY_PROFILE in
 * authenticate() and requireScope(), and drives the store guard
 * (store-guard.ts) from the same rows.
 */
export type Domain = 'integration' | 'customers' | 'projects' | 'agreements' | 'payments' | 'attachments' | 'summaries' | 'audit' | 'expenses' | 'identity';
export type Access = 'read-write' | 'read' | 'none';
export type WriterOfRecord = 'MALAFAT' | 'USER' | null;
/** The two columns of the matrix that are enforced on the server. */
export type Principal = 'apiKey' | 'session';
/** Whose ledger a hosted profile is: Malafat's when its integration is CONNECTED, otherwise null (a personal profile). */
export type ProfileWriter = 'MALAFAT' | null;

export interface MatrixRow {
  domain: Domain;
  /** As published in the brief; `expenses:*` are session-only scopes (MUT-42 D4), never issuable to a key. */
  scopes: readonly string[];
  /** The brief's "Routes covered" cell, verbatim. */
  routes: string;
  apiKey: Access;
  session: Access;
  writerOfRecord: WriterOfRecord;
}

export const WRITABILITY_MATRIX: readonly MatrixRow[] = [
  { domain: 'integration', scopes: ['integration:read', 'integration:write'], routes: '/v1/integration*, /v1/api-keys/self/revoke', apiKey: 'read-write', session: 'none', writerOfRecord: null },
  { domain: 'customers', scopes: ['customers:read', 'customers:write'], routes: '/v1/customers*, /v1/import/*', apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'projects', scopes: ['projects:read', 'projects:write'], routes: '/v1/projects*, /v1/import/*', apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'agreements', scopes: ['agreements:read', 'agreements:write'], routes: '/v1/agreements*, /v1/installments/*, /v1/retainers* (except charges), /v1/fee-proposals*, /v1/vat-rates, /v1/settings/vat', apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'payments', scopes: ['payments:read', 'payments:write'], routes: '/v1/receivables*, /v1/payments*, /v1/allocations/*, /v1/retainers/{id}/charges, /v1/operations/*', apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'attachments', scopes: ['attachments:read', 'attachments:write'], routes: '/v1/attachments*', apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'summaries', scopes: ['summaries:read'], routes: '/v1/summaries/* (except expenses)', apiKey: 'read', session: 'read', writerOfRecord: null },
  { domain: 'audit', scopes: ['audit:read'], routes: '/v1/audit', apiKey: 'read', session: 'none', writerOfRecord: null },
  { domain: 'expenses', scopes: ['expenses:read', 'expenses:write'], routes: '/v1/expenses*, /v1/expense-categories*, /v1/summaries/expenses', apiKey: 'none', session: 'read-write', writerOfRecord: 'USER' },
  { domain: 'identity', scopes: [], routes: '/v1/me, /v1/sessions/current', apiKey: 'none', session: 'read-write', writerOfRecord: 'USER' },
];

function granted(access: Access, scope: string): boolean {
  if (access === 'none') return false;
  return access === 'read-write' || scope.endsWith(':read');
}

/** The scopes a user session holds on any hosted profile, in the closed vocabulary. */
export function sessionScopes(): readonly Scope[] {
  return WRITABILITY_MATRIX.flatMap((row) => row.scopes.filter((s) => granted(row.session, s))).filter(isScope);
}

/** The session column, as the `access` map GET /v1/me publishes per profile. */
export function sessionAccess(): Record<Domain, Access> {
  return Object.fromEntries(WRITABILITY_MATRIX.map((row) => [row.domain, row.session])) as Record<Domain, Access>;
}

export function matrixRow(domain: Domain): MatrixRow {
  const row = WRITABILITY_MATRIX.find((r) => r.domain === domain);
  if (!row) throw new Error(`No writability row for ${domain}`);
  return row;
}

/** The row a scope belongs to, e.g. `payments:write` → payments. */
export function domainOfScope(scope: string): Domain | undefined {
  return WRITABILITY_MATRIX.find((r) => r.scopes.includes(scope))?.domain;
}

export function mayRead(principal: Principal, domain: Domain): boolean {
  return matrixRow(domain)[principal] !== 'none';
}

export function mayWrite(principal: Principal, domain: Domain): boolean {
  return matrixRow(domain)[principal] === 'read-write';
}

/**
 * The refusal for a write the matrix does not grant (ADR-037 decision 7).
 * On a row Malafat writes it is READ_ONLY_PROFILE, carrying the profile's own
 * writer of record so the UI can explain; anywhere else the principal simply
 * has no business there. Neither names another organization.
 */
export function writeRefusal(domain: Domain, profileWriter: ProfileWriter): ApiError {
  if (matrixRow(domain).writerOfRecord !== 'MALAFAT') {
    return new ApiError('PRINCIPAL_NOT_ACCEPTED', 'This operation does not accept this kind of credential');
  }
  const message =
    profileWriter === 'MALAFAT'
      ? `Malafat is the writer of record for ${domain} on this profile; change them in Malafat`
      : `${domain} are read-only on this profile`;
  return new ApiError('READ_ONLY_PROFILE', message, { domain, writerOfRecord: profileWriter });
}

/** hosted-portal.md §5 layer 1: MALAFAT when the organization has a CONNECTED Malafat integration. */
export async function profileWriterOf(store: Pick<LedgerStore, 'integrations'>, organizationId: string): Promise<ProfileWriter> {
  const malafat = await store.integrations.findByOrganizationAndProvider(organizationId, 'MALAFAT');
  return malafat?.status === 'CONNECTED' ? 'MALAFAT' : null;
}
