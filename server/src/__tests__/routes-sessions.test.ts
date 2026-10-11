import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SIGN_IN_POLICY, sessionDigest } from '../auth/sessions.js';
import { ARGON2_MINIMUMS, createArgon2Hasher, type PasswordHasher } from '../auth/users.js';
import { sessionAccess } from '../auth/writability.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const SAME_ORIGIN = { origin: 'http://localhost' };
const COOKIE = '__Host-mut_session';
const realHasher = createArgon2Hasher(ARGON2_MINIMUMS);

function harness(opts: { limit?: number } = {}) {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-20T09:00:00Z') };
  const logs: string[] = [];
  const hasher: PasswordHasher & { verify: ReturnType<typeof vi.fn> } = {
    hash: (p) => realHasher.hash(p),
    verify: vi.fn((h: string, p: string) => realHasher.verify(h, p)),
  };
  const app = createApp({
    store,
    logger: pino({ level: 'trace' }, { write: (line: string) => void logs.push(line) }),
    rateLimiter: new SlidingWindowRateLimiter(opts.limit ?? 100_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    passwordHasher: hasher,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, clock, logs, hasher };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });
const minutes = (h: Harness, n: number) => {
  h.clock.now = new Date(h.clock.now.getTime() + n * 60_000);
};

async function firm(h: Harness) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const auth = { authorization: `Bearer ${key.secret}` };
  await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
  const customer = await read(await h.app.request('/v1/customers', json({ name: `Haddad ${seq}` }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Sale', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org: org as { id: string; name: string }, auth, keyId: key.apiKey.id as string, customer, project };
}

async function person(h: Harness, organizationId: string, email = `partner${++seq}@firm.ps`) {
  const created = await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId }, admin)));
  return { id: created.user.id as string, email, password: created.initialPassword as string };
}

async function signIn(h: Harness, email: string, password: string, headers: Record<string, string> = SAME_ORIGIN) {
  const res = await h.app.request('/v1/sessions', json({ email, password }, headers));
  const setCookie = res.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(setCookie)?.[1] ?? '';
  return { res, setCookie, token };
}

const withSession = (token: string, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, ...extra });

