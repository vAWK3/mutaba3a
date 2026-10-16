import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { generateDeviceSessionToken, sessionDigest, SIGN_IN_POLICY } from '../auth/sessions.js';
import { ARGON2_MINIMUMS, createArgon2Hasher, type PasswordHasher } from '../auth/users.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { setupTokenOf } from './helpers/provision.js';

/**
 * POST /v1/account-setup/check and POST /v1/account-setup (MUT-235, ADR-088):
 * the two public routes a setup link reaches. The token travels in the body;
 * the answer to a bad link says why, never anything about the account.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const SAME_ORIGIN = { origin: 'http://localhost' };
const NEW_PASSWORD = 'a-long-enough-passphrase';
const realHasher = createArgon2Hasher(ARGON2_MINIMUMS);

const PEPPER = 'session-pepper-with-at-least-32-chars!!';

function harness(opts: { portalOrigin?: string } = {}) {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-20T09:00:00Z') };
  const hasher: PasswordHasher & { verify: ReturnType<typeof vi.fn> } = {
    hash: (p) => realHasher.hash(p),
    verify: vi.fn((h: string, p: string) => realHasher.verify(h, p)),
  };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    passwordHasher: hasher,
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180, ...opts },
  });
  return { app, store, clock, hasher };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const hours = (h: Harness, n: number) => {
  h.clock.now = new Date(h.clock.now.getTime() + n * 3_600_000);
};

async function provision(h: Harness, extra: Record<string, unknown> = {}) {
  const email = `partner${++seq}@firm.ps`;
  const res = await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'ar', ...extra }, admin));
  expect(res.status).toBe(201);
  const created = await read(res);
  return { id: created.user.id as string, email, token: setupTokenOf(created.setupLink.url) };
}

const check = (h: Harness, token: string, headers: Record<string, string> = SAME_ORIGIN) => h.app.request('/v1/account-setup/check', json({ token }, headers));
const redeem = (h: Harness, token: string, password = NEW_PASSWORD, headers: Record<string, string> = SAME_ORIGIN) =>
  h.app.request('/v1/account-setup', json({ token, password }, headers));
const signIn = (h: Harness, email: string, password: string) => h.app.request('/v1/sessions', json({ email, password }, SAME_ORIGIN));
const deviceSignIn = (h: Harness, email: string, password: string) => h.app.request('/v1/device-sessions', json({ email, password }));
const resetLink = async (h: Harness, userId: string, body: Record<string, unknown> = {}) =>
  setupTokenOf((await read(await h.app.request(`/admin/v1/users/${userId}/setup-link`, json(body, admin)))).setupLink.url);

describe('POST /v1/account-setup/check (MUT-235)', () => {
  it('a valid link names the email, locale, purpose and expiry, and nothing else', async () => {
    const h = harness();
    const p = await provision(h);
    const res = await check(h, p.token);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ state: 'valid', email: p.email, locale: 'ar', purpose: 'SETUP', expiresAt: '2026-10-23T09:00:00.000Z' });
  });

  it('says expired, used, superseded or invalid — and only that', async () => {
    const h = harness();
    const used = await provision(h);
    expect((await redeem(h, used.token)).status).toBe(200);
    const superseded = await provision(h);
    await resetLink(h, superseded.id);
    const unknown = 'A'.repeat(43);
    const expired = await provision(h);
    hours(h, 72);
    for (const [token, state] of [
      [used.token, 'used'],
      [superseded.token, 'superseded'],
      [unknown, 'invalid'],
      [expired.token, 'expired'],
    ] as const) {
      const res = await check(h, token);
      expect(res.status).toBe(200);
      expect(await read(res)).toEqual({ state });
    }
  });

  it('a disabled person’s link reads as invalid', async () => {
    const h = harness();
    const p = await provision(h);
    await h.app.request(`/admin/v1/users/${p.id}/disable`, json({}, admin));
    expect(await read(await check(h, p.token))).toEqual({ state: 'invalid' });
  });

  it('refuses a malformed token as a validation error', async () => {
    const h = harness();
    expect((await check(h, 'short')).status).toBe(422);
  });
});

describe('POST /v1/account-setup (MUT-235)', () => {
  it('sets the password; the person then signs in on the portal and the app with it', async () => {
    const h = harness();
    const p = await provision(h);
    const res = await redeem(h, p.token);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ email: p.email });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await signIn(h, p.email, NEW_PASSWORD)).status).toBe(201);
    expect((await deviceSignIn(h, p.email, NEW_PASSWORD)).status).toBe(201);
  });

  it('refuses a used, expired, superseded or unknown link with 410 and why', async () => {
    const h = harness();
    const used = await provision(h);
    await redeem(h, used.token);
    const superseded = await provision(h);
    await resetLink(h, superseded.id);
    const expired = await provision(h);
    hours(h, 72);
    for (const [token, state] of [
      [used.token, 'used'],
      [superseded.token, 'superseded'],
      ['B'.repeat(43), 'invalid'],
      [expired.token, 'expired'],
    ] as const) {
      const res = await redeem(h, token);
      expect(res.status).toBe(410);
      const body = await read(res);
      expect(body.error.code).toBe('SETUP_LINK_UNUSABLE');
      expect(body.error.details).toEqual({ state });
    }
  });

  it('a password outside 12–128 characters is refused and the link stays usable', async () => {
    const h = harness();
    const p = await provision(h);
    expect((await redeem(h, p.token, 'a'.repeat(11))).status).toBe(422);
    expect((await redeem(h, p.token, 'a'.repeat(129))).status).toBe(422);
    expect(await read(await check(h, p.token))).toMatchObject({ state: 'valid' });
    expect((await redeem(h, p.token)).status).toBe(200);
  });

  it('signs out every web and device session the person had (AC 5)', async () => {
    const h = harness();
    const p = await provision(h);
    await redeem(h, p.token, 'the-first-password-set');
    const cookie = (await signIn(h, p.email, 'the-first-password-set')).headers.get('set-cookie')!.split(';')[0]!;
    const device = (await read(await deviceSignIn(h, p.email, 'the-first-password-set'))).token as string;
    expect((await h.app.request('/v1/me', { headers: { cookie } })).status).toBe(200);
    await redeem(h, await resetLink(h, p.id));
    expect((await h.app.request('/v1/me', { headers: { cookie } })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: { authorization: `Bearer ${device}` } })).status).toBe(401);
  });

  it('is refused cross-site, like sign-in', async () => {
    const h = harness();
    const p = await provision(h);
    for (const headers of [{}, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
      const res = await redeem(h, p.token, NEW_PASSWORD, headers);
      expect(res.status).toBe(403);
      expect((await read(res)).error.code).toBe('CROSS_SITE_REQUEST');
      expect((await check(h, p.token, headers)).status).toBe(403);
    }
  });

  it('of two concurrent redeems, one sets the password and the other is told the link was used', async () => {
    const h = harness();
    const p = await provision(h);
    const [a, b] = await Promise.all([redeem(h, p.token, 'first-password-wins'), redeem(h, p.token, 'second-password-x')]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
    const loser = a.status === 410 ? a : b;
    expect((await read(loser)).error.details).toEqual({ state: 'used' });
    const winner = a.status === 200 ? 'first-password-wins' : 'second-password-x';
    expect((await signIn(h, p.email, winner)).status).toBe(201);
  });

  it('audits user.password_set as the person, naming the link that set it', async () => {
    const h = harness();
    const p = await provision(h);
    await redeem(h, p.token);
    const [membership] = await h.store.memberships.listByUser(p.id);
    const events = (await h.store.audit.list(membership!.organizationId, { action: 'user.password_set' }, { limit: 10, cursor: null })).items;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: 'USER', actorId: p.id, metadata: { purpose: 'SETUP', linkId: expect.any(String) } });
  });

  it('the redeem route spends the same per-address budget as check', async () => {
    const h = harness();
    const ip = { ...SAME_ORIGIN, 'x-forwarded-for': '203.0.113.10' };
    for (let i = 0; i < SIGN_IN_POLICY.ipPerMinute; i++) await redeem(h, 'D'.repeat(43), NEW_PASSWORD, ip);
    const limited = await redeem(h, 'D'.repeat(43), NEW_PASSWORD, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
  });

  it('limits attempts per address, on a budget separate from sign-in', async () => {
    const h = harness();
    const ip = { ...SAME_ORIGIN, 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < SIGN_IN_POLICY.ipPerMinute; i++) expect((await check(h, 'C'.repeat(43), ip)).status).toBe(200);
    const limited = await check(h, 'C'.repeat(43), ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
    const signInSameIp = await h.app.request('/v1/sessions', json({ email: 'x@y.ps', password: 'whatever' }, ip));
    expect(signInSameIp.status).toBe(401);
  });
});

describe('an account whose link was never used (AC 2)', () => {
  it('is refused exactly like a wrong password, after one argon2 verify, on both sign-ins', async () => {
    const h = harness();
    const pending = await provision(h);
    const real = await provision(h);
    await redeem(h, real.token);
    for (const attempt of [signIn, deviceSignIn]) {
      h.hasher.verify.mockClear();
      const pendingRes = await attempt(h, pending.email, NEW_PASSWORD);
      expect(h.hasher.verify).toHaveBeenCalledTimes(1);
      h.hasher.verify.mockClear();
      const wrongRes = await attempt(h, real.email, 'not-the-password-at-all');
      expect(h.hasher.verify).toHaveBeenCalledTimes(1);
      expect(pendingRes.status).toBe(401);
      expect(wrongRes.status).toBe(401);
      const [a, b] = [await read(pendingRes), await read(wrongRes)];
      expect({ code: a.error.code, message: a.error.message }).toEqual({ code: b.error.code, message: b.error.message });
    }
  });
});

describe('review fixes (qa-reconcile, 2026-10-16)', () => {
  it('a link issued before a disable stays dead after re-enabling the person', async () => {
    const h = harness();
    const p = await provision(h);
    await h.app.request(`/admin/v1/users/${p.id}/disable`, json({}, admin));
    await h.app.request(`/admin/v1/users/${p.id}/enable`, json({}, admin));
    const res = await redeem(h, p.token);
    expect(res.status).toBe(410);
    expect((await read(res)).error.details).toEqual({ state: 'superseded' });
  });

  it('setting a password lifts a sign-in lockout, so the sign-in straight after works', async () => {
    const h = harness();
    const p = await provision(h);
    for (let i = 0; i < SIGN_IN_POLICY.maxFailures; i++) await signIn(h, p.email, 'somebody-guessing-wrong');
    expect((await redeem(h, p.token)).status).toBe(200);
    expect((await signIn(h, p.email, NEW_PASSWORD)).status).toBe(201);
  });

  it('a sign-in that started before a --lock cannot keep the session it creates after it', async () => {
    const h = harness();
    const p = await provision(h);
    await redeem(h, p.token);
    hours(h, 1);
    const lockedAt = h.clock.now;
    expect((await h.app.request(`/admin/v1/users/${p.id}/setup-link`, json({ lock: true }, admin))).status).toBe(200);
    // The racing sign-in verified the old password a minute earlier and inserts its session only now.
    const token = generateDeviceSessionToken();
    await h.store.sessions.create({
      userId: p.id,
      tokenDigest: sessionDigest(PEPPER, token),
      kind: 'device',
      at: new Date(lockedAt.getTime() - 60_000),
      idleExpiresAt: new Date(lockedAt.getTime() + 86_400_000),
      absoluteExpiresAt: new Date(lockedAt.getTime() + 86_400_000),
      userAgent: null,
    });
    expect((await h.app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it('a sign-in whose password check overlaps a --lock is refused, not handed a session', async () => {
    const h = harness();
    const p = await provision(h);
    await redeem(h, p.token);
    // The operator's lock commits while this sign-in is still verifying the (correct, stolen) old password.
    h.hasher.verify.mockImplementationOnce(async (stored: string, given: string) => {
      const ok = await realHasher.verify(stored, given);
      await h.app.request(`/admin/v1/users/${p.id}/setup-link`, json({ lock: true }, admin));
      return ok;
    });
    const res = await deviceSignIn(h, p.email, NEW_PASSWORD);
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('a link is https even when the request reached the server as plain http (TLS ends at the proxy)', async () => {
    const h = harness();
    const res = await h.app.request('http://mutaba3a-api.run.app/admin/v1/users', json({ email: `p${++seq}@firm.ps`, displayName: 'P', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin));
    expect((await read(res)).setupLink.url).toMatch(/^https:\/\/mutaba3a-api\.run\.app\/setup#[A-Za-z0-9_-]{43}$/);
  });

  it('a configured PORTAL_ORIGIN is where links point, and the only origin that may redeem them', async () => {
    const h = harness({ portalOrigin: 'https://portal.example' });
    const created = await read(await h.app.request('/admin/v1/users', json({ email: `p${++seq}@firm.ps`, displayName: 'P', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
    expect(created.setupLink.url).toMatch(/^https:\/\/portal\.example\/setup#[A-Za-z0-9_-]{43}$/);
    const token = setupTokenOf(created.setupLink.url);
    expect((await redeem(h, token, NEW_PASSWORD, { origin: 'http://localhost' })).status).toBe(403);
    expect((await redeem(h, token, NEW_PASSWORD, { origin: 'https://portal.example' })).status).toBe(200);
  });
});
