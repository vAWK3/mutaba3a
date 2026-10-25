import { describe, expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { CimdFetchResult } from '../trust.js';
import { s256Challenge } from '../protocol.js';
import { OAUTH_TTL, OAuthService, type OAuthServiceDeps } from '../service.js';

/**
 * MUT-434: the authorization server's state machine over the memory store, with an injected clock. Routes are thin
 * over this, so every rule — single-use codes and refresh tokens (D6), idempotent rotation (D19), audience (D3), iss
 * (D4), loopback ports (D8), CIMD storage (OV2) — is proven here.
 */

const ISSUER = 'https://app.example.test';
const RESOURCE = `${ISSUER}/mcp`;
const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = s256Challenge(VERIFIER);
const T0 = new Date('2026-10-25T10:00:00Z');

async function setup(overrides: Partial<OAuthServiceDeps> = {}) {
  const store = new MemoryLedgerStore();
  const { user } = await store.users.create({
    email: `p${Math.random()}@studio.ps`,
    displayName: 'Rana',
    passwordHash: 'x',
    locale: 'en',
    personal: { name: 'Rana', slug: `rana-${Math.random().toString(36).slice(2)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: T0,
  });
  const captureMessage = vi.fn();
  const fetchMetadata = vi.fn<(url: string) => Promise<CimdFetchResult>>();
  const service = new OAuthService({
    store,
    issuer: ISSUER,
    pepper: 'session-pepper-with-at-least-32-chars!!',
    deriveKey: 'derive-key-with-at-least-32-characters!!',
    fetchMetadata,
    captureMessage,
    auditFor: async () => [],
    ...overrides,
  });
  return { store, service, userId: user.id, captureMessage, fetchMetadata };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function registerClaude(s: Setup, redirect = CLAUDE_CB) {
  const reg = await s.service.register({ client_name: 'Claude', redirect_uris: [redirect] }, T0);
  if (!reg.ok) throw new Error('registration failed');
  return reg.client.id;
}

function authorizeParams(clientId: string, extra: Record<string, string | undefined> = {}) {
  return { response_type: 'code', client_id: clientId, redirect_uri: CLAUDE_CB, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'st-1', resource: RESOURCE, ...extra };
}

async function approvedCode(s: Setup, at = T0) {
  const clientId = await registerClaude(s);
  const started = await s.service.startAuthorization(authorizeParams(clientId), at);
  if (started.kind !== 'consent') throw new Error(`expected consent, got ${started.kind}`);
  const decided = await s.service.decide({ requestId: started.requestId, userId: s.userId, approve: true, at, actor: { actorType: 'USER', actorId: s.userId }, requestIdForAudit: 'r' });
  if (decided.kind !== 'redirect') throw new Error('decision failed');
  const url = new URL(decided.redirectTo);
  return { clientId, code: url.searchParams.get('code') ?? '', url };
}

async function tokensFor(s: Setup, at = T0) {
  const { clientId, code } = await approvedCode(s, at);
  const res = await s.service.token({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE }, at);
  if (res.status !== 200) throw new Error(`token failed: ${JSON.stringify(res.body)}`);
  return { clientId, body: res.body as { access_token: string; refresh_token: string; expires_in: number; scope: string; token_type: string } };
}

describe('register (DCR)', () => {
  it('creates an mcl_ client and stores its redirects', async () => {
    const s = await setup();
    const reg = await s.service.register({ client_name: 'Claude', redirect_uris: [CLAUDE_CB] }, T0);
    expect(reg.ok && reg.client.id).toMatch(/^mcl_[A-Za-z0-9_-]{32}$/);
    expect(reg.ok && (await s.store.oauth.findClient(reg.client.id))?.redirectUris).toEqual([CLAUDE_CB]);
  });

  it('answers RFC 7591 errors', async () => {
    const s = await setup();
    expect(await s.service.register({ redirect_uris: ['http://evil.example/cb'] }, T0)).toMatchObject({ ok: false, error: 'invalid_redirect_uri' });
  });
});

describe('startAuthorization', () => {
  it('stores a 30-minute request with the default scopes and resource', async () => {
    const s = await setup();
    const clientId = await registerClaude(s);
    const started = await s.service.startAuthorization(authorizeParams(clientId, { resource: undefined }), T0);
    expect(started.kind).toBe('consent');
    const request = started.kind === 'consent' ? await s.store.oauth.findAuthorizationRequest(started.requestId) : null;
    expect(request).toMatchObject({ scopes: ['read', 'write'], resource: RESOURCE, state: 'st-1', redirectUri: CLAUDE_CB });
    expect(request?.expiresAt.getTime()).toBe(T0.getTime() + OAUTH_TTL.requestMs);
  });

  it('never redirects to an unknown client or an unregistered redirect (page error instead)', async () => {
    const s = await setup();
    const clientId = await registerClaude(s);
    expect(await s.service.startAuthorization(authorizeParams('mcl_nope'), T0)).toEqual({ kind: 'page_error', error: 'invalid_client' });
    expect(await s.service.startAuthorization(authorizeParams(clientId, { redirect_uri: 'https://evil.example/cb' }), T0)).toEqual({ kind: 'page_error', error: 'invalid_redirect_uri' });
  });

  it.each([
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge: undefined }, 'invalid_request'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ scope: 'read admin' }, 'invalid_scope'],
    [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
  ])('redirects %j back with %s, state and iss', async (extra, error) => {
    const s = await setup();
    const clientId = await registerClaude(s);
    const started = await s.service.startAuthorization(authorizeParams(clientId, extra), T0);
    expect(started.kind).toBe('redirect');
    const url = new URL(started.kind === 'redirect' ? started.redirectTo : '');
    expect(`${url.origin}${url.pathname}`).toBe(CLAUDE_CB);
    expect(Object.fromEntries(url.searchParams)).toEqual({ error, state: 'st-1', iss: ISSUER });
  });

  it('accepts a normalised resource (OV4)', async () => {
    const s = await setup();
    const clientId = await registerClaude(s);
    expect((await s.service.startAuthorization(authorizeParams(clientId, { resource: 'https://APP.example.test:443/mcp/' }), T0)).kind).toBe('consent');
  });

  it('accepts a Claude Code loopback redirect on another port (D8)', async () => {
    const s = await setup();
    const reg = await s.service.register({ client_name: 'Claude Code', redirect_uris: ['http://localhost:33418/callback'] }, T0);
    const clientId = reg.ok ? reg.client.id : '';
    expect((await s.service.startAuthorization(authorizeParams(clientId, { redirect_uri: 'http://localhost:51000/callback' }), T0)).kind).toBe('consent');
  });
});

describe('CIMD clients (OV2)', () => {
  const META = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
  const ok: CimdFetchResult = { ok: true, metadata: { clientId: META, clientName: 'Claude', redirectUris: [CLAUDE_CB] }, cacheControl: 'max-age=600' };

  it('fetches once, stores a CIMD row and re-fetches only after it goes stale', async () => {
    const s = await setup();
    s.fetchMetadata.mockResolvedValue(ok);
    expect((await s.service.startAuthorization(authorizeParams(META), T0)).kind).toBe('consent');
    expect(await s.store.oauth.findClient(META)).toMatchObject({ kind: 'CIMD', clientName: 'Claude', redirectUris: [CLAUDE_CB] });
    await s.service.startAuthorization(authorizeParams(META), new Date(T0.getTime() + 5 * 60_000));
    expect(s.fetchMetadata).toHaveBeenCalledTimes(1);
    await s.service.startAuthorization(authorizeParams(META), new Date(T0.getTime() + 11 * 60_000));
    expect(s.fetchMetadata).toHaveBeenCalledTimes(2);
  });

  it('refuses on a page when the document can’t be fetched', async () => {
    const s = await setup();
    s.fetchMetadata.mockResolvedValue({ ok: false, reason: 'private_address' });
    expect(await s.service.startAuthorization(authorizeParams(META), T0)).toEqual({ kind: 'page_error', error: 'invalid_client' });
  });
});

describe('decide', () => {
  it('approve redirects with a code, the state and iss; deny with access_denied', async () => {
    const s = await setup();
    const { url } = await approvedCode(s);
    expect(url.searchParams.get('code')).toMatch(/^mac_/);
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('iss')).toBe(ISSUER);

    const clientId = await registerClaude(s);
    const started = await s.service.startAuthorization(authorizeParams(clientId), T0);
    const requestId = started.kind === 'consent' ? started.requestId : '';
    const denied = await s.service.decide({ requestId, userId: s.userId, approve: false, at: T0, actor: { actorType: 'USER', actorId: s.userId }, requestIdForAudit: 'r' });
    expect(denied.kind === 'redirect' && Object.fromEntries(new URL(denied.redirectTo).searchParams)).toEqual({ error: 'access_denied', state: 'st-1', iss: ISSUER });
  });

  it('a request decides once, and not after 30 minutes', async () => {
    const s = await setup();
    const clientId = await registerClaude(s);
    const a = await s.service.startAuthorization(authorizeParams(clientId), T0);
    const id = a.kind === 'consent' ? a.requestId : '';
    const decide = (at: Date) => s.service.decide({ requestId: id, userId: s.userId, approve: true, at, actor: { actorType: 'USER', actorId: s.userId }, requestIdForAudit: 'r' });
    const [first, second] = await Promise.all([decide(T0), decide(T0)]);
    expect([first.kind, second.kind].sort()).toEqual(['gone', 'redirect']);

    const b = await s.service.startAuthorization(authorizeParams(clientId), T0);
    const late = await s.service.decide({ requestId: b.kind === 'consent' ? b.requestId : '', userId: s.userId, approve: true, at: new Date(T0.getTime() + OAUTH_TTL.requestMs), actor: { actorType: 'USER', actorId: s.userId }, requestIdForAudit: 'r' });
    expect(late.kind).toBe('gone');
  });
});

describe('token: authorization_code', () => {
  it('exchanges once for an access and a refresh token', async () => {
    const s = await setup();
    const { body } = await tokensFor(s);
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read write' });
    expect(body.access_token).toMatch(/^mat_/);
    expect(body.refresh_token).toMatch(/^mrt_/);
  });

  it.each([
    [{ code_verifier: 'x'.repeat(43) }, 400, 'invalid_grant'],
    [{ redirect_uri: 'https://claude.ai/other' }, 400, 'invalid_grant'],
    [{ client_id: 'mcl_someone_else' }, 400, 'invalid_grant'],
    [{ resource: 'https://other.example/mcp' }, 400, 'invalid_target'],
    [{ code: 'mac_unknown' }, 400, 'invalid_grant'],
    [{ grant_type: 'password' }, 400, 'unsupported_grant_type'],
  ])('refuses %j', async (extra, status, error) => {
    const s = await setup();
    const { clientId, code } = await approvedCode(s);
    const res = await s.service.token({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE, ...extra }, T0);
    expect(res).toMatchObject({ status, body: { error } });
  });

  it('a failed verifier leaves the code usable', async () => {
    const s = await setup();
    const { clientId, code } = await approvedCode(s);
    const params = { grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: CLAUDE_CB, resource: RESOURCE };
    expect((await s.service.token({ ...params, code_verifier: 'y'.repeat(43) }, T0)).status).toBe(400);
    expect((await s.service.token({ ...params, code_verifier: VERIFIER }, T0)).status).toBe(200);
  });

  it('an expired code (60 s) is refused', async () => {
    const s = await setup();
    const { clientId, code } = await approvedCode(s);
    const res = await s.service.token({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE }, new Date(T0.getTime() + OAUTH_TTL.codeMs));
    expect(res).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  });

  it('a replayed code revokes the grant (RFC 6749 §4.1.2)', async () => {
    const s = await setup();
    const { clientId, code } = await approvedCode(s);
    const params = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE };
    const first = await s.service.token(params, T0);
    expect((await s.service.token(params, T0)).status).toBe(400);
    expect(await s.service.authenticateAccess((first.body as { access_token: string }).access_token, T0)).toBeNull();
  });

  it('two concurrent exchanges mint one chain (D6)', async () => {
    const s = await setup();
    const { clientId, code } = await approvedCode(s);
    const params = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE };
    const results = await Promise.all([s.service.token(params, T0), s.service.token(params, T0)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});

describe('token: refresh_token (idempotent rotation, D19)', () => {
  const refresh = (s: Setup, clientId: string, token: string, at: Date) => s.service.token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: token }, at);

  it('rotates to a new pair; the old access token keeps working until it expires', async () => {
    const s = await setup();
    const { clientId, body } = await tokensFor(s);
    const later = new Date(T0.getTime() + 10 * 60_000);
    const next = await refresh(s, clientId, body.refresh_token, later);
    expect(next.status).toBe(200);
    const nb = next.body as { access_token: string; refresh_token: string };
    expect(nb.refresh_token).not.toBe(body.refresh_token);
    expect(await s.service.authenticateAccess(nb.access_token, later)).not.toBeNull();
  });

  it('a retry within 30 s gets the identical pair, and concurrent refreshes agree', async () => {
    const s = await setup();
    const { clientId, body } = await tokensFor(s);
    const at = new Date(T0.getTime() + 10 * 60_000);
    const [a, b] = await Promise.all([refresh(s, clientId, body.refresh_token, at), refresh(s, clientId, body.refresh_token, at)]);
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    const retry = await refresh(s, clientId, body.refresh_token, new Date(at.getTime() + OAUTH_TTL.reuseGraceMs - 1));
    // Same tokens; expires_in counts down from the retry.
    expect(retry.body).toMatchObject({ access_token: (a.body as { access_token: string }).access_token, refresh_token: (a.body as { refresh_token: string }).refresh_token, expires_in: 3570 });
    expect(s.captureMessage).not.toHaveBeenCalled();
  });

  it('reuse after 30 s revokes the grant and warns Sentry', async () => {
    const s = await setup();
    const { clientId, body } = await tokensFor(s);
    const at = new Date(T0.getTime() + 10 * 60_000);
    const next = await refresh(s, clientId, body.refresh_token, at);
    const replay = await refresh(s, clientId, body.refresh_token, new Date(at.getTime() + OAUTH_TTL.reuseGraceMs));
    expect(replay).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    expect(await s.service.authenticateAccess((next.body as { access_token: string }).access_token, at)).toBeNull();
    expect(s.captureMessage).toHaveBeenCalledWith('warning', 'OAuth refresh token reused; grant revoked', expect.objectContaining({ reason: 'refresh_reuse' }));
  });

  it('a thief replaying inside the window shares the chain, which dies at the next rotation’s replay', async () => {
    const s = await setup();
    const { clientId, body } = await tokensFor(s);
    const at = new Date(T0.getTime() + 10 * 60_000);
    const honest = (await refresh(s, clientId, body.refresh_token, at)).body as { refresh_token: string };
    const thief = (await refresh(s, clientId, body.refresh_token, new Date(at.getTime() + 1000))).body as { refresh_token: string };
    expect(thief.refresh_token).toBe(honest.refresh_token);
    const later = new Date(at.getTime() + 60 * 60_000);
    expect((await refresh(s, clientId, honest.refresh_token, later)).status).toBe(200);
    expect((await refresh(s, clientId, thief.refresh_token, new Date(later.getTime() + OAUTH_TTL.reuseGraceMs))).status).toBe(400);
  });

  it('refuses another client’s token, an expired one, and one on a revoked grant', async () => {
    const s = await setup();
    const { clientId, body } = await tokensFor(s);
    expect(await refresh(s, 'mcl_other', body.refresh_token, T0)).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    expect(await refresh(s, clientId, body.refresh_token, new Date(T0.getTime() + OAUTH_TTL.refreshIdleMs))).toMatchObject({ status: 400 });
    const grant = (await s.service.authenticateAccess(body.access_token, T0))!.grant;
    await s.store.oauth.revokeGrant({ grantId: grant.id, reason: 'user', at: T0, audit: [] });
    expect(await refresh(s, clientId, body.refresh_token, T0)).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  });

  it('never extends past the grant’s 180-day cap', async () => {
    const s = await setup();
    const { clientId, body } = await tokensFor(s);
    const nearEnd = new Date(T0.getTime() + OAUTH_TTL.grantMs - 60_000);
    // Keep the chain alive with a refresh every 40 days up to near the end.
    let token = body.refresh_token;
    for (let t = T0.getTime() + 40 * 86_400_000; t < nearEnd.getTime(); t += 40 * 86_400_000) token = ((await refresh(s, clientId, token, new Date(t))).body as { refresh_token: string }).refresh_token;
    const last = await refresh(s, clientId, token, nearEnd);
    expect((last.body as { expires_in: number }).expires_in).toBeLessThanOrEqual(60);
    expect((await refresh(s, clientId, (last.body as { refresh_token: string }).refresh_token, new Date(T0.getTime() + OAUTH_TTL.grantMs))).status).toBe(400);
  });
});

describe('authenticateAccess', () => {
  it('finds the live grant for an access token, and nothing for a refresh token', async () => {
    const s = await setup();
    const { body } = await tokensFor(s);
    expect((await s.service.authenticateAccess(body.access_token, T0))?.grant.userId).toBe(s.userId);
    expect(await s.service.authenticateAccess(body.refresh_token, T0)).toBeNull();
    expect(await s.service.authenticateAccess('mat_garbage', T0)).toBeNull();
  });

  it('expires after an hour', async () => {
    const s = await setup();
    const { body } = await tokensFor(s);
    expect(await s.service.authenticateAccess(body.access_token, new Date(T0.getTime() + OAUTH_TTL.accessMs))).toBeNull();
  });

  it('rejects a token bound to another resource (D3)', async () => {
    const s = await setup();
    const { body } = await tokensFor(s);
    const other = new OAuthService({ store: s.store, issuer: 'https://other.example', pepper: 'session-pepper-with-at-least-32-chars!!', deriveKey: 'derive-key-with-at-least-32-characters!!', fetchMetadata: s.fetchMetadata, captureMessage: s.captureMessage, auditFor: async () => [] });
    expect(await other.authenticateAccess(body.access_token, T0)).toBeNull();
  });
});

describe('revoke endpoint (RFC 7009)', () => {
  it('revoking either token ends the grant; unknown tokens are fine', async () => {
    const s = await setup();
    const { body } = await tokensFor(s);
    await s.service.revokeToken('mrt_unknown', T0);
    await s.service.revokeToken(body.refresh_token, T0);
    expect(await s.service.authenticateAccess(body.access_token, T0)).toBeNull();
  });
});
