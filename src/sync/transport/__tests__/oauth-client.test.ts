import { describe, it, expect, vi } from 'vitest';
import {
  discoveryUrlFor,
  discoverAuthorizationServer,
  buildAuthorizeUrl,
  parseCallbackParams,
  exchangeCodeForTokens,
  refreshTokens,
  type AuthorizationServerMetadata,
  type OAuthClientConfig,
} from '../oauth-client';
import type { PkcePair } from '../oauth-pkce';

const TENANT_ORIGIN = 'https://acme.malafat.app';

const META: AuthorizationServerMetadata = {
  issuer: TENANT_ORIGIN,
  authorization_endpoint: `${TENANT_ORIGIN}/oauth/authorize`,
  token_endpoint: `${TENANT_ORIGIN}/api/oauth/token`,
  code_challenge_methods_supported: ['S256'],
  scopes_supported: ['tasks:read', 'clients:read'],
};

const CONFIG: OAuthClientConfig = {
  // Byte-equal to the hosted CIMD document URL — the server compares exactly.
  clientId: 'https://mutaba3a.app/.well-known/oauth-client',
  redirectUri: 'http://127.0.0.1:1410/callback',
  scopes: ['clients:read', 'tasks:read'],
};

const PKCE: PkcePair = {
  verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  method: 'S256',
};

/** Minimal fetch double: one canned JSON response, and a record of the call. */
function jsonFetch(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: string, reqInit?: RequestInit) => {
    calls.push({ url, init: reqInit });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function formBody(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ''));
}

describe('discoveryUrlFor', () => {
  it('builds the RFC 8414 path on the tenant subdomain', () => {
    expect(discoveryUrlFor(TENANT_ORIGIN)).toBe(
      `${TENANT_ORIGIN}/.well-known/oauth-authorization-server`
    );
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(discoveryUrlFor(`${TENANT_ORIGIN}/`)).toBe(
      `${TENANT_ORIGIN}/.well-known/oauth-authorization-server`
    );
  });

  it('refuses a non-https origin — tokens must never cross plaintext', () => {
    expect(() => discoveryUrlFor('http://acme.malafat.app')).toThrow(/https/i);
  });
});

