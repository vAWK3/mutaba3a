import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { FEATURES, hasFeature, isFeature } from '../features.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { ForeignKeyViolation, MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-433: per-user feature flags, operator-controlled (ADR-196). Every flag is off until the operator grants it
 * (PUT /admin/v1/users/{userId}/features/{feature}); a revoke (DELETE) is seen on the very next read, because
 * `hasFeature` reads the store on every call. Each change is audited on every profile the person belongs to
 * (eng review D4); a signup still waiting for review can't be granted one (D5).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-10-25T09:00:00Z');

function harness() {
  const store = new MemoryLedgerStore();
  const clock = { now: NOW };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, clock };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

async function person(h: Harness, firmId?: string) {
  const email = `pilot${++seq}@studio.ps`;
  const body = firmId ? { email, displayName: 'Rana Saleh', organizationId: firmId, locale: 'en' } : { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' };
  const created = await provisionUser(h.app, body);
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const cookie = { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  return { cookie, email, userId: created.user.id as string, personalId: created.personalProfile.id as string };
}

const grant = (h: Harness, userId: string, feature = 'agent_access', headers: Record<string, string> = admin) =>
  h.app.request(`/admin/v1/users/${userId}/features/${feature}`, { method: 'PUT', headers });
const revoke = (h: Harness, userId: string, feature = 'agent_access') => h.app.request(`/admin/v1/users/${userId}/features/${feature}`, { method: 'DELETE', headers: admin });
const meFeatures = async (h: Harness, cookie: Record<string, string>) => (await read(await h.app.request('/v1/me', { headers: cookie }))).user.features;
const featureAudit = async (h: Harness, organizationId: string) =>
  (await read(await h.app.request(`/admin/v1/organizations/${organizationId}/audit`, { headers: admin }))).events.filter((e: { action: string }) => e.action.startsWith('user.feature_'));

describe('the feature list (D2)', () => {
  it('names agent_access and nothing else; anything else is not a feature', () => {
    expect(FEATURES).toEqual(['agent_access']);
    expect(isFeature('agent_access')).toBe(true);
    expect(isFeature('AGENT_ACCESS')).toBe(false);
    expect(isFeature('')).toBe(false);
  });
});

describe('every flag is off until granted (AC1)', () => {
  it('a new person has no features on /v1/me, and hasFeature says no', async () => {
    const h = harness();
    const p = await person(h);
    expect(await meFeatures(h, p.cookie)).toEqual([]);
    expect(await hasFeature(h.store, p.userId, 'agent_access')).toBe(false);
  });
});

describe('PUT /admin/v1/users/{userId}/features/{feature} (AC2)', () => {
  it('grants once: shown on /v1/me, audited once; granting again changes nothing', async () => {
    const h = harness();
    const p = await person(h);

    const res = await grant(h, p.userId);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ feature: 'agent_access', grantedAt: NOW.toISOString(), granted: true });
    expect(await meFeatures(h, p.cookie)).toEqual(['agent_access']);
    expect(await hasFeature(h.store, p.userId, 'agent_access')).toBe(true);

    h.clock.now = new Date(NOW.getTime() + 60_000);
    const again = await grant(h, p.userId);
    expect(again.status).toBe(200);
    expect(await read(again)).toEqual({ feature: 'agent_access', grantedAt: NOW.toISOString(), granted: false });

    const events = await featureAudit(h, p.personalId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'user.feature_granted', actorType: 'ADMIN', entityType: 'user', entityId: p.userId, metadata: { feature: 'agent_access' } });
  });

  it('audits on every profile the person belongs to, a firm they only belong to included (D4)', async () => {
    const h = harness();
    const firm = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Haddad Law', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
    const p = await person(h, firm.id);
    await grant(h, p.userId);
    expect(await featureAudit(h, firm.id)).toHaveLength(1);
    expect(await featureAudit(h, p.personalId)).toHaveLength(1);
  });

  it('refuses a signup still waiting for review, and stores nothing (D5)', async () => {
    const h = harness();
    const p = await person(h);
    await h.store.users.setStatus(p.userId, 'PENDING_REVIEW', NOW);
    const res = await grant(h, p.userId);
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'USER_PENDING_REVIEW' } });
    expect(await hasFeature(h.store, p.userId, 'agent_access')).toBe(false);
  });

  it('allows a disabled account, both ways: the flag waits until they can sign in (D5)', async () => {
    const h = harness();
    const p = await person(h);
    expect((await h.app.request(`/admin/v1/users/${p.userId}/disable`, { method: 'POST', headers: admin })).status).toBe(200);
    expect((await h.store.users.getById(p.userId))?.status).toBe('DISABLED');
    expect((await grant(h, p.userId)).status).toBe(200);
    expect(await hasFeature(h.store, p.userId, 'agent_access')).toBe(true);
    expect((await revoke(h, p.userId)).status).toBe(200);
    expect(await hasFeature(h.store, p.userId, 'agent_access')).toBe(false);
  });

  it('answers 422 for an unknown feature, 404 for an unknown person, 401 without the admin token', async () => {
    const h = harness();
    const p = await person(h);
    const unknown = await grant(h, p.userId, 'time_travel');
    expect(unknown.status).toBe(422);
    expect((await read(unknown)).error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'feature' } });
    expect((await grant(h, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await grant(h, p.userId, 'agent_access', {})).status).toBe(401);
    expect(await hasFeature(h.store, p.userId, 'agent_access')).toBe(false);
  });
});

