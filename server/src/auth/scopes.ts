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

export type Scope = (typeof SCOPES)[number];

/** The scopes Malafat's integration requires; reported by GET /v1/integration. */
export const MALAFAT_REQUIRED_SCOPES: readonly Scope[] = [
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

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

export type ParseScopesResult = { ok: true; scopes: Scope[] } | { ok: false; invalid: string[] };

/** Unknown scopes fail the whole list; a silently narrowed grant is worse than a refused one. */
export function parseScopes(values: readonly string[]): ParseScopesResult {
  const invalid = values.filter((v) => !isScope(v));
  if (invalid.length > 0) return { ok: false, invalid };
  const scopes: Scope[] = [];
  for (const v of values) {
    if (isScope(v) && !scopes.includes(v)) scopes.push(v);
  }
  return { ok: true, scopes };
}

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required);
}

export function missingScopes(granted: readonly string[], required: readonly Scope[]): Scope[] {
  return required.filter((s) => !granted.includes(s));
}
