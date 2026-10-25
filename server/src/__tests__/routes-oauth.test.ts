import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { s256Challenge } from '../oauth/protocol.js';
import { OAUTH_TTL } from '../oauth/service.js';
import type { ErrorReporter } from '../observability/reporter.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-434: OAuth for MCP agents over HTTP — discovery, registration, authorize → consent → token, /mcp, and every way
 * an agent loses access (AC1–AC8). The protocol rules themselves are proven in src/oauth/__tests__.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ORIGIN = 'http://localhost';
const RESOURCE = `${ORIGIN}/mcp`;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const JOB_TOKEN = 'test-job-token-with-at-least-32-characters!!';
const COOKIE = 'mut_session';
const SAME_ORIGIN = { origin: ORIGIN };
const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const T0 = new Date('2026-10-25T09:00:00Z');
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

function recordingReporter() {
  const messages: Array<{ level: string; message: string; tags: Record<string, string> | undefined }> = [];
  const reporter: ErrorReporter = { enabled: true, captureException: () => undefined, captureMessage: (level, message, tags) => void messages.push({ level, message, tags }), flush: async () => true };
  return { reporter, messages };
}

function harness(options: { oauth?: boolean; registerLimit?: number; tokenClientLimit?: number; billingGate?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  let now = T0;
  const { reporter, messages } = recordingReporter();
  const fetchMetadata = vi.fn();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => now,
    reporter,
    jobToken: JOB_TOKEN,
    billingGate: options.billingGate ?? false,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: false, trustedProxyHops: 1, portalOrigin: ORIGIN },
    oauth:
      options.oauth === false
        ? null
        : {
            deriveKey: 'derive-key-with-at-least-32-characters!!',
            fetchMetadata,
            limiters: {
              register: new SlidingWindowRateLimiter(options.registerLimit ?? 1000, 3_600_000),
              authorize: new SlidingWindowRateLimiter(1000),
              tokenClient: new SlidingWindowRateLimiter(options.tokenClientLimit ?? 1000),
              tokenIp: new SlidingWindowRateLimiter(1000),
              revoke: new SlidingWindowRateLimiter(1000),
            },
          },
  });
  return { app, store, messages, fetchMetadata, setNow: (at: Date) => void (now = at), now: () => now };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const form = (body: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

async function person(h: Harness, { flag = true } = {}) {
  const email = `agent${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const userId = created.user.id as string;
  if (flag) expect((await h.app.request(`/admin/v1/users/${userId}/features/agent_access`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  return { cookie: { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN }, userId, password: created.password as string, personalId: created.personalProfile.id as string };
}
type Person = Awaited<ReturnType<typeof person>>;

async function register(h: Harness, redirect = CLAUDE_CB): Promise<string> {
  const res = await h.app.request('/oauth/register', json({ client_name: 'Claude', redirect_uris: [redirect] }));
  expect(res.status).toBe(201);
  return (await read(res)).client_id as string;
}

async function authorize(h: Harness, clientId: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CLAUDE_CB, code_challenge: s256Challenge(VERIFIER), code_challenge_method: 'S256', state: 'st-1', resource: RESOURCE, ...extra });
  return h.app.request(`/oauth/authorize?${query.toString()}`);
}

async function requestIdFrom(res: Response): Promise<string> {
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location') ?? '', ORIGIN);
  expect(location.pathname).toBe('/connect/approve');
  return location.searchParams.get('request') ?? '';
}

/** Register, authorize, approve as `p`, exchange: an agent's live tokens. */
async function connect(h: Harness, p: Person) {
  const clientId = await register(h);
  const requestId = await requestIdFrom(await authorize(h, clientId));
  const decided = await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'approve' }, p.cookie));
  expect(decided.status).toBe(200);
  const code = new URL((await read(decided)).redirectTo).searchParams.get('code') ?? '';
  const res = await h.app.request('/oauth/token', form({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE }));
  expect(res.status).toBe(200);
  const tokens = (await read(res)) as { access_token: string; refresh_token: string };
  return { clientId, ...tokens, bearer: { authorization: `Bearer ${tokens.access_token}` } };
}

const initialize = (h: Harness, headers: Record<string, string>) =>
  h.app.request('/mcp', { method: 'POST', headers: { ...MCP_HEADERS, ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });

const agentAudit = async (h: Harness, organizationId: string) =>
  (await read(await h.app.request(`/admin/v1/organizations/${organizationId}/audit`, { headers: ADMIN }))).events.filter((e: { action: string }) => e.action.startsWith('user.agent_'));

describe('discovery', () => {
  it('publishes the authorization server and protected resource documents, cross-origin', async () => {
    const h = harness();
    const as = await h.app.request('/.well-known/oauth-authorization-server');
    expect(as.headers.get('access-control-allow-origin')).toBe('*');
    expect(await read(as)).toMatchObject({ issuer: ORIGIN, token_endpoint: `${ORIGIN}/oauth/token`, code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true });
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      expect(await read(await h.app.request(path))).toEqual({ resource: RESOURCE, authorization_servers: [ORIGIN], scopes_supported: ['read', 'write'], bearer_methods_supported: ['header'] });
    }
    expect((await h.app.request('/oauth/token', { method: 'OPTIONS' })).status).toBe(204);
  });

  it('answers 503 OAUTH_NOT_CONFIGURED everywhere when OAuth is off', async () => {
    const h = harness({ oauth: false });
    const p = await person(h);
    for (const res of [await h.app.request('/.well-known/oauth-authorization-server'), await h.app.request('/oauth/register', json({})), await initialize(h, {}), await h.app.request('/v1/oauth/grants', { headers: p.cookie })]) {
      expect(res.status).toBe(503);
      expect((await read(res)).error.code).toBe('OAUTH_NOT_CONFIGURED');
    }
  });
});

describe('sign-in end to end (AC1)', () => {
  it('registers, authorizes, consents, exchanges and initializes /mcp with no tools (D10)', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer } = await connect(h, p);
    const init = await initialize(h, bearer);
    expect(init.status).toBe(200);
    expect((await read(init)).result.serverInfo).toEqual({ name: 'mtb3a', version: '0.1.0-test' });
    const tools = await h.app.request('/mcp', { method: 'POST', headers: { ...MCP_HEADERS, ...bearer, 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    expect(tools.status).toBe(200);
    const body = await read(tools);
    expect(body.result?.tools ?? []).toEqual([]);
  });

  it('a refresh rotates and the new access token works', async () => {
    const h = harness();
    const p = await person(h);
    const { clientId, refresh_token: refreshToken } = await connect(h, p);
    h.setNow(new Date(T0.getTime() + 2 * OAUTH_TTL.accessMs));
    const res = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }));
    expect(res.status).toBe(200);
    expect((await initialize(h, { authorization: `Bearer ${(await read(res)).access_token as string}` })).status).toBe(200);
  });

  it('shows the consent page what is asking, trusted by its redirect host', async () => {
    const h = harness();
    const p = await person(h);
    const requestId = await requestIdFrom(await authorize(h, await register(h)));
    const res = await h.app.request(`/v1/oauth/requests/${requestId}`, { headers: p.cookie });
    expect(await read(res)).toMatchObject({ id: requestId, client: { name: 'Claude', kind: 'DCR', trust: 'VERIFIED', redirectHost: 'claude.ai' }, scopes: ['read', 'write'], agentAccess: true });
  });

  it('sends authorize errors about the client to the portal page, never to the presented redirect', async () => {
    const h = harness();
    const res = await authorize(h, 'mcl_unknown');
    expect(res.headers.get('location')).toBe('/connect/approve?error=invalid_client');
  });

  it('audits the connection on the person’s profiles', async () => {
    const h = harness();
    const p = await person(h);
    await connect(h, p);
    expect(await agentAudit(h, p.personalId)).toMatchObject([{ action: 'user.agent_connected', actorType: 'USER', actorId: p.userId, metadata: { clientName: 'Claude', scopes: ['read', 'write'] } }]);
  });
});

describe('without agent_access (AC2, AC6)', () => {
  it('the consent page is told, allowing is refused, and denying sends access_denied back', async () => {
    const h = harness();
    const p = await person(h, { flag: false });
    const requestId = await requestIdFrom(await authorize(h, await register(h)));
    expect((await read(await h.app.request(`/v1/oauth/requests/${requestId}`, { headers: p.cookie }))).agentAccess).toBe(false);
    const allow = await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'approve' }, p.cookie));
    expect(allow.status).toBe(403);
    expect((await read(allow)).error).toMatchObject({ code: 'FEATURE_NOT_ENABLED', details: { feature: 'agent_access' } });
    const deny = await read(await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'deny' }, p.cookie)));
    expect(new URL(deny.redirectTo).searchParams.get('error')).toBe('access_denied');
  });

  it('a decided request answers 409 on a second decision and 404 to the page', async () => {
    const h = harness();
    const p = await person(h);
    const requestId = await requestIdFrom(await authorize(h, await register(h)));
    await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'deny' }, p.cookie));
    expect((await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'approve' }, p.cookie))).status).toBe(409);
    expect((await h.app.request(`/v1/oauth/requests/${requestId}`, { headers: p.cookie })).status).toBe(404);
  });

  it('a flag revoked between two calls is refused on the second, without a step-up hint (OV8)', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer } = await connect(h, p);
    expect((await initialize(h, bearer)).status).toBe(200);
    // Off and on again without touching the grants: hasFeature is read per call (no cache).
    await h.store.features.revoke({ userId: p.userId, feature: 'agent_access', at: h.now(), audit: [] });
    const refused = await initialize(h, bearer);
    expect(refused.status).toBe(403);
    expect((await read(refused)).error.code).toBe('FEATURE_NOT_ENABLED');
    expect(refused.headers.get('www-authenticate')).toBeNull();
  });

  it('Connected apps is hidden without the flag', async () => {
    const h = harness();
    const p = await person(h, { flag: false });
    expect((await h.app.request('/v1/oauth/grants', { headers: p.cookie })).status).toBe(403);
  });
});

describe('/mcp authentication', () => {
  it('asks for sign-in with the resource metadata pointer (RFC 9728)', async () => {
    const h = harness();
    const missing = await initialize(h, {});
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="read write"`);
    const bad = await initialize(h, { authorization: 'Bearer mat_nope' });
    expect(bad.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('GET and DELETE answer 405 (stateless, OV9)', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer } = await connect(h, p);
    expect((await h.app.request('/mcp', { headers: bearer })).status).toBe(405);
    expect((await h.app.request('/mcp', { method: 'DELETE', headers: bearer })).status).toBe(405);
  });

  it('an agent token opens nothing on /v1 (PRINCIPAL_NOT_ACCEPTED)', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer, refresh_token: refreshToken } = await connect(h, p);
    for (const authorization of [bearer.authorization, `Bearer ${refreshToken}`]) {
      const res = await h.app.request('/v1/me', { headers: { authorization } });
      expect((await read(res)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
    }
  });

  it('a closing account is refused at once (AC8)', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer } = await connect(h, p);
    expect((await h.app.request('/v1/me/closure', json({ password: p.password }, p.cookie))).status).toBe(200);
    const res = await initialize(h, bearer);
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('ACCOUNT_CLOSING');
  });

  it('a disabled account loses the agent and its grant (AC8)', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer } = await connect(h, p);
    await h.store.users.setStatus(p.userId, 'DISABLED', h.now());
    expect((await initialize(h, bearer)).status).toBe(401);
    expect(await h.store.oauth.listLiveGrants(p.userId, h.now())).toEqual([]);
    expect((await agentAudit(h, p.personalId)).map((e: { action: string; actorType: string; metadata: unknown }) => [e.action, e.actorType, e.metadata])).toContainEqual(['user.agent_disconnected', 'SYSTEM', { reason: 'account_changed' }]);
  });
});

