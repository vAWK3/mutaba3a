/**
 * API key scope vocabulary (plan §10.1 "least-privilege scopes", §13.2).
 *
 * Closed and published: the list is emitted into openapi.yaml, so adding a
 * scope is a contract change. Scopes are non-hierarchical on purpose —
 * `payments:write` does not imply `payments:read` — so a key's permissions
 * read literally on the Malafat connection screen.
 *
 * Only `integration:*` is enforced by a route in Milestone 1; the rest exist
 * so a key issued today does not need re-issuing when M2–M6 land.
 */
export const SCOPES = [
  'integration:read',
  'integration:write',
  'customers:read',
  'customers:write',
  'projects:read',
  'projects:write',
  'agreements:read',
  'agreements:write',
  'payments:read',
  'payments:write',
  'attachments:read',
  'attachments:write',
  'summaries:read',
  'audit:read',
] as const;

/** A scope an API key may hold: the published vocabulary above. */
export type KeyScope = (typeof SCOPES)[number];

/**
 * Scopes only a user session holds (MUT-42 D4): the expenses row of the
 * writability matrix, which Malafat's key has no column in. Never issuable to
 * a key, never in SCOPES, so the vocabulary Malafat sees is unchanged.
 */
export const SESSION_ONLY_SCOPES = ['expenses:read', 'expenses:write'] as const;
export type SessionOnlyScope = (typeof SESSION_ONLY_SCOPES)[number];

/** Anything requireScope can demand. */
export type Scope = KeyScope | SessionOnlyScope;

/** The scopes Malafat's integration requires; reported by GET /v1/integration. */
export const MALAFAT_REQUIRED_SCOPES: readonly KeyScope[] = [
  'integration:read',
  'integration:write',
  'customers:read',
  'customers:write',
  'projects:read',
  'projects:write',
  'agreements:read',
  'agreements:write',
  'payments:read',
  'payments:write',
  'attachments:read',
  'attachments:write',
  'summaries:read',
  'audit:read',
];

export function isKeyScope(value: string): value is KeyScope {
  return (SCOPES as readonly string[]).includes(value);
}

export function isScope(value: string): value is Scope {
  return isKeyScope(value) || (SESSION_ONLY_SCOPES as readonly string[]).includes(value);
}

export type ParseScopesResult = { ok: true; scopes: KeyScope[] } | { ok: false; invalid: string[] };

/** Key issuance. Unknown scopes (session-only ones included) fail the whole list; a silently narrowed grant is worse than a refused one. */
export function parseScopes(values: readonly string[]): ParseScopesResult {
  const invalid = values.filter((v) => !isKeyScope(v));
  if (invalid.length > 0) return { ok: false, invalid };
  const scopes: KeyScope[] = [];
  for (const v of values) {
    if (isKeyScope(v) && !scopes.includes(v)) scopes.push(v);
  }
  return { ok: true, scopes };
}

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required);
}

export function missingScopes<S extends Scope>(granted: readonly string[], required: readonly S[]): S[] {
  return required.filter((s) => !granted.includes(s));
}
