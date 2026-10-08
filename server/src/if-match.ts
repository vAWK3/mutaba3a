import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './auth/middleware.js';
import { ApiError } from './errors.js';

/**
 * Optimistic concurrency for PATCH (contract §1 "Concurrency"): the client
 * sends the `version` it read in `If-Match`; the store applies the write only
 * if that is still the current version. Missing or malformed → 422; the
 * stale case is the route's 409 CONFLICT / VERSION_MISMATCH.
 */
export const IF_MATCH_HEADER = 'If-Match';

export function ifMatch(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = c.req.header(IF_MATCH_HEADER);
    if (raw === undefined) throw new ApiError('VALIDATION_FAILED', `${IF_MATCH_HEADER} header (the version you read) is required`, { field: 'If-Match' });
    const version = Number(raw.trim().replace(/^"|"$/g, ''));
    if (!Number.isInteger(version) || version < 1) {
      throw new ApiError('VALIDATION_FAILED', `${IF_MATCH_HEADER} must be a positive integer version`, { field: 'If-Match' });
    }
    c.set('expectedVersion', version);
    await next();
  };
}
