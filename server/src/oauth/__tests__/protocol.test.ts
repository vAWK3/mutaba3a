import { describe, expect, it } from 'vitest';
import {
  authorizationServerMetadata,
  canonicalResource,
  isValidCodeChallenge,
  isValidCodeVerifier,
  mcpResourceUrl,
  parseScopeParam,
  protectedResourceMetadata,
  redirectMatches,
  s256Challenge,
  validateDcrRequest,
  verifyS256,
} from '../protocol.js';

/** MUT-434: the pure OAuth 2.1 rules (plan §3.1, structure B: one module). */

describe('PKCE (S256 only)', () => {
  // RFC 7636 Appendix B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('computes the RFC 7636 Appendix B challenge', () => {
    expect(s256Challenge(verifier)).toBe(challenge);
  });

  it('verifies a matching pair and refuses any other verifier', () => {
    expect(verifyS256(verifier, challenge)).toBe(true);
    expect(verifyS256(`${verifier.slice(0, -1)}A`, challenge)).toBe(false);
    expect(verifyS256(verifier, `${challenge.slice(0, -1)}A`)).toBe(false);
  });

  it('refuses a malformed verifier before hashing it', () => {
    expect(verifyS256('short', s256Challenge('short'))).toBe(false);
  });

  it('accepts 43–128 unreserved characters as a verifier, nothing else', () => {
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(128))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(42))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false);
    expect(isValidCodeVerifier(`${'a'.repeat(42)}~`)).toBe(true);
    expect(isValidCodeVerifier(`${'a'.repeat(42)}+`)).toBe(false);
  });

  it('accepts only a 43-character base64url challenge', () => {
    expect(isValidCodeChallenge(challenge)).toBe(true);
    expect(isValidCodeChallenge(`${challenge}=`)).toBe(false);
    expect(isValidCodeChallenge(challenge.slice(1))).toBe(false);
  });
});

describe('scopes (D5: read and write up front)', () => {
  it('grants both when no scope is requested', () => {
    expect(parseScopeParam(undefined)).toEqual({ ok: true, scopes: ['read', 'write'] });
    expect(parseScopeParam('  ')).toEqual({ ok: true, scopes: ['read', 'write'] });
  });

  it('keeps a narrower request, deduplicated and in vocabulary order', () => {
    expect(parseScopeParam('read')).toEqual({ ok: true, scopes: ['read'] });
    expect(parseScopeParam('write read read')).toEqual({ ok: true, scopes: ['read', 'write'] });
  });

  it('refuses the whole request on an unknown scope', () => {
    expect(parseScopeParam('read admin')).toEqual({ ok: false, invalid: ['admin'] });
  });
});

describe('canonical resource (S2a/OV4)', () => {
  const canonical = 'https://app.mtb3a.com/mcp';

  it.each([
    'https://app.mtb3a.com/mcp',
    'https://app.mtb3a.com/mcp/',
    'HTTPS://APP.MTB3A.COM/mcp',
    'https://app.mtb3a.com:443/mcp',
  ])('normalises %s', (raw) => {
    expect(canonicalResource(raw)).toBe(canonical);
  });

  it('keeps the path case and refuses fragments, relative and non-URLs', () => {
    expect(canonicalResource('https://app.mtb3a.com/MCP')).toBe('https://app.mtb3a.com/MCP');
    expect(canonicalResource('https://app.mtb3a.com/mcp#x')).toBeNull();
    expect(canonicalResource('/mcp')).toBeNull();
    expect(canonicalResource('not a url')).toBeNull();
  });

  it('keeps a non-default port', () => {
    expect(canonicalResource('http://localhost:8787/mcp')).toBe('http://localhost:8787/mcp');
  });

  it('builds the MCP resource from the issuer', () => {
    expect(mcpResourceUrl('https://app.mtb3a.com')).toBe(canonical);
    expect(mcpResourceUrl('https://app.mtb3a.com/')).toBe(canonical);
  });
});

