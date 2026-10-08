import type { Context, MiddlewareHandler } from 'hono';
import { ApiError } from '../errors.js';
import type { LedgerStore, ApiKeyRecord, Organization } from '../repositories/ports.js';
import type { RateLimiter } from '../rate-limit.js';
import { hashApiKey, hashesMatch, parseApiKey, type ApiKeyEnvironment } from './api-key.js';
import { hasScope, type Scope } from './scopes.js';

/** What every authenticated route can read from the context. */
export interface AuthContext {
  organization: Organization;
  apiKey: ApiKeyRecord;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    auth: AuthContext;
    now: () => Date;
  };
};

export interface ApiKeyAuthOptions {
  store: LedgerStore;
  environment: ApiKeyEnvironment;
  rateLimiter: RateLimiter;
}

/**
 * Bearer API-key authentication (plan §13.2: validity, scope, organization,
 * revocation, environment — in that order, every request, uncached).
 *
 * Failure modes are distinct codes so Malafat can tell a Partner exactly what
 * happened (UX brief D13): malformed key, unknown key, wrong environment,
 * revoked, expired. Scope is checked per route by `requireScope`.
 */
export function apiKeyAuth(options: ApiKeyAuthOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const presented = bearerToken(c);
    if (!presented) throw new ApiError('UNAUTHENTICATED', 'Missing Authorization: Bearer <api key> header');

    const parsed = parseApiKey(presented);
    if (!parsed) throw new ApiError('INVALID_API_KEY', 'The API key is malformed');

    if (parsed.environment !== options.environment) {
      throw new ApiError(
        'API_KEY_ENVIRONMENT_MISMATCH',
        `This deployment accepts "${options.environment}" keys; the presented key is "${parsed.environment}"`,
      );
    }

    const record = await options.store.apiKeys.findByPrefix(parsed.prefix);
    if (!record || !hashesMatch(record.keyHash, hashApiKey(presented))) {
      throw new ApiError('INVALID_API_KEY', 'The API key is not recognised');
    }

    const now = c.get('now')();
    if (record.revokedAt) throw new ApiError('API_KEY_REVOKED', 'The API key has been revoked');
    if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
      throw new ApiError('API_KEY_EXPIRED', 'The API key has expired');
    }

    const organization = await options.store.organizations.getById(record.organizationId);
    if (!organization) throw new ApiError('INVALID_API_KEY', 'The API key is not attached to an organization');

    const decision = await options.rateLimiter.check(record.id, now);
    c.header('X-RateLimit-Limit', String(decision.limit));
    c.header('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiError('RATE_LIMITED', 'Too many requests for this API key', {
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }

    c.set('auth', { organization, apiKey: record });
    await options.store.apiKeys.touchLastUsed(record.id, now);
    await next();
  };
}

export function requireScope(scope: Scope): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!hasScope(auth.apiKey.scopes, scope)) {
      throw new ApiError('INSUFFICIENT_SCOPE', `This operation requires the "${scope}" scope`, {
        required: scope,
        granted: auth.apiKey.scopes,
      });
    }
    await next();
  };
}

function bearerToken(c: Context): string | null {
  const header = c.req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ', 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}