describe('revocation (AC3, AC7, D11, D12)', () => {
  it('Revoke on the You page ends access on the next call', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer } = await connect(h, p);
    const list = await read(await h.app.request('/v1/oauth/grants', { headers: p.cookie }));
    expect(list).toMatchObject({ mcpUrl: RESOURCE, items: [{ clientName: 'Claude', trust: 'VERIFIED', scopes: ['read', 'write'] }] });
    expect((await h.app.request(`/v1/oauth/grants/${list.items[0].id as string}`, { method: 'DELETE', headers: p.cookie })).status).toBe(204);
    expect((await initialize(h, bearer)).status).toBe(401);
    expect((await h.app.request(`/v1/oauth/grants/${list.items[0].id as string}`, { method: 'DELETE', headers: p.cookie })).status).toBe(404);
    expect((await agentAudit(h, p.personalId)).map((e: { action: string; metadata: unknown }) => [e.action, e.metadata])).toContainEqual(['user.agent_disconnected', { reason: 'user' }]);
  });

  it('one person can’t revoke another’s grant', async () => {
    const h = harness();
    const owner = await person(h);
    const other = await person(h);
    await connect(h, owner);
    const [grant] = await h.store.oauth.listLiveGrants(owner.userId, h.now());
    expect((await h.app.request(`/v1/oauth/grants/${grant!.id}`, { method: 'DELETE', headers: other.cookie })).status).toBe(404);
  });

  it('revoking agent_access disconnects every agent, audited and noted in Sentry (AC7, D14)', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer } = await connect(h, p);
    await connect(h, p);
    expect((await h.app.request(`/admin/v1/users/${p.userId}/features/agent_access`, { method: 'DELETE', headers: ADMIN })).status).toBe(200);
    expect(await h.store.oauth.listLiveGrants(p.userId, h.now())).toEqual([]);
    expect((await initialize(h, bearer)).status).toBe(401);
    expect(h.messages).toContainEqual({ level: 'info', message: 'OAuth grants revoked', tags: { reason: 'feature_revoked', count: '2' } });
  });

  it('changing the password disconnects every agent (D11)', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer } = await connect(h, p);
    const res = await h.app.request('/v1/me/password', json({ currentPassword: p.password, newPassword: 'a different long enough passphrase' }, p.cookie));
    expect(res.status).toBe(204);
    expect((await initialize(h, bearer)).status).toBe(401);
    expect(h.messages).toContainEqual({ level: 'info', message: 'OAuth grants revoked', tags: { reason: 'password_changed', count: '1' } });
  });

  it('the operator’s sign-out-everywhere includes agents; the flag stays (D12)', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer } = await connect(h, p);
    const res = await h.app.request(`/admin/v1/users/${p.userId}/sessions/revoke`, { method: 'POST', headers: ADMIN });
    expect(await read(res)).toEqual({ revoked: 1, agentGrantsRevoked: 1 });
    expect((await initialize(h, bearer)).status).toBe(401);
    expect(await h.store.features.activeFor(p.userId)).toEqual(['agent_access']);
  });

  it('disabling the account revokes its grants (D12)', async () => {
    const h = harness();
    const p = await person(h);
    await connect(h, p);
    expect((await h.app.request(`/admin/v1/users/${p.userId}/disable`, { method: 'POST', headers: ADMIN })).status).toBe(200);
    expect(await h.store.oauth.listLiveGrants(p.userId, h.now())).toEqual([]);
  });

  it('a reused refresh token kills the grant and warns Sentry (AC4)', async () => {
    const h = harness();
    const p = await person(h);
    const { clientId, refresh_token: refreshToken, bearer } = await connect(h, p);
    await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }));
    h.setNow(new Date(T0.getTime() + OAUTH_TTL.reuseGraceMs));
    const replay = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }));
    expect(await read(replay)).toMatchObject({ error: 'invalid_grant' });
    expect((await initialize(h, bearer)).status).toBe(401);
    expect(h.messages.find((m) => m.level === 'warning')?.tags?.reason).toBe('refresh_reuse');
  });

  it('the token endpoint revokes on RFC 7009 and answers 200 for anything', async () => {
    const h = harness();
    const p = await person(h);
    const { bearer, refresh_token: refreshToken } = await connect(h, p);
    expect((await h.app.request('/oauth/revoke', form({ token: 'mrt_unknown' }))).status).toBe(200);
    expect((await h.app.request('/oauth/revoke', form({ token: refreshToken }))).status).toBe(200);
    expect((await initialize(h, bearer)).status).toBe(401);
  });
});

