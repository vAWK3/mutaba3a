import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { AppEnv, AuthContext } from './auth/middleware.js';
import { ApiError } from './errors.js';
import type { IdempotencyClaim, LedgerStore, UserIdempotencyClaim } from './repositories/ports.js';

/**
 * Idempotent financial writes (plan §11, §14.2, G4).
 *
 * Every POST that changes ledger state must carry `Idempotency-Key`. The
 * middleware claims (organization, key) before the handler runs:
 *   new         → run the handler, persist its status+body as the outcome
 *   replay      → return the persisted outcome, with `Idempotent-Replayed: true`
 *   mismatch    → 422 IDEMPOTENCY_KEY_REUSED (same key, different request)
 *   in_progress → 409 OPERATION_IN_PROGRESS (a concurrent request owns it)
 *
 * A 5xx releases the key so the client may retry; 2xx and 4xx are final.
 * The fingerprint covers method, path and body, so the same key cannot be
 * replayed against a different operation. The body counts by meaning, not
 * bytes (MUT-199): see `requestFingerprint`.
 */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

function requireKey(c: Context<AppEnv>, operation: string): string {
  const key = c.req.header(IDEMPOTENCY_HEADER);
  if (!key) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED', `${IDEMPOTENCY_HEADER} header is required for ${operation}`);
  if (!KEY_RE.test(key)) {
    throw new ApiError('VALIDATION_FAILED', `${IDEMPOTENCY_HEADER} must be 8–128 characters of [A-Za-z0-9_-:.]`);
  }
  return key;
}

interface ClaimOps {
  claim(args: { key: string; operation: string; fingerprint: string; at: Date }): Promise<IdempotencyClaim | UserIdempotencyClaim>;
  complete(args: { key: string; responseStatus: number; responseBody: unknown; at: Date }): Promise<void>;
  fail(args: { key: string; at: Date }): Promise<void>;
}

/**
 * The claim/next()/complete-or-fail flow every idempotent write follows,
 * regardless of what it's partitioned by (organization or user, MUT-131).
 * [ops] already closes over that partition key.
 */
async function withIdempotency(c: Context<AppEnv>, next: Next, operation: string, claimKey: string, ops: ClaimOps) {
  const now = c.get('now')();
  const body = await c.req.raw.clone().text();
  const fingerprint = requestFingerprint(c.req.method, c.req.path, body);

  let claim = await ops.claim({ key: claimKey, operation, fingerprint, at: now });
  if (claim.kind === 'mismatch') {
    // A key stored before MUT-199 carries the byte fingerprint; a byte-identical replay of it must still replay.
    // Comparing is all a claim does to an existing key, so the second call has no other effect.
    const legacy = byteFingerprint(c.req.method, c.req.path, body);
    if (legacy !== fingerprint) claim = await ops.claim({ key: claimKey, operation, fingerprint: legacy, at: now });
  }

  switch (claim.kind) {
    case 'mismatch':
      throw new ApiError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
    case 'in_progress':
      throw new ApiError('OPERATION_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
    case 'replay':
      c.header('Idempotent-Replayed', 'true');
      return c.json(claim.record.responseBody as object, (claim.record.responseStatus ?? 200) as 200);
    case 'new':
      break;
  }

  try {
    await next();
  } catch (err) {
    await ops.fail({ key: claimKey, at: now });
    throw err;
  }

  const res = c.res;
  // A 5xx or a 429 means nothing was done: release the key so the same request can be sent again with it (MUT-255
  // review). Every other answer, 4xx included, is the request's final one and replays as such.
  if (res.status >= 500 || res.status === 429) {
    await ops.fail({ key: claimKey, at: now });
    return;
  }
  const text = await res.clone().text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  await ops.complete({ key: claimKey, responseStatus: res.status, responseBody: parsed, at: c.get('now')() });
}

/**
 * What makes two requests "the same" for a key (MUT-199): method, path and the body's meaning. A JSON body is
 * re-serialised with sorted keys and no insignificant whitespace or escaping, so the phone widget's Swift encoding
 * (random key order, `\/`) and the app's Dart encoding of one capture match. Array order still counts. A body that is
 * not JSON counts byte for byte. Numbers go through a double; the API sends money as strings, so no amount is affected.
 */
export function requestFingerprint(method: string, path: string, body: string): string {
  return sha256(`${method}\n${path}\n${canonicalBody(body)}`);
}

function byteFingerprint(method: string, path: string, body: string): string {
  return sha256(`${method}\n${path}\n${body}`);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function canonicalBody(body: string): string {
  if (!body) return body;
  try {
    return canonicalJson(JSON.parse(body));
  } catch {
    return body;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function idempotent(store: LedgerStore, operation: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = requireKey(c, operation);
    const auth = c.get('auth');
    const claimKey = claimKeyFor(auth, key);
    return withIdempotency(c, next, operation, claimKey, {
      claim: (args) => store.idempotency.claim({ organizationId: auth.organization.id, ...args }),
      complete: (args) => store.idempotency.complete({ organizationId: auth.organization.id, ...args }),
      fail: (args) => store.idempotency.fail({ organizationId: auth.organization.id, ...args }),
    });
  };
}

/**
 * MUT-131: the same contract as [idempotent], for a route with no
 * organization at all (POST /v1/inbox) — partitioned by the signed-in
 * person instead. No `claimKeyFor`-style hashing needed: the userId column
 * already fully isolates one person's claims, since there's no second
 * principal (an API key has no identity, MUT-66) it could ever collide with.
 */
export function identityIdempotent(store: LedgerStore, operation: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = requireKey(c, operation);
    const userId = c.get('identity').user.id;
    return withIdempotency(c, next, operation, key, {
      claim: (args) => store.userIdempotency.claim({ userId, ...args }),
      complete: (args) => store.userIdempotency.complete({ userId, ...args }),
      fail: (args) => store.userIdempotency.fail({ userId, ...args }),
    });
  };
}

/**
 * The key a write is claimed under (MUT-42 brief §2). A session's keys live in
 * its user's namespace, so Malafat's GET /v1/operations/{key} can never return
 * a session's stored response, and the two principals never collide on a key.
 * API keys keep the bare key, as before.
 */
export function claimKeyFor(auth: AuthContext, key: string): string {
  return auth.kind === 'session' ? sessionClaimKey(auth.user.id, key) : key;
}

/** `s:` + SHA-256 of user and key: 66 characters, so it fits the existing 128-character column. Reaching it from another principal would take the session's own key and user id. */
export function sessionClaimKey(userId: string, key: string): string {
  return `s:${createHash('sha256').update(`${userId}\n${key}`).digest('hex')}`;
}