describe('POST /v1/sessions — sign in', () => {
  it('sets a __Host- httpOnly Strict cookie, returns Me without the token, records the sign-in', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { res, setCookie, token } = await signIn(h, `  ${p.email.toUpperCase()} `, p.password);
    expect(res.status).toBe(201);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(setCookie).toContain('Max-Age=43200');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).not.toContain('Domain=');
    const text = await res.text();
    expect(text).not.toContain(token);
    const me = JSON.parse(text);
    expect(me.user).toMatchObject({ id: p.id, email: p.email });
    expect(me.profiles.map((x: Loose) => x.id)).toEqual([f.org.id]);

    const user = await h.store.users.getById(p.id);
    expect(user?.lastSignInAt?.toISOString()).toBe(h.clock.now.toISOString());
    const events = (await h.store.audit.list(f.org.id, { entityType: 'user', action: 'user.signed_in' }, { limit: 10, cursor: null })).items;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: 'USER', actorId: p.id, entityId: p.id });
  });

  it('answers unknown email, wrong password and a disabled user identically, verifying exactly once each', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const disabled = await person(h, f.org.id);
    await h.app.request(`/admin/v1/users/${disabled.id}/disable`, json({}, admin));

    const outcomes: Loose[] = [];
    for (const [email, password] of [
      ['nobody@firm.ps', 'whatever-password'],
      [p.email, 'wrong-password'],
      [disabled.email, disabled.password],
    ] as const) {
      h.hasher.verify.mockClear();
      const { res, setCookie } = await signIn(h, email, password);
      expect(h.hasher.verify).toHaveBeenCalledTimes(1);
      expect(setCookie).toBe('');
      const body = await read(res);
      outcomes.push({ status: res.status, code: body.error.code, message: body.error.message, details: body.error.details });
    }
    expect(outcomes[0]).toEqual({ status: 401, code: 'INVALID_CREDENTIALS', message: outcomes[0].message, details: undefined });
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
  });

  it('verifies unknown emails against a dummy hash with the configured parameters', async () => {
    const h = harness();
    h.hasher.verify.mockClear();
    await signIn(h, 'nobody@firm.ps', 'x');
    const [storedHash] = h.hasher.verify.mock.calls[0] as [string, string];
    expect(storedHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('locks an account after five failures, audits the lock once, and lets it in after the lock window', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    for (let i = 0; i < SIGN_IN_POLICY.maxFailures; i++) expect((await signIn(h, p.email, 'wrong')).res.status).toBe(401);

    h.hasher.verify.mockClear();
    const blocked = await signIn(h, p.email, p.password);
    expect(blocked.res.status).toBe(401);
    expect((await read(blocked.res)).error.code).toBe('INVALID_CREDENTIALS');
    expect(h.hasher.verify).toHaveBeenCalledTimes(1);
    expect((await h.store.users.getById(p.id))?.lockedUntil).not.toBeNull();
    const locks = (await h.store.audit.list(f.org.id, { action: 'user.locked_out' }, { limit: 10, cursor: null })).items;
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ actorType: 'SYSTEM', entityId: p.id });

    minutes(h, SIGN_IN_POLICY.lockMs / 60_000);
    const allowed = await signIn(h, p.email, p.password);
    expect(allowed.res.status).toBe(201);
    expect(await h.store.users.getById(p.id)).toMatchObject({ failedSignIns: 0, lockedUntil: null });
  });

  it('locks an unknown email the same way, so lockout cannot reveal which emails exist', async () => {
    const h = harness();
    const bodies: string[] = [];
    for (let i = 0; i <= SIGN_IN_POLICY.maxFailures; i++) {
      const { res } = await signIn(h, 'ghost@firm.ps', 'guess');
      expect(res.status).toBe(401);
      const body = await read(res);
      bodies.push(`${body.error.code}:${body.error.message}`);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('rate-limits sign-in attempts per client IP', async () => {
    const h = harness();
    const from = (ip: string) => ({ ...SAME_ORIGIN, 'x-forwarded-for': ip });
    for (let i = 0; i < SIGN_IN_POLICY.ipPerMinute; i++) await signIn(h, `n${i}@firm.ps`, 'x', from('198.51.100.7'));
    const limited = await signIn(h, 'n-last@firm.ps', 'x', from('198.51.100.7'));
    expect(limited.res.status).toBe(429);
    expect(limited.res.headers.get('retry-after')).toBeTruthy();
    expect((await signIn(h, 'other@firm.ps', 'x', from('203.0.113.9'))).res.status).toBe(401);
  });

  it.each([
    [{ origin: 'https://evil.example' }],
    [{ 'sec-fetch-site': 'cross-site', origin: 'http://localhost' }],
    [{}],
  ])('refuses a cross-site sign-in %j with 403 CROSS_SITE_REQUEST', async (headers) => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { res } = await signIn(h, p.email, p.password, headers);
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('CROSS_SITE_REQUEST');
  });

  it('accepts Sec-Fetch-Site: same-origin without an Origin header', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    expect((await signIn(h, p.email, p.password, { 'sec-fetch-site': 'same-origin' })).res.status).toBe(201);
  });
});

