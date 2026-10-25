import type { Context, MiddlewareHandler } from 'hono';
import { closingRefusal, isAccountGone } from '../accounts/closure.js';
import { ApiError } from '../errors.js';
import { hasFeature } from '../features.js';
import { agentAuditFor } from '../oauth/audit.js';
import type { OAuthService } from '../oauth/service.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore } from '../repositories/ports.js';
import type { AppEnv } from './middleware.js';
import { agentStoreGuard } from './store-guard.js';

/** lastUsedAt is written at most once a minute, as sessions are. */
const TOUCH_INTERVAL_MS = 60_000;

export interface AgentAuthOptions {
  /** Null = OAuth not configured: /mcp answers 503 OAUTH_NOT_CONFIGURED. */
  service: OAuthService | null;
  /** The raw store, read the way authenticate() reads sessions. */
  store: LedgerStore;
  rateLimiter: RateLimiter;
}

function bearerOf(c: Context): string | null {
  const [scheme, token] = (c.req.header('authorization') ?? '').split(' ', 2);
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : null;
}

/**
 * MUT-434 (plan §3.4): authentication for /mcp, every request, uncached, in this order — a well-formed access token on
 * a live grant bound to this resource; an ACTIVE person whose account isn't gone (else the grant is revoked); no
 * closure in progress (AC8); the `agent_access` flag (AC6, read on every call); the rate limit. A missing or bad token
 * gets 401 with the RFC 9728 pointer so an MCP client can start sign-in; policy refusals are 403 with the API's error
 * envelope and no step-up hint (OV8), so a client doesn't loop into re-authorization.
 */
export function authenticateAgent(options: AgentAuthOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { service } = options;
    if (!service) throw new ApiError('OAUTH_NOT_CONFIGURED', 'Connecting an agent is not available on this server');
    const now = c.get('now')();
    const token = bearerOf(c);
    const metadata = `${service.issuer}/.well-known/oauth-protected-resource/mcp`;
    const challenge = (error?: string) => {
      c.header('WWW-Authenticate', `Bearer resource_metadata="${metadata}", scope="read write"${error ? `, error="${error}"` : ''}`);
      return new ApiError('UNAUTHENTICATED', error ? 'The access token is invalid or has expired' : 'Sign in to MTB3A to connect this agent');
    };
    if (!token) throw challenge();
    const found = await service.authenticateAccess(token, now);
    if (!found) throw challenge('invalid_token');

    const { grant } = found;
    const user = await options.store.users.getById(grant.userId);
    if (!user || user.status !== 'ACTIVE' || isAccountGone(user.closure, now)) {
      const audit = await agentAuditFor(options.store)({ userId: grant.userId, action: 'user.agent_disconnected', metadata: { reason: 'account_changed' }, actor: { actorType: 'SYSTEM', actorId: null }, requestId: c.get('requestId') });
      await options.store.oauth.revokeGrant({ grantId: grant.id, reason: 'account_changed', at: now, audit });
      throw challenge('invalid_token');
    }
    if (user.closure) throw closingRefusal(user.closure);
    if (!(await hasFeature(options.store, user.id, 'agent_access'))) {
      throw new ApiError('FEATURE_NOT_ENABLED', 'Connecting an agent is not turned on for this account', { feature: 'agent_access' });
    }

    const decision = await options.rateLimiter.check(`agent:${grant.id}`, now);
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiError('RATE_LIMITED', 'Too many requests from this agent', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) await options.store.oauth.touchGrant(grant.id, now);

    c.set('agent', { user, grant });
    c.set('storeGuard', agentStoreGuard());
    await next();
  };
}
