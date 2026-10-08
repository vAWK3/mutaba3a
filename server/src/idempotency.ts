import { createHash } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './auth/middleware.js';
import { ApiError } from './errors.js';
import type { LedgerStore } from './repositories/ports.js';

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
 * replayed against a different operation.
 */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

export function idempotent(store: LedgerStore, operation: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_HEADER);
    if (!key) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED', `${IDEMPOTENCY_HEADER} header is required for ${operation}`);
    if (!KEY_RE.test(key)) {
      throw new ApiError('VALIDATION_FAILED', `${IDEMPOTENCY_HEADER} must be 8–128 characters of [A-Za-z0-9_-:.]`);
    }

    const auth = c.get('auth');
    const now = c.get('now')();
    const body = await c.req.raw.clone().text();
    const fingerprint = createHash('sha256').update(`${c.req.method}\n${c.req.path}\n${body}`).digest('hex');

    const claim = await store.idempotency.claim({
      organizationId: auth.organization.id,
      key,
      operation,
      fingerprint,
      at: now,
    });

    switch (claim.kind) {
      case 'mismatch':
        throw new ApiError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
      case 'in_progress':
        throw new ApiError('OPERATION_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
      case 'replay': {
        c.header('Idempotent-Replayed', 'true');
        return c.json(claim.record.responseBody as object, (claim.record.responseStatus ?? 200) as 200);
      }
      case 'new':
        break;
    }

    try {
      await next();
    } catch (err) {
      await store.idempotency.fail({ organizationId: auth.organization.id, key, at: now });
      throw err;
    }

    const res = c.res;
    if (res.status >= 500) {
      await store.idempotency.fail({ organizationId: auth.organization.id, key, at: now });
      return;
    }
    const text = await res.clone().text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    await store.idempotency.complete({
      organizationId: auth.organization.id,
      key,
      responseStatus: res.status,
      responseBody: parsed,
      at: c.get('now')(),
    });
  };
}