describe('GET /v1/me', () => {
  it('lists each membership as a hosted profile with its writer of record and access', async () => {
    const h = harness();
    const a = await firm(h);
    const b = await firm(h);
    await h.store.integrations.connect({ organizationId: a.org.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Firm A', connectedByApiKeyId: a.keyId, at: h.clock.now });
    const p = await person(h, a.org.id);
    await h.app.request(`/admin/v1/users/${p.id}/memberships`, json({ organizationId: b.org.id }, admin));
    const { token } = await signIn(h, p.email, p.password);

    const res = await h.app.request('/v1/me', { headers: withSession(token) });
    expect(res.status).toBe(200);
    const me = await read(res);
    expect(me.user).toMatchObject({ id: p.id, email: p.email, displayName: 'Nour Haddad', locale: 'en' });
    const byId = Object.fromEntries(me.profiles.map((x: Loose) => [x.id, x]));
    expect(byId[a.org.id]).toMatchObject({ name: a.org.name, source: 'hosted', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', writerOfRecord: 'MALAFAT' });
    expect(byId[b.org.id]).toMatchObject({ source: 'hosted', writerOfRecord: null });
    expect(byId[a.org.id].access).toEqual(sessionAccess());
    expect(byId[a.org.id].access).toMatchObject({ customers: 'read', payments: 'read', expenses: 'read-write', integration: 'none' });
  });

  it('answers 401 UNAUTHENTICATED without a credential and SESSION_EXPIRED for an unknown cookie', async () => {
    const h = harness();
    const none = await h.app.request('/v1/me');
    expect(none.status).toBe(401);
    expect((await read(none)).error.code).toBe('UNAUTHENTICATED');
    const unknown = await h.app.request('/v1/me', { headers: withSession('A'.repeat(43)) });
    expect(unknown.status).toBe(401);
    expect((await read(unknown)).error.code).toBe('SESSION_EXPIRED');
  });
});

describe('expiry', () => {
  it('expires after the idle limit', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    minutes(h, 119);
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(200);
    minutes(h, 120);
    const res = await h.app.request('/v1/me', { headers: withSession(token) });
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('SESSION_EXPIRED');
  });

  it('slides with activity but never past the absolute limit', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    for (let elapsed = 100; elapsed < 12 * 60; elapsed += 100) {
      minutes(h, 100);
      expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(200);
    }
    // 700 minutes in; the absolute limit is 720.
    minutes(h, 20);
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(401);
  });
});

describe('DELETE /v1/sessions/current — sign out', () => {
  it('revokes server-side and clears the cookie; a replayed cookie is refused', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const res = await h.app.request('/v1/sessions/current', { method: 'DELETE', headers: withSession(token, SAME_ORIGIN) });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${COOKIE}=;.*Max-Age=0`));
    const replay = await h.app.request('/v1/me', { headers: withSession(token) });
    expect(replay.status).toBe(401);
    expect((await read(replay)).error.code).toBe('SESSION_EXPIRED');
  });

  it('refuses a cross-site sign-out', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const res = await h.app.request('/v1/sessions/current', { method: 'DELETE', headers: withSession(token, { origin: 'https://evil.example' }) });
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('CROSS_SITE_REQUEST');
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(200);
  });
});

describe('operator actions end sessions', () => {
  it('a password reset revokes every session of that user', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const one = await signIn(h, p.email, p.password);
    const two = await signIn(h, p.email, p.password);
    await h.app.request(`/admin/v1/users/${p.id}/password`, json({}, admin));
    for (const s of [one, two]) expect((await h.app.request('/v1/me', { headers: withSession(s.token) })).status).toBe(401);
  });

  it('disable revokes sessions and refuses sign-in; enable lets the user back in', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    await h.app.request(`/admin/v1/users/${p.id}/disable`, json({}, admin));
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(401);
    expect((await signIn(h, p.email, p.password)).res.status).toBe(401);
    await h.app.request(`/admin/v1/users/${p.id}/enable`, json({}, admin));
    expect((await signIn(h, p.email, p.password)).res.status).toBe(201);
  });

  it('the operator can revoke all sessions explicitly', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const res = await h.app.request(`/admin/v1/users/${p.id}/sessions/revoke`, json({}, admin));
    expect(res.status).toBe(200);
    expect((await read(res)).revoked).toBe(1);
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(401);
    expect((await h.app.request('/admin/v1/users/00000000-0000-4000-8000-000000000000/sessions/revoke', json({}, admin))).status).toBe(404);
  });
});

describe('principals', () => {
  it('refuses a request carrying both an API key and a session cookie', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const res = await h.app.request('/v1/customers', { headers: { ...f.auth, ...withSession(token), 'x-mutaba3a-profile': f.org.id } });
    expect(res.status).toBe(401);
    expect((await read(res)).error).toMatchObject({ code: 'UNAUTHENTICATED', details: { reason: 'ambiguous_credentials' } });
  });

  it('a session cannot reach a key-only route, and a key cannot reach a session-only route', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const sessionOnKeyRoute = await h.app.request('/v1/integration', { headers: withSession(token, { 'x-mutaba3a-profile': f.org.id }) });
    expect(sessionOnKeyRoute.status).toBe(403);
    expect((await read(sessionOnKeyRoute)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
    const keyOnSessionRoute = await h.app.request('/v1/me', { headers: f.auth });
    expect(keyOnSessionRoute.status).toBe(403);
    expect((await read(keyOnSessionRoute)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });
});

describe('organization selection (X-Mutaba3a-Profile)', () => {
  it('requires the header, serves only member organizations, and 404s everything else', async () => {
    const h = harness();
    const a = await firm(h);
    const b = await firm(h);
    const p = await person(h, a.org.id);
    const { token } = await signIn(h, p.email, p.password);

    const missing = await h.app.request('/v1/customers', { headers: withSession(token) });
    expect(missing.status).toBe(422);
    expect((await read(missing)).error).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'PROFILE_REQUIRED' } });

    const own = await h.app.request('/v1/customers', { headers: withSession(token, { 'x-mutaba3a-profile': a.org.id }) });
    expect(own.status).toBe(200);
    expect((await read(own)).items.map((c: Loose) => c.id)).toEqual([a.customer.id]);

    for (const id of [b.org.id, 'not-a-uuid', '00000000-0000-4000-8000-000000000000']) {
      const res = await h.app.request('/v1/customers', { headers: withSession(token, { 'x-mutaba3a-profile': id }) });
      expect(res.status).toBe(404);
    }
    const cross = await h.app.request(`/v1/customers/${b.customer.id}`, { headers: withSession(token, { 'x-mutaba3a-profile': a.org.id }) });
    expect(cross.status).toBe(404);

    await h.app.request(`/admin/v1/users/${p.id}/memberships/${a.org.id}`, { method: 'DELETE', headers: admin });
    expect((await h.app.request('/v1/customers', { headers: withSession(token, { 'x-mutaba3a-profile': a.org.id }) })).status).toBe(404);
  });

  it('lazy posting during a session read is audited as SYSTEM, never as the user', async () => {
    const h = harness();
    const f = await firm(h);
    const body = {
      projectId: f.project.id,
      amount: '1000.00',
      pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'EXEMPT',
      agreementDate: '2026-10-01',
      paymentTerms: 'EOM',
      installments: [{ label: 'I1', amount: '1000.00', trigger: { type: 'DATE', date: '2026-10-25' } }],
    };
    const preview = await read(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
    expect((await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() }))).status).toBe(201);
    const p = await person(h, f.org.id);
    h.clock.now = new Date('2026-10-26T09:00:00Z');
    const { token } = await signIn(h, p.email, p.password);

    const res = await h.app.request('/v1/summaries/organization', { headers: withSession(token, { 'x-mutaba3a-profile': f.org.id }) });
    expect(res.status).toBe(200);
    const posted = (await h.store.audit.list(f.org.id, { action: 'installment.posted' }, { limit: 10, cursor: null })).items;
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ actorType: 'SYSTEM', actorId: null });
    const all = (await h.store.audit.list(f.org.id, {}, { limit: 200, cursor: null })).items;
    expect(all.filter((e) => e.actorType === 'USER').map((e) => e.action)).toEqual(['user.signed_in']);
  });
});

describe('session rate limit and log hygiene', () => {
  it('rate-limits a session like a key', async () => {
    const h = harness({ limit: 3 });
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    for (let i = 0; i < 3; i++) expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(200);
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(429);
  });

  it('never logs the session token, its digest or the password', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    await h.app.request('/v1/me', { headers: withSession(token) });
    await h.app.request('/v1/sessions/current', { method: 'DELETE', headers: withSession(token, SAME_ORIGIN) });
    const session = (await h.store.sessions.findByDigest(sessionDigest('session-pepper-with-at-least-32-chars!!', token)))!;
    const text = h.logs.join('');
    expect(text).not.toContain(token);
    expect(text).not.toContain(session.tokenDigest);
    expect(text).not.toContain(p.password);
  });
});