describe('redirect matching (S6: any port on loopback only)', () => {
  it('matches https redirects exactly', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback'];
    expect(redirectMatches(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectMatches(registered, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(redirectMatches(registered, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false);
    expect(redirectMatches(registered, 'https://claude.ai:8443/api/mcp/auth_callback')).toBe(false);
  });

  it('ignores the port on a loopback redirect, nothing else', () => {
    const registered = ['http://127.0.0.1:33418/callback', 'http://localhost/callback', 'http://[::1]:5000/cb'];
    expect(redirectMatches(registered, 'http://127.0.0.1:51234/callback')).toBe(true);
    expect(redirectMatches(registered, 'http://localhost:9999/callback')).toBe(true);
    expect(redirectMatches(registered, 'http://[::1]:6000/cb')).toBe(true);
    expect(redirectMatches(registered, 'http://127.0.0.1:51234/other')).toBe(false);
    expect(redirectMatches(registered, 'http://localhost:9999/callback?x=1')).toBe(false);
    expect(redirectMatches(registered, 'https://127.0.0.1:51234/callback')).toBe(false);
  });

  it('never treats a lookalike host as loopback', () => {
    expect(redirectMatches(['http://127.0.0.1:1/callback'], 'http://127.0.0.1.evil.example:1/callback')).toBe(false);
    expect(redirectMatches(['http://localhost:1/callback'], 'http://localhost.evil.example:1/callback')).toBe(false);
  });

  it('refuses an unparseable presented redirect', () => {
    expect(redirectMatches(['https://claude.ai/cb'], 'claude.ai/cb')).toBe(false);
  });
});

describe('dynamic client registration (RFC 7591)', () => {
  const valid = { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] };

  it('accepts a public client with https and loopback redirects', () => {
    const result = validateDcrRequest({ ...valid, redirect_uris: [...valid.redirect_uris, 'http://localhost:3118/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], application_type: 'native' });
    expect(result).toEqual({ ok: true, value: { clientName: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:3118/callback'] } });
  });

  it('names an unnamed client generically', () => {
    expect(validateDcrRequest({ redirect_uris: valid.redirect_uris })).toMatchObject({ ok: true, value: { clientName: 'MCP client' } });
  });

  it('strips control and bidi characters and caps the name', () => {
    const result = validateDcrRequest({ ...valid, client_name: `Cla‮ude\u0007${'x'.repeat(200)}` });
    expect(result.ok && result.value.clientName.startsWith('Claude')).toBe(true);
    expect(result.ok && result.value.clientName.length).toBe(100);
  });

  it.each([
    [{ ...valid, redirect_uris: [] }, 'invalid_redirect_uri'],
    [{ ...valid, redirect_uris: Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`) }, 'invalid_redirect_uri'],
    [{ ...valid, redirect_uris: ['http://claude.ai/cb'] }, 'invalid_redirect_uri'],
    [{ ...valid, redirect_uris: ['https://claude.ai/cb#frag'] }, 'invalid_redirect_uri'],
    [{ ...valid, redirect_uris: ['myapp://callback'] }, 'invalid_redirect_uri'],
    [{ ...valid, token_endpoint_auth_method: 'client_secret_basic' }, 'invalid_client_metadata'],
    [{ ...valid, grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
    [{ ...valid, response_types: ['token'] }, 'invalid_client_metadata'],
    ['not an object', 'invalid_client_metadata'],
  ])('refuses %j with %s', (body, error) => {
    expect(validateDcrRequest(body)).toMatchObject({ ok: false, error });
  });
});

describe('discovery documents', () => {
  const issuer = 'https://app.mtb3a.com';

  it('publishes RFC 8414 metadata: S256 only, public clients, CIMD and iss', () => {
    expect(authorizationServerMetadata(issuer)).toEqual({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      registration_endpoint: `${issuer}/oauth/register`,
      scopes_supported: ['read', 'write'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it('publishes RFC 9728 metadata for the MCP resource', () => {
    expect(protectedResourceMetadata(issuer)).toEqual({
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
    });
  });
});
