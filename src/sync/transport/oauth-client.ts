/**
 * OAuth 2.1 authorization-code client for Malafat (*.malafat.app).
 *
 * MUT-28 spike. Mutaba3a registers as a public CIMD client and obtains a
 * per-tenant token so it can sync money data to a firm's workspace. Malafat
 * already runs the server side (apps/web/src/features/oauth/), so this module
 * is only the client half of a flow that already exists.
 *
 *   discoverAuthorizationServer(origin)        RFC 8414, per-tenant document
 *        │
 *   buildAuthorizeUrl(...)  ──► opened in the SYSTEM BROWSER, never the webview
 *        │                      (OAuth 2.1 BCP: an embedded user-agent can read
 *        │                       the user's Malafat session)
 *        ▼
 *   parseCallbackParams(...)    loopback redirect, state compared first
 *        │
 *   exchangeCodeForTokens(...)  code + verifier, no client secret
 *        │
 *   refreshTokens(...)          rotating; see the REFRESH_REUSE note below
 *
 * Everything here is pure except the injected `fetch` and `now`, so the whole
 * flow is testable without a network or a running tenant.
 *
 * TENANT RESOLUTION: Malafat resolves the firm from the subdomain before any
 * token lookup, so the origin passed in here *is* the tenant selector. There is
 * no tenant parameter and there must not be one.
 */

import type { PkcePair } from './oauth-pkce';

/**
 * Our published Client ID Metadata Document URL, and therefore our client_id —
 * Malafat compares the two byte for byte.
 *
 * The `.json` suffix is load-bearing: Malafat refuses a document whose
 * content-type is not JSON, and Netlify's SPA fallback would serve index.html
 * as text/html for an extensionless path.
 */
export const CIMD_CLIENT_ID = 'https://mutaba3a.app/.well-known/oauth-client.json';

/**
 * Loopback ports we are willing to bind, in preference order.
 *
 * RFC 8252 asks native clients to use an ephemeral port, but Malafat matches
 * redirect_uris exactly (authorization-request-service.ts:106), so every port
 * must be pre-registered in the CIMD document. Fixed ports are the consequence;
 * the fallbacks exist because a single port would let any process squatting it
 * block sign-in with no recovery.
 *
 * Changing this list REQUIRES republishing the CIMD document — the test in
 * __tests__/cimd-document.test.ts enforces that they agree.
 */
export const OAUTH_LOOPBACK_PORTS = [14100, 14101, 14102, 14103] as const;

/** Every redirect URI we may present, in the exact spelling the server matches. */
export function loopbackRedirectUris(): string[] {
  return OAUTH_LOOPBACK_PORTS.flatMap((port) => [
    `http://127.0.0.1:${port}/callback`,
    `http://localhost:${port}/callback`,
  ]);
}

/** The redirect URI for a port the loopback listener actually bound. */
export function redirectUriForPort(port: number): string {
  // 127.0.0.1 rather than localhost: it cannot be redirected by a hosts-file
  // entry, and it avoids an IPv6-vs-IPv4 resolution mismatch with the listener.
  return `http://127.0.0.1:${port}/callback`;
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface OAuthClientConfig {
  /**
   * The CIMD document URL. Malafat compares `client_id` byte-for-byte against
   * the URL it fetched the document from, so this must match exactly.
   */
  clientId: string;
  /** Loopback redirect. Registered in the CIMD document's redirect_uris. */
  redirectUri: string;
  scopes: string[];
}

export interface TokenSet {
  accessToken: string;
  /** Absent only if the server issued none; otherwise always the newest value. */
  refreshToken?: string;
  /** Absolute epoch-ms expiry, derived from `expires_in` at receipt time. */
  expiresAt: number;
  /** Scopes the server GRANTED, which may be narrower than those requested. */
  scopes: string[];
}

/**
 * A token-endpoint failure, carrying whether the grant itself is gone.
 *
 * The distinction drives behaviour: `grantInvalid` means the lawyer revoked
 * consent (or a rotated refresh token was replayed) and the app must drop to
 * local-only without destroying local data. Anything else is transient and
 * should be retried.
 */
export class OAuthTokenError extends Error {
  readonly grantInvalid: boolean;
  readonly status: number;
  readonly code: string;

  constructor(message: string, opts: { grantInvalid: boolean; status: number; code: string }) {
    super(message);
    this.name = 'OAuthTokenError';
    this.grantInvalid = opts.grantInvalid;
    this.status = opts.status;
    this.code = opts.code;
  }
}

type FetchImpl = typeof fetch;
type Clock = () => number;

/** Errors that mean "this grant will never work again". */
const GRANT_INVALID_CODES = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

function requireHttpsOrigin(origin: string): URL {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`Invalid Malafat origin: ${origin}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Malafat origin must use https, got ${url.protocol}`);
  }
  return url;
}

