import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SIGN_IN_POLICY, sessionDigest } from '../auth/sessions.js';
import { ARGON2_MINIMUMS, createArgon2Hasher, type PasswordHasher } from '../auth/users.js';
import { sessionAccess } from '../auth/writability.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { SUPPORTED_CURRENCIES } from '../money.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { MeSchema } from '../schemas.js';
import { provisionUser } from './helpers/provision.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const SAME_ORIGIN = { origin: 'http://localhost' };
const COOKIE = '__Host-mut_session';
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
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
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
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
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId });
  return { id: created.user.id as string, email, password: created.password as string, personalId: created.personalProfile.id as string };
}

async function signIn(h: Harness, email: string, password: string, headers: Record<string, string> = SAME_ORIGIN) {
  const res = await h.app.request('/v1/sessions', json({ email, password }, headers));
  const setCookie = res.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(setCookie)?.[1] ?? '';
  return { res, setCookie, token };
}

const withSession = (token: string, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, ...extra });

/** MUT-64: a device-session token for the same person, so "operator actions end sessions" can prove it covers both kinds. */
async function deviceSignIn(h: Harness, email: string, password: string) {
  const res = await h.app.request('/v1/device-sessions', json({ email, password }));
  const { token } = (await read(res)) as { token: string };
  return { token };
}
const withDevice = (token: string) => ({ authorization: `Bearer ${token}` });

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
    expect(me.profiles.map((x: Loose) => x.id).sort()).toEqual([p.personalId, f.org.id].sort());

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
    expect((await read(res)).error).toMatchObject({ code: 'CROSS_SITE_REQUEST', message: 'Sign in from the MTB3A portal itself' });
  });

  it('accepts Sec-Fetch-Site: same-origin without an Origin header', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    expect((await signIn(h, p.email, p.password, { 'sec-fetch-site': 'same-origin' })).res.status).toBe(201);
  });
});