describe('a person deleted while the operator grants or revokes (review D1)', () => {
  it('answers 404, not 500, when the store refuses the write because the person just went', async () => {
    const h = harness();
    const p = await person(h);
    // The account is deleted (a signup decline, the hourly purge) between the route's lookup and the write.
    const gone = async () => {
      throw new ForeignKeyViolation('user_feature_grants_userId_fkey');
    };
    Object.assign(h.store.features, { grant: gone, revoke: gone });
    expect((await grant(h, p.userId)).status).toBe(404);
    expect((await revoke(h, p.userId)).status).toBe(404);
  });
});

describe('integration keys (review D3)', () => {
  it("an API key's /v1/audit never lists feature grants; the operator's audit does", async () => {
    const h = harness();
    const firm = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Haddad Law', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
    const apiKey = await read(await h.app.request(`/admin/v1/organizations/${firm.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
    const key = { authorization: `Bearer ${apiKey.secret}` };
    const p = await person(h, firm.id);
    await grant(h, p.userId);
    await revoke(h, p.userId);

    expect((await featureAudit(h, firm.id)).map((e: { action: string }) => e.action).sort()).toEqual(['user.feature_granted', 'user.feature_revoked']);
    const listed = await read(await h.app.request('/v1/audit?limit=200', { headers: key }));
    expect(listed.items.length).toBeGreaterThan(0);
    expect(listed.items.filter((e: { action: string }) => e.action.startsWith('user.feature_'))).toEqual([]);
    expect(await read(await h.app.request('/v1/audit?action=user.feature_granted', { headers: key }))).toMatchObject({ items: [] });
  });
});

describe('DELETE /admin/v1/users/{userId}/features/{feature} (AC2, AC3 seam)', () => {
  it('revokes: gone on the very next read, audited once; revoking again changes nothing', async () => {
    const h = harness();
    const p = await person(h);
    await grant(h, p.userId);

    const res = await revoke(h, p.userId);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ feature: 'agent_access', revoked: true });
    expect(await hasFeature(h.store, p.userId, 'agent_access')).toBe(false);
    expect(await meFeatures(h, p.cookie)).toEqual([]);

    expect(await read(await revoke(h, p.userId))).toEqual({ feature: 'agent_access', revoked: false });
    expect((await featureAudit(h, p.personalId)).map((e: { action: string }) => e.action).sort()).toEqual(['user.feature_granted', 'user.feature_revoked']);
    // MUT-434 R1: with no agent connected, the revoke writes no agent rows (and its answer above is unchanged).
    const all = (await read(await h.app.request(`/admin/v1/organizations/${p.personalId}/audit`, { headers: admin }))).events;
    expect(all.filter((e: { action: string }) => e.action.startsWith('user.agent_'))).toEqual([]);
  });

  it('a grant after a revoke opens it again, from the new instant', async () => {
    const h = harness();
    const p = await person(h);
    await grant(h, p.userId);
    await revoke(h, p.userId);
    const later = new Date(NOW.getTime() + 3_600_000);
    h.clock.now = later;
    expect(await read(await grant(h, p.userId))).toEqual({ feature: 'agent_access', grantedAt: later.toISOString(), granted: true });
    expect(await meFeatures(h, p.cookie)).toEqual(['agent_access']);
  });

  it('answers 422 for an unknown feature and 404 for an unknown person', async () => {
    const h = harness();
    const p = await person(h);
    expect((await revoke(h, p.userId, 'time_travel')).status).toBe(422);
    expect((await revoke(h, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('GET /admin/v1/features/{feature}', () => {
  it('lists the people who hold it now, oldest grant first; revoked ones drop off', async () => {
    const h = harness();
    const a = await person(h);
    const b = await person(h);
    const c = await person(h);
    await grant(h, a.userId);
    h.clock.now = new Date(NOW.getTime() + 60_000);
    await grant(h, b.userId);
    await grant(h, c.userId);
    await revoke(h, c.userId);

    const res = await h.app.request('/admin/v1/features/agent_access', { headers: admin });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({
      feature: 'agent_access',
      holders: [
        { userId: a.userId, email: a.email, grantedAt: NOW.toISOString() },
        { userId: b.userId, email: b.email, grantedAt: new Date(NOW.getTime() + 60_000).toISOString() },
      ],
    });
    expect((await h.app.request('/admin/v1/features/time_travel', { headers: admin })).status).toBe(422);
  });
});

describe('the local mode format (C5)', () => {
  it('a grant never reaches the memory snapshot, so the shipped local format is unchanged', async () => {
    const h = harness();
    const p = await person(h);
    const before = Object.keys(h.store.snapshot()).sort();
    await grant(h, p.userId);
    expect(Object.keys(h.store.snapshot()).sort()).toEqual(before);
    expect(JSON.stringify(h.store.snapshot())).not.toContain('agent_access');
  });
});
