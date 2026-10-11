import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../app.js';
import { parseApiKey } from '../api-key.js';
import { generateDeviceSessionToken, isDeviceSessionToken, sessionDigest } from '../sessions.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';

/**
 * Device-session bearer dispatch (MUT-64): authenticate() routes a bearer
 * token to the API-key or device-session verifier by prefix, and once
 * verified, a device session is the exact same 'session' Principal a cookie
 * gets — these assertions exercise that against real routes (GET /v1/me,
 * already session-accepting today) rather than calling authenticate()
 * out of context. The device session row is inserted directly into the store
 * here, ahead of the sign-in route landing in a later commit, so these
 * assertions aren't gated on it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const PEPPER = 'device-session-test-pepper-32-chars!';
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

function harness(now = new Date('2026-10-12T09:00:00Z')) {
  const store = new MemoryLedgerStore();
  const clock = { now };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: 'test',
    now: () => clock.now,
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180 },
  });
  return { app, store, clock };
}

async function userAndOrg(h: ReturnType<typeof harness>) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const created = await read(await h.app.request('/admin/v1/users', json({ email: 'nour@firm.ps', displayName: 'Nour', organizationId: org.id }, admin)));
  return { orgId: org.id as string, userId: created.user.id as string };
}

/** Inserts a device-kind session row directly, matching what the sign-in route (POST /v1/device-sessions) will do once built. */
async function deviceSession(h: ReturnType<typeof harness>, userId: string, overrides: Partial<{ idleExpiresAt: Date; absoluteExpiresAt: Date; revokedAt: Date }> = {}) {
  const token = generateDeviceSessionToken();
  const session = await h.store.sessions.create({
    userId,
    tokenDigest: sessionDigest(PEPPER, token),
    kind: 'device',
    at: h.clock.now,
    idleExpiresAt: overrides.idleExpiresAt ?? new Date(h.clock.now.getTime() + 30 * 86_400_000),
    absoluteExpiresAt: overrides.absoluteExpiresAt ?? new Date(h.clock.now.getTime() + 180 * 86_400_000),
    userAgent: null,
  });
  if (overrides.revokedAt) await h.store.sessions.revoke(session.id, 'signed_out', overrides.revokedAt);
  return token;
}

describe('device-session bearer dispatch (MUT-64)', () => {
  it('a device bearer reaches a session-accepting route (GET /v1/me) with full session access', async () => {
    const h = harness();
    const { orgId, userId } = await userAndOrg(h);
    const token = await deviceSession(h, userId);
    const res = await h.app.request('/v1/me', { headers: { authorization: `Bearer ${token}`, 'x-mutaba3a-profile': orgId } });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.user.id).toBe(userId);
  });

  it('a device bearer is refused on an API-key-only route', async () => {
    const h = harness();
    const { userId } = await userAndOrg(h);
    const token = await deviceSession(h, userId);
    const res = await h.app.request('/v1/audit', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });

  it('an unknown mds_ token (right shape, no matching digest) is SESSION_EXPIRED', async () => {
    const h = harness();
    const res = await h.app.request('/v1/me', { headers: { authorization: `Bearer ${generateDeviceSessionToken()}` } });
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('SESSION_EXPIRED');
  });

  it('an expired device session is SESSION_EXPIRED', async () => {
    const h = harness();
    const { userId } = await userAndOrg(h);
    const token = await deviceSession(h, userId, { idleExpiresAt: new Date(h.clock.now.getTime() - 1000) });
    const res = await h.app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('SESSION_EXPIRED');
  });

  it('a revoked device session is SESSION_EXPIRED', async () => {
    const h = harness();
    const { userId } = await userAndOrg(h);
    const token = await deviceSession(h, userId, { revokedAt: h.clock.now });
    const res = await h.app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('SESSION_EXPIRED');
  });

  it('a device bearer and a cookie together are refused as ambiguous', async () => {
    const h = harness();
    const { userId } = await userAndOrg(h);
    const deviceToken = await deviceSession(h, userId);
    const res = await h.app.request('/v1/me', { headers: { authorization: `Bearer ${deviceToken}`, cookie: '__Host-mut_session=something' } });
    expect(res.status).toBe(401);
    const body = await read(res);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.details).toMatchObject({ reason: 'ambiguous_credentials' });
  });

  it('a device-session token is never parsed as an API key, and vice versa', () => {
    const deviceToken = generateDeviceSessionToken();
    expect(parseApiKey(deviceToken)).toBeNull();
    const fakeApiKey = `mut_test_${'a'.repeat(8)}_${'b'.repeat(43)}`;
    expect(isDeviceSessionToken(fakeApiKey)).toBe(false);
  });

  it('missing X-Mutaba3a-Profile on an org-scoped route with a device bearer is VALIDATION_FAILED', async () => {
    const h = harness();
    const { userId } = await userAndOrg(h);
    const token = await deviceSession(h, userId);
    const res = await h.app.request('/v1/summaries/organization', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'PROFILE_REQUIRED' });
  });

  it('X-Mutaba3a-Profile naming a non-member organization with a device bearer is NOT_FOUND', async () => {
    const h = harness();
    const { userId } = await userAndOrg(h);
    const token = await deviceSession(h, userId);
    const other = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Other', defaultCurrency: 'ILS', timezone: 'UTC' }, admin)));
    const res = await h.app.request('/v1/summaries/organization', { headers: { authorization: `Bearer ${token}`, 'x-mutaba3a-profile': other.id } });
    expect(res.status).toBe(404);
  });
});
