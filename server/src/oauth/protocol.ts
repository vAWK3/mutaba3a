import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * MUT-434 (ADR-197): the pure rules of MTB3A's OAuth 2.1 authorization server for MCP clients — scopes, PKCE,
 * redirect matching, the canonical resource, dynamic client registration and the discovery documents. No store, no
 * network, no clock: `service.ts` composes these with the store, `routes/oauth.ts` with HTTP.
 *
 * Public clients only (MCP clients hold no secret): a client proves itself with PKCE S256, never `plain`.
 */

/**
 * The scope vocabulary, separate from the API-key scopes in auth/scopes.ts and never issuable to a key.
 * D5: `read` and `write` are both advertised and granted when none is requested (a deviation from the spec's
 * "minimal scopes_supported" SHOULD, recorded in ADR-197): writing expenses is what the epic is for.
 */
export const OAUTH_SCOPES = ['read', 'write'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export type ParseScopeResult = { ok: true; scopes: OAuthScope[] } | { ok: false; invalid: string[] };

export function parseScopeParam(raw: string | undefined | null): ParseScopeResult {
  const requested = (raw ?? '').split(' ').filter(Boolean);
  if (requested.length === 0) return { ok: true, scopes: [...OAUTH_SCOPES] };
  const invalid = requested.filter((s) => !(OAUTH_SCOPES as readonly string[]).includes(s));
  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, scopes: OAUTH_SCOPES.filter((s) => requested.includes(s)) };
}

// ---- PKCE (RFC 7636), S256 only ---------------------------------------------

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeVerifier(verifier: string): boolean {
  return VERIFIER_RE.test(verifier);
}

export function isValidCodeChallenge(challenge: string): boolean {
  return CHALLENGE_RE.test(challenge);
}

export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** `plain` is unrepresentable: there is no method parameter, only S256. */
export function verifyS256(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false;
  return timingSafeEqual(Buffer.from(s256Challenge(verifier)), Buffer.from(challenge));
}

// ---- The resource (RFC 8707) --------------------------------------------------

/**
 * OV4: the form two resource URIs are compared in — lowercase scheme and host (URL does that), the default port
 * dropped (URL does that too), one trailing slash stripped from the path, no query or fragment. Null for anything that
 * is not an absolute http(s) URI without a fragment.
 */
export function canonicalResource(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.hash !== '' || url.search !== '' || raw.includes('#')) return null;
  const path = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  return `${url.protocol}//${url.host}${path === '/' ? '' : path}`;
}

/** The one MCP resource this server protects: `<issuer>/mcp`. */
export function mcpResourceUrl(issuer: string): string {
  return `${stripTrailingSlash(issuer)}/mcp`;
}

// ---- Redirect URIs --------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * The registration rule: https with no fragment, or a loopback http redirect (RFC 8252 §7.3 — there is no certificate
 * for localhost). No custom schemes in v1.
 */
export function isAcceptableRedirectUri(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > MAX_URI_LENGTH) return false;
  const url = parseUrl(raw);
  if (!url || url.hash !== '' || raw.includes('#') || url.username !== '' || url.password !== '') return false;
  return url.protocol === 'https:' || isLoopbackHttp(url);
}

/**
 * The request rule: exact string equality with a registered redirect, except that a loopback redirect matches on
 * scheme, host, path and query with any port (S6, RFC 8252 §7.3: native clients bind an ephemeral port).
 */
export function redirectMatches(registered: readonly string[], presented: string): boolean {
  if (registered.includes(presented)) return true;
  const url = parseUrl(presented);
  if (!url || !isLoopbackHttp(url)) return false;
  return registered.some((r) => {
    const candidate = parseUrl(r);
    return candidate !== null && isLoopbackHttp(candidate) && candidate.hostname === url.hostname && candidate.pathname === url.pathname && candidate.search === url.search;
  });
}

// ---- Dynamic client registration (RFC 7591) -------------------------------------

const MAX_URI_LENGTH = 2048;
const MAX_REDIRECT_URIS = 5;
export const MAX_CLIENT_NAME_LENGTH = 100;
const DEFAULT_CLIENT_NAME = 'MCP client';
/** C0/C1 controls and the bidi overrides/isolates, which could make a consent screen lie about a name. */
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

export function sanitizeClientName(raw: unknown): string {
  const cleaned = typeof raw === 'string' ? raw.replace(UNSAFE_CHARS, '').trim() : '';
  return (cleaned || DEFAULT_CLIENT_NAME).slice(0, MAX_CLIENT_NAME_LENGTH);
}

export type DcrResult =
  | { ok: true; value: { clientName: string; redirectUris: string[] } }
  | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string };

function onlyAllowed(value: unknown, allowed: readonly string[]): boolean {
  return value === undefined || (Array.isArray(value) && value.every((v) => typeof v === 'string' && allowed.includes(v)));
}

/** Unknown fields are ignored (RFC 7591 §2); what we keep is a name and the redirect list. */
export function validateDcrRequest(body: unknown): DcrResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_client_metadata', description: 'The registration body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every(isAcceptableRedirectUri)) {
    return { ok: false, error: 'invalid_redirect_uri', description: `Register 1–${MAX_REDIRECT_URIS} https or loopback http redirect URIs` };
  }
  if (b.token_endpoint_auth_method !== undefined && b.token_endpoint_auth_method !== 'none') {
    return { ok: false, error: 'invalid_client_metadata', description: 'Only public clients (token_endpoint_auth_method "none") can register' };
  }
  if (!onlyAllowed(b.grant_types, ['authorization_code', 'refresh_token']) || !onlyAllowed(b.response_types, ['code'])) {
    return { ok: false, error: 'invalid_client_metadata', description: 'Only the authorization_code and refresh_token grants with response type "code" are supported' };
  }
  return { ok: true, value: { clientName: sanitizeClientName(b.client_name), redirectUris: [...new Set(uris as string[])] } };
}

// ---- Discovery (RFC 8414, RFC 9728) ----------------------------------------------

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function authorizationServerMetadata(issuer: string) {
  const base = stripTrailingSlash(issuer);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    // S1 (D2): URL client ids are fetched as Client ID Metadata Documents.
    client_id_metadata_document_supported: true,
    // S2b (D4): every authorization response carries `iss` (RFC 9207).
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata(issuer: string) {
  const base = stripTrailingSlash(issuer);
  return {
    resource: mcpResourceUrl(base),
    authorization_servers: [base],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
  };
}