export function discoveryUrlFor(origin: string): string {
  const url = requireHttpsOrigin(origin);
  return `${url.origin}/.well-known/oauth-authorization-server`;
}

export async function discoverAuthorizationServer(
  origin: string,
  fetchImpl: FetchImpl = fetch
): Promise<AuthorizationServerMetadata> {
  const url = discoveryUrlFor(origin);
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });

  if (!res.ok) {
    // Malafat answers 404 for an unknown host deliberately, so as not to
    // confirm or deny tenant existence. Treat it as "wrong workspace".
    throw new Error(`OAuth discovery failed for ${url} (HTTP ${res.status})`);
  }

  const doc = (await res.json()) as Partial<AuthorizationServerMetadata>;

  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error('OAuth discovery document is missing a required endpoint');
  }

  // OAuth 2.1 forbids `plain`, and we only implement S256. If the server does
  // not advertise it, stop here rather than failing later at the exchange.
  const methods = doc.code_challenge_methods_supported;
  if (methods && !methods.includes('S256')) {
    throw new Error('Authorization server does not support PKCE S256');
  }

  return doc as AuthorizationServerMetadata;
}

export function buildAuthorizeUrl(
  meta: AuthorizationServerMetadata,
  config: OAuthClientConfig,
  pkce: PkcePair,
  state: string
): string {
  if (!state) {
    throw new Error('Refusing to build an authorize URL without a state value');
  }

  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', pkce.method);
  return url.toString();
}

/**
 * Read the loopback redirect.
 *
 * State is compared BEFORE anything else is believed, including an `error`
 * parameter: an unsolicited request to our loopback port can carry any query
 * string it likes, and reporting its error verbatim would let it drive our UI.
 */
export function parseCallbackParams(callbackUrl: string, expectedState: string): { code: string } {
  const params = new URL(callbackUrl).searchParams;

  const state = params.get('state');
  if (!state || state !== expectedState) {
    throw new Error('OAuth callback state did not match the request; ignoring this redirect');
  }

  const error = params.get('error');
  if (error) {
    const description = params.get('error_description');
    throw new Error(`Authorization failed: ${error}${description ? ` — ${description}` : ''}`);
  }

  const code = params.get('code');
  if (!code) {
    throw new Error('OAuth callback carried neither a code nor an error');
  }

  return { code };
}

async function postToTokenEndpoint(
  meta: AuthorizationServerMetadata,
  body: URLSearchParams,
  fetchImpl: FetchImpl,
  now: Clock,
  currentRefreshToken?: string
): Promise<TokenSet> {
  const res = await fetchImpl(meta.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });

  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const code = typeof payload.error === 'string' ? payload.error : 'unknown_error';
    throw new OAuthTokenError(`Token endpoint rejected the request: ${code}`, {
      grantInvalid: GRANT_INVALID_CODES.has(code),
      status: res.status,
      code,
    });
  }

  const accessToken = payload.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error('Token response carried no access token');
  }

  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 0;
  const granted = typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [];

  // Adopt a rotated refresh token; fall back to the one we already hold when
  // the server did not rotate. Never keep a superseded value — replaying one
  // revokes the entire grant (REFRESH_REUSE).
  const rotated = typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined;

  return {
    accessToken,
    refreshToken: rotated ?? currentRefreshToken,
    expiresAt: now() + expiresIn * 1000,
    scopes: granted,
  };
}

export async function exchangeCodeForTokens(
  meta: AuthorizationServerMetadata,
  config: OAuthClientConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchImpl = fetch,
  now: Clock = Date.now
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });
  return postToTokenEndpoint(meta, body, fetchImpl, now);
}

export async function refreshTokens(
  meta: AuthorizationServerMetadata,
  config: OAuthClientConfig,
  refreshToken: string,
  fetchImpl: FetchImpl = fetch,
  now: Clock = Date.now
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  });
  return postToTokenEndpoint(meta, body, fetchImpl, now, refreshToken);
}