describe('rate limits (AC5)', () => {
  it('registration is limited per address', async () => {
    const h = harness({ registerLimit: 1 });
    await register(h);
    const res = await h.app.request('/oauth/register', json({ client_name: 'Claude', redirect_uris: [CLAUDE_CB] }));
    expect(res.status).toBe(429);
    expect(await read(res)).toMatchObject({ error: 'temporarily_unavailable' });
  });

  it('one address spending a public client’s token budget leaves it for every other address (review finding 4)', async () => {
    const h = harness({ tokenClientLimit: 1 });
    const clientId = await register(h);
    const tokenFrom = (ip: string) => h.app.request('/oauth/token', { ...form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: 'mrt_x' }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip } });
    expect((await tokenFrom('203.0.113.66')).status).toBe(400);
    expect((await tokenFrom('203.0.113.66')).status).toBe(429);
    expect((await tokenFrom('203.0.113.77')).status).toBe(400);
  });
});

describe('the lapse gate (MUT-361)', () => {
  it('never stops a person connecting or disconnecting an agent: it writes no record (found by the live QA run)', async () => {
    const h = harness({ billingGate: true });
    const p = await person(h);
    expect((await h.app.request('/v1/me', { headers: p.cookie })).status).toBe(200);
    const { bearer } = await connect(h, p);
    expect((await initialize(h, bearer)).status).toBe(200);
    const list = await read(await h.app.request('/v1/oauth/grants', { headers: p.cookie }));
    expect((await h.app.request(`/v1/oauth/grants/${list.items[0].id as string}`, { method: 'DELETE', headers: p.cookie })).status).toBe(204);
  });
});