describe('GET /v1/me', () => {
  it('lists every currency the server accepts, in order, on sign-in and on GET /v1/me (MUT-280)', async () => {
    const h = harness();
    const a = await firm(h);
    const p = await person(h, a.org.id);
    const { res, token } = await signIn(h, p.email, p.password);
    const signedIn = await read(res);
    const me = await read(await h.app.request('/v1/me', { headers: withSession(token) }));
    for (const body of [signedIn, me]) {
      expect(body.currencies).toEqual([...SUPPORTED_CURRENCIES]);
      expect(MeSchema.safeParse(body).success).toBe(true);
    }
  });

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
    expect(me.user).toMatchObject({ id: p.id, email: p.email, displayName: 'Nour Haddad', locale: 'ar' });
    const byId = Object.fromEntries(me.profiles.map((x: Loose) => [x.id, x]));
    expect(byId[a.org.id]).toMatchObject({ name: a.org.name, source: 'hosted', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', writerOfRecord: 'MALAFAT' });
    expect(byId[b.org.id]).toMatchObject({ source: 'hosted', writerOfRecord: null });
    expect(byId[a.org.id].access).toEqual(sessionAccess());
    expect(byId[a.org.id].access).toMatchObject({ customers: 'read', payments: 'read', expenses: 'read-write', integration: 'none' });
    // MUT-65: org b has no Malafat integration (a personal profile) — the three profile-dependent rows are read-write there, unlike org a.
    expect(byId[b.org.id].access).toMatchObject({ customers: 'read-write', projects: 'read-write', payments: 'read-write', expenses: 'read-write', integration: 'none' });
  });

  it('marks the caller’s own personal profile with isPersonalDefault, read-write where MUT-65 allows, and no firm (MUT-120)', async () => {
    const h = harness();
    const a = await firm(h);
    await h.store.integrations.connect({ organizationId: a.org.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Firm A', connectedByApiKeyId: a.keyId, at: h.clock.now });
    const p = await person(h, a.org.id);
    const { token } = await signIn(h, p.email, p.password);

    const me = await read(await h.app.request('/v1/me', { headers: withSession(token) }));
    const byId = Object.fromEntries(me.profiles.map((x: Loose) => [x.id, x]));
    expect(Object.keys(byId).sort()).toEqual([p.personalId, a.org.id].sort());
    expect(byId[p.personalId]).toMatchObject({ name: 'شخصي', writerOfRecord: null, isPersonalDefault: true });
    expect(byId[p.personalId].access).toMatchObject({ customers: 'read-write', projects: 'read-write', payments: 'read-write' });
    expect(byId[a.org.id].isPersonalDefault).toBe(false);
  });

  it('lists firm profiles first and the caller’s personal profile last, deterministically (MUT-120 review)', async () => {
    const h = harness();
    const a = await firm(h);
    const b = await firm(h);
    const p = await person(h, a.org.id);
    await h.app.request(`/admin/v1/users/${p.id}/memberships`, json({ organizationId: b.org.id }, admin));
    const { token } = await signIn(h, p.email, p.password);
    const me = await read(await h.app.request('/v1/me', { headers: withSession(token) }));
    // Not sorted on purpose: the portal opens profiles[0], so the order is the contract.
    expect(me.profiles.map((x: Loose) => x.id)).toEqual([a.org.id, b.org.id, p.personalId]);
  });

  it('never marks another user’s personal profile as the caller’s default (MUT-120 review)', async () => {
    const h = harness();
    const f = await firm(h);
    const owner = await person(h, f.org.id);
    const other = await person(h, f.org.id);
    // Planted below the admin API, which refuses this grant.
    await h.store.memberships.grant(other.id, owner.personalId, h.clock.now);
    const { token } = await signIn(h, other.email, other.password);
    const me = await read(await h.app.request('/v1/me', { headers: withSession(token) }));
    expect(me.profiles.filter((x: Loose) => x.isPersonalDefault).map((x: Loose) => x.id)).toEqual([other.personalId]);
    expect(me.profiles.find((x: Loose) => x.id === owner.personalId)?.isPersonalDefault).toBe(false);
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
    expect((await read(res)).error).toMatchObject({ code: 'CROSS_SITE_REQUEST', message: 'This request must come from the MTB3A portal itself' });
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(200);
  });
});

describe('operator actions end sessions', () => {
  it('a reset with --lock revokes every session of that user, cookie and device alike (MUT-64, MUT-235 D2)', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const one = await signIn(h, p.email, p.password);
    const two = await signIn(h, p.email, p.password);
    const device = await deviceSignIn(h, p.email, p.password);
    await h.app.request(`/admin/v1/users/${p.id}/setup-link`, json({ lock: true }, admin));
    for (const s of [one, two]) expect((await h.app.request('/v1/me', { headers: withSession(s.token) })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: withDevice(device.token) })).status).toBe(401);
  });

  it('disable revokes sessions and refuses sign-in, cookie and device alike; enable lets the user back in', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const device = await deviceSignIn(h, p.email, p.password);
    await h.app.request(`/admin/v1/users/${p.id}/disable`, json({}, admin));
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: withDevice(device.token) })).status).toBe(401);
    expect((await signIn(h, p.email, p.password)).res.status).toBe(401);
    await h.app.request(`/admin/v1/users/${p.id}/enable`, json({}, admin));
    expect((await signIn(h, p.email, p.password)).res.status).toBe(201);
  });

  it('the operator can revoke all sessions explicitly, cookie and device alike (MUT-64)', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const device = await deviceSignIn(h, p.email, p.password);
    const res = await h.app.request(`/admin/v1/users/${p.id}/sessions/revoke`, json({}, admin));
    expect(res.status).toBe(200);
    expect((await read(res)).revoked).toBe(2);
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: withDevice(device.token) })).status).toBe(401);
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
    // The person's own two acts (MUT-235: setting their password through the link, then signing in); the read adds none.
    expect(all.filter((e) => e.actorType === 'USER').map((e) => e.action).sort()).toEqual(['user.password_set', 'user.signed_in']);
  });
});

