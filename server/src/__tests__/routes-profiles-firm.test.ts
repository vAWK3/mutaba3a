import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-300: the owner of a Business profile asks for firm features with
 * POST /v1/profiles/{profileId}/firm-request, and GET /v1/me reports, per
 * profile, whether firm features are on (`firm`), the caller's role while they
 * are (`role`), and the owner's pending request (`firmRequestedAt`). An
 * operator enables in place (eng review D4): the profile stays owned.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-10-20T09:00:00Z');

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
const idem = () => ({ 'idempotency-key': `key-${++seq}-${Math.random().toString(36).slice(2, 8)}` });

async function operatorFirm(h: Harness) {
  return (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
}

async function person(h: Harness, firmId?: string) {
  const email = `owner${++seq}@studio.ps`;
  const body = firmId ? { email, displayName: 'Rana Saleh', organizationId: firmId, locale: 'en' } : { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' };
  const created = await provisionUser(h.app, body);
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const me = (extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN, ...extra });
  return { me, email, password: created.password as string, userId: created.user.id as string, personalId: created.personalProfile.id as string };
}

async function setup() {
  const h = harness();
  const u = await person(h);
  const business = await read(await h.app.request('/v1/profiles', json({ name: 'Studio', type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, u.me(idem()))));
  const request = (profileId: string, headers: Record<string, string> = idem()) => h.app.request(`/v1/profiles/${profileId}/firm-request`, json({}, u.me(headers)));
  const me = async () => read(await h.app.request('/v1/me', { headers: u.me() }));
  const profileOf = async (id: string) => (await me()).profiles.find((p: { id: string }) => p.id === id);
  return { h, u, business, request, me, profileOf };
}

describe('POST /v1/profiles/{profileId}/firm-request', () => {
  it('records the owner’s request on an owned Business profile: 202 with when, audited (AC2)', async () => {
    const { h, u, business, request } = await setup();
    const res = await request(business.id);
    expect(res.status).toBe(202);
    expect(await read(res)).toEqual({ firmRequest: { requestedAt: NOW.toISOString() } });
    expect(await h.store.organizations.getById(business.id)).toMatchObject({ firmRequestedAt: NOW, firmRequestedByUserId: u.userId, firmEnabledAt: null });
    const audit = await read(await h.app.request(`/admin/v1/organizations/${business.id}/audit`, { headers: admin }));
    expect(audit.events.filter((e: { action: string }) => e.action === 'firm.requested')).toHaveLength(1);
  });

  it('answers a repeat with the first request, under a new key or a replayed one, writing one audit row (AC2, O7)', async () => {
    const { h, business, request } = await setup();
    const key = idem();
    const first = await read(await request(business.id, key));
    h.clock.now = new Date(NOW.getTime() + 60_000);
    const replay = await request(business.id, key);
    expect(replay.status).toBe(202);
    expect(await read(replay)).toEqual(first);
    const fresh = await request(business.id);
    expect(fresh.status).toBe(202);
    expect(await read(fresh)).toEqual(first);
    const audit = await read(await h.app.request(`/admin/v1/organizations/${business.id}/audit`, { headers: admin }));
    expect(audit.events.filter((e: { action: string }) => e.action === 'firm.requested')).toHaveLength(1);
  });

  it('leaves the version alone, so the owner’s open edit form still saves (O3)', async () => {
    const { h, u, business, request } = await setup();
    await request(business.id);
    const saved = await h.app.request(`/v1/profiles/${business.id}`, json({ name: 'Studio Renamed' }, u.me({ 'if-match': String(business.version) }), 'PATCH'));
    expect(saved.status).toBe(200);
  });

  it('refuses the built-in personal profile and an owned Personal profile (AC3)', async () => {
    const { h, u, request } = await setup();
    const personal = await request(u.personalId);
    expect(personal.status).toBe(409);
    expect((await read(personal)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'PERSONAL_PROFILE' } });
    const ownedPersonal = await read(await h.app.request('/v1/profiles', json({ name: 'Home', type: 'PERSONAL', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, u.me(idem()))));
    const refused = await request(ownedPersonal.id);
    expect(refused.status).toBe(409);
    expect((await read(refused)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_BUSINESS' } });
  });

  it('refuses a firm the caller only belongs to (403 NOT_OWNER) and a profile they can’t see (404) (AC3)', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    const member = await person(h, firm.id);
    const res = await h.app.request(`/v1/profiles/${firm.id}/firm-request`, json({}, member.me(idem())));
    expect(res.status).toBe(403);
    expect((await read(res)).error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { reason: 'NOT_OWNER' } });
    const stranger = await person(h);
    expect((await h.app.request(`/v1/profiles/${firm.id}/firm-request`, json({}, stranger.me(idem())))).status).toBe(404);
  });

  it('refuses a profile whose firm features are already on', async () => {
    const { h, business, request } = await setup();
    await h.app.request(`/admin/v1/organizations/${business.id}`, json({ firmEnabled: true }, admin, 'PATCH'));
    const res = await request(business.id);
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'ALREADY_FIRM' } });
  });

  it('refuses an API key: requesting is the owner’s, signed in', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    const key = await read(await h.app.request(`/admin/v1/organizations/${firm.id}/api-keys`, json({ name: 'Malafat', scopes: ['customers:read'] }, admin)));
    const res = await h.app.request(`/v1/profiles/${firm.id}/firm-request`, json({}, { authorization: `Bearer ${key.secret}`, ...idem() }));
    expect(res.status).toBe(403);
  });
});

