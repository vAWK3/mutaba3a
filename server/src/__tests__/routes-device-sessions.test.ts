import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SIGN_IN_POLICY } from '../auth/sessions.js';
import { ARGON2_MINIMUMS, createArgon2Hasher, type PasswordHasher } from '../auth/users.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * POST/DELETE /v1/device-sessions (MUT-64): the native app's bearer-token
 * sign-in, the mirror of POST /v1/sessions minus the cookie and the CSRF gate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const realHasher = createArgon2Hasher(ARGON2_MINIMUMS);

function harness(opts: { limit?: number } = {}) {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-20T09:00:00Z') };
  const hasher: PasswordHasher & { verify: ReturnType<typeof vi.fn> } = {
    hash: (p) => realHasher.hash(p),
    verify: vi.fn((h: string, p: string) => realHasher.verify(h, p)),
  };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(opts.limit ?? 100_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    passwordHasher: hasher,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180 },
  });
  return { app, store, clock, hasher };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const minutes = (h: Harness, n: number) => {
  h.clock.now = new Date(h.clock.now.getTime() + n * 60_000);
};

async function firm(h: Harness) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  return { org: org as { id: string; name: string } };
}

async function person(h: Harness, organizationId: string, email = `partner${++seq}@firm.ps`) {
  const created = await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId }, admin)));
  return { id: created.user.id as string, email, password: created.initialPassword as string, personalId: created.personalProfile.id as string };
}

async function deviceSignIn(h: Harness, email: string, password: string, headers: Record<string, string> = {}) {
  const res = await h.app.request('/v1/device-sessions', json({ email, password }, headers));
  return { res, body: await read(res) };
}

describe('POST /v1/device-sessions — device sign-in', () => {
  it('returns a token (no cookie), the Me payload, and records the sign-in', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { res, body } = await deviceSignIn(h, `  ${p.email.toUpperCase()} `, p.password);
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(body.token).toMatch(/^mds_[A-Za-z0-9_-]{43}$/);
    expect(body.user).toMatchObject({ id: p.id, email: p.email });
    expect(body.profiles.map((x: Loose) => x.id).sort()).toEqual([p.personalId, f.org.id].sort());

    const user = await h.store.users.getById(p.id);
    expect(user?.lastSignInAt?.toISOString()).toBe(h.clock.now.toISOString());
    const events = (await h.store.audit.list(f.org.id, { entityType: 'user', action: 'user.signed_in' }, { limit: 10, cursor: null })).items;
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ sessionKind: 'device' });
  });

  it('succeeds with no Origin header at all — the CSRF gate does not apply here', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { res } = await deviceSignIn(h, p.email, p.password);
    expect(res.status).toBe(201);
  });

  it('answers unknown email and wrong password identically, verifying exactly once each', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const outcomes: Loose[] = [];
    for (const [email, password] of [
      ['nobody@firm.ps', 'whatever-password'],
      [p.email, 'wrong-password'],
    ] as const) {
      h.hasher.verify.mockClear();
      const { res, body } = await deviceSignIn(h, email, password);
      expect(h.hasher.verify).toHaveBeenCalledTimes(1);
      outcomes.push({ status: res.status, code: body.error.code });
    }
    expect(outcomes[0]).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  it('locks an account after five failures, matching the portal lockout window', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    for (let i = 0; i < SIGN_IN_POLICY.maxFailures; i++) expect((await deviceSignIn(h, p.email, 'wrong')).res.status).toBe(401);
    const blocked = await deviceSignIn(h, p.email, p.password);
    expect(blocked.res.status).toBe(401);
    expect(blocked.body.error.code).toBe('INVALID_CREDENTIALS');

    minutes(h, SIGN_IN_POLICY.lockMs / 60_000);
    const allowed = await deviceSignIn(h, p.email, p.password);
    expect(allowed.res.status).toBe(201);
  });

  it('rate-limits sign-in attempts per client IP', async () => {
    const h = harness();
    const from = (ip: string) => ({ 'x-forwarded-for': ip });
    for (let i = 0; i < SIGN_IN_POLICY.ipPerMinute; i++) await deviceSignIn(h, `n${i}@firm.ps`, 'x', from('198.51.100.7'));
    const limited = await deviceSignIn(h, 'n-last@firm.ps', 'x', from('198.51.100.7'));
    expect(limited.res.status).toBe(429);
    expect(limited.res.headers.get('retry-after')).toBeTruthy();
  });

  it('validation: missing email/password is 422', async () => {
    const h = harness();
    const res = await h.app.request('/v1/device-sessions', json({}));
    expect(res.status).toBe(422);
  });
});

describe('DELETE /v1/device-sessions/current — device sign-out', () => {
  it('revokes the token server-side; reuse afterward is refused', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await person(h, f.org.id);
    const { body } = await deviceSignIn(h, p.email, p.password);
    const token = body.token as string;

    const out = await h.app.request('/v1/device-sessions/current', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(out.status).toBe(204);

    const again = await h.app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } });
    expect(again.status).toBe(401);
    expect((await read(again)).error.code).toBe('SESSION_EXPIRED');
  });

  it('with no credential at all is UNAUTHENTICATED', async () => {
    const h = harness();
    const res = await h.app.request('/v1/device-sessions/current', { method: 'DELETE' });
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('UNAUTHENTICATED');
  });

  it('with an API key instead of a device session is PRINCIPAL_NOT_ACCEPTED', async () => {
    const h = harness();
    const f = await firm(h);
    const key = await read(await h.app.request(`/admin/v1/organizations/${f.org.id}/api-keys`, json({ name: 'k', scopes: ['integration:read'] }, admin)));
    const res = await h.app.request('/v1/device-sessions/current', { method: 'DELETE', headers: { authorization: `Bearer ${key.secret}` } });
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });
});