describe('discoverAuthorizationServer', () => {
  it('returns the metadata document', async () => {
    const { impl, calls } = jsonFetch(META);
    await expect(discoverAuthorizationServer(TENANT_ORIGIN, impl)).resolves.toEqual(META);
    expect(calls[0].url).toBe(`${TENANT_ORIGIN}/.well-known/oauth-authorization-server`);
  });

  it('fails when the tenant does not exist (404)', async () => {
    const { impl } = jsonFetch({ error: 'not_found' }, { ok: false, status: 404 });
    await expect(discoverAuthorizationServer(TENANT_ORIGIN, impl)).rejects.toThrow(/discovery/i);
  });

  it('fails when a required endpoint is missing', async () => {
    const { impl } = jsonFetch({ issuer: TENANT_ORIGIN });
    await expect(discoverAuthorizationServer(TENANT_ORIGIN, impl)).rejects.toThrow(/endpoint/i);
  });

  it('fails when the server does not advertise S256', async () => {
    const { impl } = jsonFetch({ ...META, code_challenge_methods_supported: ['plain'] });
    await expect(discoverAuthorizationServer(TENANT_ORIGIN, impl)).rejects.toThrow(/S256/);
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes every parameter the server requires', () => {
    const url = new URL(buildAuthorizeUrl(META, CONFIG, PKCE, 'state-abc'));
    expect(url.origin + url.pathname).toBe(`${TENANT_ORIGIN}/oauth/authorize`);
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe(CONFIG.clientId);
    expect(p.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(p.get('state')).toBe('state-abc');
    expect(p.get('code_challenge')).toBe(PKCE.challenge);
    expect(p.get('code_challenge_method')).toBe('S256');
  });

  it('sends scopes space-delimited per RFC 6749', () => {
    const p = new URL(buildAuthorizeUrl(META, CONFIG, PKCE, 's')).searchParams;
    expect(p.get('scope')).toBe('clients:read tasks:read');
  });

  it('never puts the verifier or a client secret in the URL', () => {
    const url = buildAuthorizeUrl(META, CONFIG, PKCE, 's');
    expect(url).not.toContain(PKCE.verifier);
    expect(url).not.toContain('client_secret');
  });

  it('refuses to build a URL with an empty state — that would disable CSRF protection', () => {
    expect(() => buildAuthorizeUrl(META, CONFIG, PKCE, '')).toThrow(/state/i);
  });
});

describe('parseCallbackParams', () => {
  const cb = (qs: string) => `http://127.0.0.1:1410/callback?${qs}`;

  it('returns the code when state matches', () => {
    expect(parseCallbackParams(cb('code=abc123&state=xyz'), 'xyz')).toEqual({ code: 'abc123' });
  });

  it('rejects a mismatched state', () => {
    expect(() => parseCallbackParams(cb('code=abc&state=WRONG'), 'xyz')).toThrow(/state/i);
  });

  it('rejects a missing state even when a code is present', () => {
    expect(() => parseCallbackParams(cb('code=abc'), 'xyz')).toThrow(/state/i);
  });

  it('surfaces a server-side error instead of hanging on a missing code', () => {
    expect(() => parseCallbackParams(cb('error=access_denied&state=xyz'), 'xyz')).toThrow(
      /access_denied/
    );
  });

  it('checks state before reporting the error — an attacker-supplied error must not be trusted', () => {
    expect(() => parseCallbackParams(cb('error=access_denied&state=WRONG'), 'xyz')).toThrow(
      /state/i
    );
  });

  it('rejects a callback with neither code nor error', () => {
    expect(() => parseCallbackParams(cb('state=xyz'), 'xyz')).toThrow(/code/i);
  });
});

describe('exchangeCodeForTokens', () => {
  const RESPONSE = {
    access_token: 'at-1',
    refresh_token: 'rt-1',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'clients:read tasks:read',
  };

  it('posts a form-encoded authorization_code grant with the verifier', async () => {
    const { impl, calls } = jsonFetch(RESPONSE);
    await exchangeCodeForTokens(META, CONFIG, 'code-1', PKCE.verifier, impl, () => 1_000_000);

    expect(calls[0].url).toBe(META.token_endpoint);
    expect(calls[0].init?.method).toBe('POST');
    const body = formBody(calls[0].init);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('code_verifier')).toBe(PKCE.verifier);
    expect(body.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(body.get('client_id')).toBe(CONFIG.clientId);
  });

  it('sends no client_secret — this is a public client', async () => {
    const { impl, calls } = jsonFetch(RESPONSE);
    await exchangeCodeForTokens(META, CONFIG, 'c', PKCE.verifier, impl, () => 0);
    expect(formBody(calls[0].init).get('client_secret')).toBeNull();
  });

  it('converts expires_in into an absolute expiry using the injected clock', async () => {
    const { impl } = jsonFetch(RESPONSE);
    const set = await exchangeCodeForTokens(META, CONFIG, 'c', PKCE.verifier, impl, () => 1_000_000);
    expect(set.expiresAt).toBe(1_000_000 + 3600 * 1000);
  });

  it('records the scopes the server actually granted, not the ones requested', async () => {
    const { impl } = jsonFetch({ ...RESPONSE, scope: 'clients:read' });
    const set = await exchangeCodeForTokens(META, CONFIG, 'c', PKCE.verifier, impl, () => 0);
    expect(set.scopes).toEqual(['clients:read']);
  });

  it('fails loudly when the server rejects the exchange', async () => {
    const { impl } = jsonFetch({ error: 'invalid_grant' }, { ok: false, status: 400 });
    await expect(
      exchangeCodeForTokens(META, CONFIG, 'c', PKCE.verifier, impl, () => 0)
    ).rejects.toThrow(/invalid_grant/);
  });

  it('fails when the response carries no access token', async () => {
    const { impl } = jsonFetch({ token_type: 'Bearer', expires_in: 60 });
    await expect(
      exchangeCodeForTokens(META, CONFIG, 'c', PKCE.verifier, impl, () => 0)
    ).rejects.toThrow(/access token/i);
  });
});

describe('refreshTokens', () => {
  it('posts a refresh_token grant', async () => {
    const { impl, calls } = jsonFetch({ access_token: 'at-2', expires_in: 3600 });
    await refreshTokens(META, CONFIG, 'rt-1', impl, () => 0);
    const body = formBody(calls[0].init);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    expect(body.get('client_id')).toBe(CONFIG.clientId);
  });

  it('adopts the rotated refresh token and discards the old one', async () => {
    // Malafat rotates refresh tokens; replaying a rotated one revokes the whole
    // grant (OAuthGrantRevocationReason.REFRESH_REUSE). Keeping the old value
    // around is how a client destroys its own access.
    const { impl } = jsonFetch({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 60 });
    const set = await refreshTokens(META, CONFIG, 'rt-1', impl, () => 0);
    expect(set.refreshToken).toBe('rt-2');
    expect(set.refreshToken).not.toBe('rt-1');
  });

  it('keeps the current refresh token when the server does not rotate it', async () => {
    const { impl } = jsonFetch({ access_token: 'at-2', expires_in: 60 });
    const set = await refreshTokens(META, CONFIG, 'rt-1', impl, () => 0);
    expect(set.refreshToken).toBe('rt-1');
  });

  it('reports a revoked grant distinguishably so the caller can degrade to local-only', async () => {
    const { impl } = jsonFetch({ error: 'invalid_grant' }, { ok: false, status: 400 });
    await expect(refreshTokens(META, CONFIG, 'rt-1', impl, () => 0)).rejects.toMatchObject({
      grantInvalid: true,
    });
  });

  it('does not mark a transient server error as a revoked grant', async () => {
    const { impl } = jsonFetch({ error: 'server_error' }, { ok: false, status: 503 });
    await expect(refreshTokens(META, CONFIG, 'rt-1', impl, () => 0)).rejects.toMatchObject({
      grantInvalid: false,
    });
  });
});