describe('nightly cleanup job', () => {
  it('needs the job token and deletes expired requests and never-granted clients, keeping a granted client', async () => {
    const h = harness();
    const p = await person(h);
    const { clientId } = await connect(h, p);
    const orphan = await register(h);
    await authorize(h, orphan);
    expect((await h.app.request('/jobs/v1/oauth/cleanup', { method: 'POST' })).status).toBe(401);
    h.setNow(new Date(T0.getTime() + 31 * 86_400_000));
    const res = await h.app.request('/jobs/v1/oauth/cleanup', { method: 'POST', headers: { 'x-job-token': JOB_TOKEN } });
    expect(res.status).toBe(200);
    // Both requests (the decided one and the orphan's), the used code, and the 1-hour access token expired over a week
    // ago go; the refresh token (45 days) stays.
    expect(await read(res)).toEqual({ requests: 2, codes: 1, tokens: 1, clients: 1 });
    expect(await h.store.oauth.findClient(orphan)).toBeNull();
    expect(await h.store.oauth.findClient(clientId)).not.toBeNull();
  });
});

describe('audit visibility', () => {
  it('agent events stay out of /v1/audit for API keys (SESSION_ONLY_ACTIONS)', async () => {
    const { SESSION_ONLY_ACTIONS } = await import('../routes/audit.js');
    expect(SESSION_ONLY_ACTIONS).toEqual(expect.arrayContaining(['user.agent_connected', 'user.agent_disconnected']));
  });
});