describe('POST /v1/me/password — change your own password (MUT-237)', () => {
  const change = (token: string, body: unknown, extra: Record<string, string> = SAME_ORIGIN) =>
    ({ method: 'POST', headers: { 'content-type': 'application/json', ...withSession(token, extra) }, body: JSON.stringify(body) }) as const;
  const NEW_PASSWORD = 'a different long enough passphrase';

  it('sets the new password, revokes every other session (web and device) and keeps this one, audits it', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const current = await signIn(h, p.email, p.password);
    const other = await signIn(h, p.email, p.password);
    const device = await deviceSignIn(h, p.email, p.password);
    // A real clock moves between signing in and changing the password; a session started before the change must survive it.
    minutes(h, 5);
    const before = (await h.store.sessions.findByDigest(sessionDigest(PEPPER, current.token)))!;

    const res = await h.app.request('/v1/me/password', change(current.token, { currentPassword: p.password, newPassword: NEW_PASSWORD }));
    expect(res.status).toBe(204);

    expect((await h.app.request('/v1/me', { headers: withSession(current.token) })).status).toBe(200);
    // Keeping the session never extends its life: the absolute deadline is the one sign-in set.
    const after = (await h.store.sessions.findByDigest(sessionDigest(PEPPER, current.token)))!;
    expect(after.absoluteExpiresAt.toISOString()).toBe(before.absoluteExpiresAt.toISOString());
    expect(after.createdAt.toISOString()).toBe(before.createdAt.toISOString());
    expect((await h.app.request('/v1/me', { headers: withSession(other.token) })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: withDevice(device.token) })).status).toBe(401);

    const changed = await h.store.users.getById(p.id);
    expect(changed?.passwordChangedAt.toISOString()).toBe(h.clock.now.toISOString());
    expect((await signIn(h, p.email, p.password)).res.status).toBe(401);
    expect((await signIn(h, p.email, NEW_PASSWORD)).res.status).toBe(201);

    const events = (await h.store.audit.list(f.org.id, { entityType: 'user', action: 'user.password_changed' }, { limit: 10, cursor: null })).items;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: 'USER', actorId: p.id, entityId: p.id });
  });

  it('works from a device session too, keeping that device session live', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await deviceSignIn(h, p.email, p.password);
    const other = await deviceSignIn(h, p.email, p.password);
    minutes(h, 5);
    const res = await h.app.request('/v1/me/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...withDevice(token) },
      body: JSON.stringify({ currentPassword: p.password, newPassword: NEW_PASSWORD }),
    });
    expect(res.status).toBe(204);
    expect((await h.app.request('/v1/me', { headers: withDevice(token) })).status).toBe(200);
    expect((await h.app.request('/v1/me', { headers: withDevice(other.token) })).status).toBe(401);
    minutes(h, 5);
    expect((await h.app.request('/v1/me', { headers: withDevice(token) })).status).toBe(200);
    expect((await h.app.request('/v1/device-sessions', json({ email: p.email, password: p.password }))).status).toBe(401);
  });

  it('a session that signed in with the new password after the change is live too, and a later change still ends it', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const first = await signIn(h, p.email, p.password);
    minutes(h, 5);
    expect((await h.app.request('/v1/me/password', change(first.token, { currentPassword: p.password, newPassword: NEW_PASSWORD }))).status).toBe(204);
    minutes(h, 5);
    const second = await signIn(h, p.email, NEW_PASSWORD);
    expect((await h.app.request('/v1/me', { headers: withSession(second.token) })).status).toBe(200);
    minutes(h, 5);
    // The first session changes the password again: the second (which signed in after the first change) is signed out.
    expect((await h.app.request('/v1/me/password', change(first.token, { currentPassword: NEW_PASSWORD, newPassword: `${NEW_PASSWORD} again` }))).status).toBe(204);
    expect((await h.app.request('/v1/me', { headers: withSession(first.token) })).status).toBe(200);
    expect((await h.app.request('/v1/me', { headers: withSession(second.token) })).status).toBe(401);
  });

  it('refuses a wrong current password with 403 (not 401, which would sign the portal out), and counts toward the shared sign-in lockout (D1)', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);

    for (let i = 0; i < SIGN_IN_POLICY.maxFailures; i++) {
      const res = await h.app.request('/v1/me/password', change(token, { currentPassword: 'wrong', newPassword: NEW_PASSWORD }));
      expect(res.status).toBe(403);
      expect((await read(res)).error.code).toBe('CURRENT_PASSWORD_WRONG');
    }
    expect((await h.store.users.getById(p.id))?.lockedUntil).not.toBeNull();
    // The same account lockout a wrong sign-in would trip: locked out there too, not just on this route.
    expect((await signIn(h, p.email, p.password)).res.status).toBe(401);

    minutes(h, SIGN_IN_POLICY.lockMs / 60_000);
    const ok = await h.app.request('/v1/me/password', change(token, { currentPassword: p.password, newPassword: NEW_PASSWORD }));
    expect(ok.status).toBe(204);
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(200);
  });

  // MUT-238 review (red team): the phone sends concurrent requests on one token (resume revalidate, outbox retry, the
  // share extension). One that read its session just before this session's own change committed, and the person just
  // after, must not mistake the kept session for a stale one and revoke it.
  it('a request on the changing session that read it just before the change committed is not signed out by it', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await deviceSignIn(h, p.email, p.password);
    const other = await deviceSignIn(h, p.email, p.password);
    minutes(h, 5);
    const kept = (await h.store.sessions.findByDigest(sessionDigest(PEPPER, token)))!;
    const before = (await h.store.users.getById(p.id))!;
    const findByDigest = h.store.sessions.findByDigest;
    vi.spyOn(h.store.sessions, 'findByDigest').mockImplementationOnce(async (digest) => {
      const seen = await findByDigest(digest);
      // The change commits between this request's session read and its user read.
      await h.store.users.changePassword({
        userId: p.id,
        passwordHash: await realHasher.hash(NEW_PASSWORD),
        verifiedPasswordHash: before.passwordHash!,
        exceptSessionId: kept.id,
        at: h.clock.now,
        audit: [],
      });
      return seen;
    });

    expect((await h.app.request('/v1/me', { headers: withDevice(token) })).status).toBe(200);
    expect((await h.store.sessions.findByDigest(kept.tokenDigest))?.revokedAt).toBeNull();
    expect((await h.app.request('/v1/me', { headers: withDevice(token) })).status).toBe(200);
    // A session the change really did end stays ended.
    expect((await h.app.request('/v1/me', { headers: withDevice(other.token) })).status).toBe(401);
  });

  it('a session still stale after the change committed is signed out, even when it read itself before the change', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const changer = await signIn(h, p.email, p.password);
    const { token } = await deviceSignIn(h, p.email, p.password);
    minutes(h, 5);
    const findByDigest = h.store.sessions.findByDigest;
    vi.spyOn(h.store.sessions, 'findByDigest').mockImplementationOnce(async (digest) => {
      const seen = await findByDigest(digest);
      expect((await h.app.request('/v1/me/password', change(changer.token, { currentPassword: p.password, newPassword: NEW_PASSWORD }))).status).toBe(204);
      return seen;
    });
    expect((await h.app.request('/v1/me', { headers: withDevice(token) })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: withSession(changer.token) })).status).toBe(200);
  });

  // MUT-238 review (adversarial): the phone and the portal each verify the old password before either takes the lock.
  it('two changes racing from two sessions: the first wins, the second is refused with 403 and writes nothing', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const phone = await deviceSignIn(h, p.email, p.password);
    const portal = await signIn(h, p.email, p.password);
    minutes(h, 5);
    const PORTAL_PASSWORD = 'the portal chose this passphrase';
    const commit = h.store.users.changePassword;
    vi.spyOn(h.store.users, 'changePassword').mockImplementationOnce(async (input) => {
      // The portal's change commits while the phone's has verified the old password but not yet taken the lock.
      expect((await h.app.request('/v1/me/password', change(portal.token, { currentPassword: p.password, newPassword: PORTAL_PASSWORD }))).status).toBe(204);
      return commit(input);
    });

    const res = await h.app.request('/v1/me/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...withDevice(phone.token) },
      body: JSON.stringify({ currentPassword: p.password, newPassword: NEW_PASSWORD }),
    });
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('CURRENT_PASSWORD_WRONG');

    expect((await h.app.request('/v1/me', { headers: withSession(portal.token) })).status).toBe(200);
    expect((await h.app.request('/v1/me', { headers: withDevice(phone.token) })).status).toBe(401);
    expect((await signIn(h, p.email, NEW_PASSWORD)).res.status).toBe(401);
    expect((await signIn(h, p.email, PORTAL_PASSWORD)).res.status).toBe(201);
    // The phone knew the right password a moment ago: losing the race is not a failed attempt.
    expect((await h.store.users.getById(p.id))?.failedSignIns).toBe(0);
    const events = (await h.store.audit.list(f.org.id, { entityType: 'user', action: 'user.password_changed' }, { limit: 10, cursor: null })).items;
    expect(events).toHaveLength(1);
  });

  it('refuses a current password over 1024 characters with 422 before hashing anything, as sign-in does', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    h.hasher.verify.mockClear();
    const huge = await h.app.request('/v1/me/password', change(token, { currentPassword: 'x'.repeat(1025), newPassword: NEW_PASSWORD }));
    expect(huge.status).toBe(422);
    expect(h.hasher.verify).not.toHaveBeenCalled();
    // 1024 is still a password the route checks (and here, a wrong one).
    const longest = await h.app.request('/v1/me/password', change(token, { currentPassword: 'x'.repeat(1024), newPassword: NEW_PASSWORD }));
    expect(longest.status).toBe(403);
    expect(h.hasher.verify).toHaveBeenCalledTimes(1);
  });

  it('refuses a new password outside 12-128 characters with 422, and changes nothing', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    for (const bad of ['short', 'x'.repeat(129)]) {
      const res = await h.app.request('/v1/me/password', change(token, { currentPassword: p.password, newPassword: bad }));
      expect(res.status).toBe(422);
    }
    expect((await signIn(h, p.email, p.password)).res.status).toBe(201);
  });

  it('refuses a cross-site request, an API key, and no session', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const cross = await h.app.request('/v1/me/password', change(token, { currentPassword: p.password, newPassword: NEW_PASSWORD }, { origin: 'https://evil.example' }));
    expect(cross.status).toBe(403);
    expect((await read(cross)).error.code).toBe('CROSS_SITE_REQUEST');
    const byKey = await h.app.request('/v1/me/password', json({ currentPassword: p.password, newPassword: NEW_PASSWORD }, f.auth));
    expect(byKey.status).toBe(403);
    expect((await read(byKey)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
    const none = await h.app.request('/v1/me/password', json({ currentPassword: p.password, newPassword: NEW_PASSWORD }, SAME_ORIGIN));
    expect(none.status).toBe(401);
  });

  it('never logs the current or new password', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    await h.app.request('/v1/me/password', change(token, { currentPassword: p.password, newPassword: NEW_PASSWORD }));
    const text = h.logs.join('');
    expect(text).not.toContain(p.password);
    expect(text).not.toContain(NEW_PASSWORD);
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
    const session = (await h.store.sessions.findByDigest(sessionDigest(PEPPER, token)))!;
    const text = h.logs.join('');
    expect(text).not.toContain(token);
    expect(text).not.toContain(session.tokenDigest);
    expect(text).not.toContain(p.password);
  });
});

