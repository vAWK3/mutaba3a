import { isScope, type Scope } from './scopes.js';

/**
 * The writability matrix (hosted-portal.md §5, ADR-037 decision 7) — the one
 * table that says what each principal may do per domain on a hosted profile.
 * The brief's table between the `writability-matrix` markers and this const
 * must stay identical (MUT-39 drift test).
 *
 * MUT-38 derives a session's effective scopes and the `access` map of
 * GET /v1/me from it; MUT-39 adds the READ_ONLY_PROFILE mapping and the store
 * guard on top of the same rows.
 */
export type Domain = 'integration' | 'customers' | 'projects' | 'agreements' | 'payments' | 'attachments' | 'summaries' | 'audit' | 'expenses' | 'identity';
export type Access = 'read-write' | 'read' | 'none';
export type WriterOfRecord = 'MALAFAT' | 'USER' | null;

export interface MatrixRow {
  domain: Domain;
  /** As published in the brief; `expenses:*` join the closed SCOPES vocabulary with MUT-42. */
  scopes: readonly string[];
  apiKey: Access;
  session: Access;
  writerOfRecord: WriterOfRecord;
}

export const WRITABILITY_MATRIX: readonly MatrixRow[] = [
  { domain: 'integration', scopes: ['integration:read', 'integration:write'], apiKey: 'read-write', session: 'none', writerOfRecord: null },
  { domain: 'customers', scopes: ['customers:read', 'customers:write'], apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'projects', scopes: ['projects:read', 'projects:write'], apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'agreements', scopes: ['agreements:read', 'agreements:write'], apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'payments', scopes: ['payments:read', 'payments:write'], apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'attachments', scopes: ['attachments:read', 'attachments:write'], apiKey: 'read-write', session: 'read', writerOfRecord: 'MALAFAT' },
  { domain: 'summaries', scopes: ['summaries:read'], apiKey: 'read', session: 'read', writerOfRecord: null },
  { domain: 'audit', scopes: ['audit:read'], apiKey: 'read', session: 'none', writerOfRecord: null },
  { domain: 'expenses', scopes: ['expenses:read', 'expenses:write'], apiKey: 'none', session: 'read-write', writerOfRecord: 'USER' },
  { domain: 'identity', scopes: [], apiKey: 'none', session: 'read-write', writerOfRecord: 'USER' },
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
