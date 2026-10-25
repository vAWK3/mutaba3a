import { Hono, type Context } from 'hono';
import { requestClientIp, type RequestPathSettings } from '../auth/sessions.js';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { authorizationServerMetadata, protectedResourceMetadata } from '../oauth/protocol.js';
import type { OAuthService } from '../oauth/service.js';
import { SlidingWindowRateLimiter, type RateLimiter } from '../rate-limit.js';

/** MUT-434 (AC5): budgets for the anonymous protocol endpoints, like sign-in's; per Cloud Run instance (TD). */
export const OAUTH_POLICY = {
  registerPerIpPerHour: 10,
  authorizePerIpPerMinute: 30,
  tokenPerClientPerMinute: 60,
  tokenPerIpPerMinute: 120,
  revokePerIpPerMinute: 60,
} as const;

/** Where every authorization outcome the person must see lands: the portal's approve page (structure B, D1). */
export const CONSENT_PATH = '/connect/approve';

export interface OAuthLimiters {
  register: RateLimiter;
  authorize: RateLimiter;
  tokenClient: RateLimiter;
  tokenIp: RateLimiter;
  revoke: RateLimiter;
}

export function defaultOAuthLimiters(): OAuthLimiters {
  return {
    register: new SlidingWindowRateLimiter(OAUTH_POLICY.registerPerIpPerHour, 3_600_000),
    authorize: new SlidingWindowRateLimiter(OAUTH_POLICY.authorizePerIpPerMinute),
    tokenClient: new SlidingWindowRateLimiter(OAUTH_POLICY.tokenPerClientPerMinute),
    tokenIp: new SlidingWindowRateLimiter(OAUTH_POLICY.tokenPerIpPerMinute),
    revoke: new SlidingWindowRateLimiter(OAUTH_POLICY.revokePerIpPerMinute),
  };
}

export interface OAuthRouteOptions {
  /** Null = not configured: every path here answers 503 OAUTH_NOT_CONFIGURED. */
  service: OAuthService | null;
  limiters: OAuthLimiters;
  paths: RequestPathSettings;
}

/** Browser-based MCP clients read these cross-origin; no credentials are ever involved. */
function allowCors(c: Context): void {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'authorization, content-type, mcp-protocol-version');
  c.header('Access-Control-Max-Age', '600');
}

/** An RFC 6749/7591 error body, the only shape an OAuth client reads; our own context is never appended. */
function oauthError(c: Context, status: 400 | 429, error: string, description: string) {
  return c.json({ error, error_description: description }, status);
}

/**
 * MUT-434 (ADR-197): the OAuth 2.1 endpoints and discovery documents, outside /v1 and outside the OpenAPI document —
 * standards endpoints described by their own metadata, like /health. They run on the raw store (as sign-in does) and
 * never log a body or a query string: codes, verifiers and tokens only ever pass through (D16).
 */
export function oauthRoutes(options: OAuthRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ipOf = (c: Context) => requestClientIp((name) => c.req.header(name), options.paths);
  const service = (): OAuthService => {
    if (!options.service) throw new ApiError('OAUTH_NOT_CONFIGURED', 'Connecting an agent is not available on this server');
    return options.service;
  };
  const limited = async (limiter: RateLimiter, key: string, c: Context<AppEnv>) => {
    const decision = await limiter.check(key, c.get('now')());
    if (!decision.allowed) c.header('Retry-After', String(decision.retryAfterSeconds));
    return !decision.allowed;
  };
  const formOf = async (c: Context): Promise<Record<string, string | undefined>> => {
    const body = await c.req.parseBody().catch(() => ({}));
    return Object.fromEntries(Object.entries(body).filter((e): e is [string, string] => typeof e[1] === 'string'));
  };

  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/oauth/register', '/oauth/token', '/oauth/revoke']) {
    app.options(path, (c) => {
      allowCors(c);
      return c.body(null, 204);
    });
  }

  app.get('/.well-known/oauth-authorization-server', (c) => {
    allowCors(c);
    return c.json(authorizationServerMetadata(service().issuer), 200);
  });
  // RFC 9728 §3.1: the path-suffixed form for the /mcp resource, and the bare one some clients try first.
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    app.get(path, (c) => {
      allowCors(c);
      return c.json(protectedResourceMetadata(service().issuer), 200);
    });
  }

  app.post('/oauth/register', async (c) => {
    allowCors(c);
    const oauth = service();
    if (await limited(options.limiters.register, `oauth-register:${ipOf(c)}`, c)) return oauthError(c, 429, 'temporarily_unavailable', 'Too many registrations from this address');
    const body: unknown = await c.req.json().catch(() => null);
    const result = await oauth.register(body, c.get('now')());
    if (!result.ok) return oauthError(c, 400, result.error, result.description);
    const { client } = result;
    return c.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      201,
    );
  });

  app.get('/oauth/authorize', async (c) => {
    const oauth = service();
    if (await limited(options.limiters.authorize, `oauth-authorize:${ipOf(c)}`, c)) return c.redirect(`${CONSENT_PATH}?error=temporarily_unavailable`, 302);
    const result = await oauth.startAuthorization(c.req.query(), c.get('now')());
    switch (result.kind) {
      case 'consent':
        return c.redirect(`${CONSENT_PATH}?request=${encodeURIComponent(result.requestId)}`, 302);
      case 'redirect':
        return c.redirect(result.redirectTo, 302);
      case 'page_error':
        return c.redirect(`${CONSENT_PATH}?error=${result.error}`, 302);
    }
  });

  app.post('/oauth/token', async (c) => {
    allowCors(c);
    const oauth = service();
    const form = await formOf(c);
    if (await limited(options.limiters.tokenIp, `oauth-token-ip:${ipOf(c)}`, c)) return oauthError(c, 429, 'temporarily_unavailable', 'Too many token requests from this address');
    if (form.client_id && (await limited(options.limiters.tokenClient, `oauth-token:${form.client_id}`, c))) return oauthError(c, 429, 'temporarily_unavailable', 'Too many token requests for this client');
    const result = await oauth.token(form, c.get('now')());
    c.header('Pragma', 'no-cache');
    return c.json(result.body, result.status);
  });

  app.post('/oauth/revoke', async (c) => {
    allowCors(c);
    const oauth = service();
    if (await limited(options.limiters.revoke, `oauth-revoke:${ipOf(c)}`, c)) return oauthError(c, 429, 'temporarily_unavailable', 'Too many revocations from this address');
    const { token } = await formOf(c);
    if (token) await oauth.revokeToken(token, c.get('now')());
    // RFC 7009 §2.2: 200 whether or not the token was known.
    return c.body(null, 200);
  });

  return app;
}