describe('Malafat suggestions on the account (MUT-191)', () => {
  const patch = (token: string, body: unknown, extra: Record<string, string> = SAME_ORIGIN) =>
    ({ method: 'PATCH', headers: { 'content-type': 'application/json', ...withSession(token, extra) }, body: JSON.stringify(body) });

  it('starts on, nothing dismissed, in /v1/me', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const me = await read(await h.app.request('/v1/me', { headers: withSession(token) }));
    expect(me.user.malafatSuggestions).toEqual({ off: false, dismissed: [] });
  });

  it('adds dismissals to what is stored, so two tabs never undo each other, and switches off without losing them', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const a = await signIn(h, p.email, p.password);
    const b = await signIn(h, p.email, p.password);
    let res = await h.app.request('/v1/me/malafat-suggestions', patch(a.token, { dismiss: ['client-threshold'] }));
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ off: false, dismissed: ['client-threshold'] });
    res = await h.app.request('/v1/me/malafat-suggestions', patch(b.token, { off: true, dismiss: ['second-business', 'business-profile'] }));
    expect(await read(res)).toEqual({ off: true, dismissed: ['business-profile', 'client-threshold', 'second-business'] });
    res = await h.app.request('/v1/me/malafat-suggestions', patch(a.token, { dismiss: ['client-threshold'] }));
    expect(await read(res)).toEqual({ off: true, dismissed: ['business-profile', 'client-threshold', 'second-business'] });
    const me = await read(await h.app.request('/v1/me', { headers: withSession(a.token) }));
    expect(me.user.malafatSuggestions).toEqual({ off: true, dismissed: ['business-profile', 'client-threshold', 'second-business'] });
  });

  it('works from the phone app too, and only ever for the caller', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const q = await person(h, f.org.id);
    const { token } = await deviceSignIn(h, p.email, p.password);
    const res = await h.app.request('/v1/me/malafat-suggestions', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...withDevice(token) },
      body: JSON.stringify({ off: true }),
    });
    expect(res.status).toBe(200);
    const other = await signIn(h, q.email, q.password);
    expect((await read(await h.app.request('/v1/me', { headers: withSession(other.token) }))).user.malafatSuggestions).toEqual({ off: false, dismissed: [] });
  });

  it.each([
    [{}],
    [{ dismiss: ['settings'] }],
    [{ dismiss: [] }],
    [{ off: 'yes' }],
    [{ off: true, extra: 1 }],
  ])('refuses %j with 422', async (body) => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const res = await h.app.request('/v1/me/malafat-suggestions', patch(token, body));
    expect(res.status).toBe(422);
  });

  it('refuses a cross-site write, an API key and no session', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const cross = await h.app.request('/v1/me/malafat-suggestions', patch(token, { off: true }, { origin: 'https://evil.example' }));
    expect(cross.status).toBe(403);
    expect((await read(cross)).error.code).toBe('CROSS_SITE_REQUEST');
    const byKey = await h.app.request('/v1/me/malafat-suggestions', json({ off: true }, f.auth, 'PATCH'));
    expect(byKey.status).toBe(403);
    expect((await read(byKey)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
    const none = await h.app.request('/v1/me/malafat-suggestions', json({ off: true }, SAME_ORIGIN, 'PATCH'));
    expect(none.status).toBe(401);
  });

  it('writes no audit row: a preference is not an event a firm sees', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { token } = await signIn(h, p.email, p.password);
    const everyRow = () => (h.store as unknown as { events: unknown[] }).events.length;
    const before = everyRow();
    const res = await h.app.request('/v1/me/malafat-suggestions', patch(token, { dismiss: ['client-threshold'] }));
    expect(res.status).toBe(200);
    // Every organization's log, the person's own included, and rows with no organization
    expect(everyRow()).toBe(before);
  });
});