describe('GET /v1/me firm fields (AC4)', () => {
  it('reports firm off, no role and no request on every profile to begin with, keeping the existing fields', async () => {
    const { me } = await setup();
    const body = await me();
    for (const p of body.profiles) {
      expect(p).toMatchObject({ firm: false, role: null, firmRequestedAt: null });
      expect(p).toHaveProperty('owned');
      expect(p).toHaveProperty('version');
    }
  });

  it('shows the owner their pending request, then firm on with the OWNER role once enabled in place', async () => {
    const { h, business, request, profileOf } = await setup();
    await request(business.id);
    expect(await profileOf(business.id)).toMatchObject({ firm: false, role: null, firmRequestedAt: NOW.toISOString(), owned: true });
    await h.app.request(`/admin/v1/organizations/${business.id}`, json({ firmEnabled: true }, admin, 'PATCH'));
    expect(await profileOf(business.id)).toMatchObject({ firm: true, role: 'OWNER', firmRequestedAt: null, owned: true, type: 'BUSINESS' });
  });

  it('gives a member of an enabled operator firm their role, and never shows them a request', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    const owner = await person(h, firm.id);
    const bookkeeper = await person(h, firm.id);
    await h.app.request(`/admin/v1/organizations/${firm.id}`, json({ firmEnabled: true, ownerUserIds: [owner.userId] }, admin, 'PATCH'));
    const theirs = async (p: Awaited<ReturnType<typeof person>>) =>
      (await read(await h.app.request('/v1/me', { headers: p.me() }))).profiles.find((x: { id: string }) => x.id === firm.id);
    expect(await theirs(owner)).toMatchObject({ firm: true, role: 'OWNER', firmRequestedAt: null, owned: false });
    expect(await theirs(bookkeeper)).toMatchObject({ firm: true, role: 'BOOKKEEPER', firmRequestedAt: null });
  });

  it('returns the firm fields from POST and PATCH /v1/profiles too (one builder)', async () => {
    const { h, u, business } = await setup();
    expect(business).toMatchObject({ firm: false, role: null, firmRequestedAt: null });
    await h.app.request(`/admin/v1/organizations/${business.id}`, json({ firmEnabled: true }, admin, 'PATCH'));
    const current = (await read(await h.app.request('/v1/me', { headers: u.me() }))).profiles.find((p: { id: string }) => p.id === business.id);
    const res = await h.app.request(`/v1/profiles/${business.id}`, json({ name: 'Studio Firm' }, u.me({ 'if-match': String(current.version) }), 'PATCH'));
    expect(res.status).toBe(200);
    expect((await read(res)).profile).toMatchObject({ firm: true, role: 'OWNER', owned: true });
  });
});
