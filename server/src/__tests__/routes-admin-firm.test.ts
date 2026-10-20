import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-300: the operator side of the firm switch. PATCH
 * /admin/v1/organizations/{id} turns firm features on in place (an owned
 * Business profile stays owned, D4) or off; DELETE …/firm-request declines a
 * pending request (D6); GET /admin/v1/firm-requests lists the pending ones.
 * Each change is audited; the same state twice is a no-op.
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
const enable = (h: Harness, id: string, body: Record<string, unknown> = { firmEnabled: true }) => h.app.request(`/admin/v1/organizations/${id}`, json(body, admin, 'PATCH'));
const firmActions = async (h: Harness, id: string) =>
  (await read(await h.app.request(`/admin/v1/organizations/${id}/audit`, { headers: admin }))).events
    .map((e: { action: string }) => e.action)
    .filter((a: string) => a.startsWith('firm.'))
    .reverse();

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
  return { me, email, userId: created.user.id as string, personalId: created.personalProfile.id as string };
}

async function ownedBusiness(h: Harness) {
  const u = await person(h);
  const profile = await read(await h.app.request('/v1/profiles', json({ name: 'Studio', type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, u.me(idem()))));
  return { u, profile };
}

describe('PATCH /admin/v1/organizations/{organizationId} (AC1)', () => {
  it('enables an owned Business profile in place: still owned, its owner OWNER, audited', async () => {
    const h = harness();
    const { u, profile } = await ownedBusiness(h);
    const res = await enable(h, profile.id);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.organization).toMatchObject({ id: profile.id, ownerUserId: u.userId, profileType: 'BUSINESS', firm: { enabledAt: NOW.toISOString(), requestedAt: null, requestedByUserId: null } });
    expect(await h.store.memberships.find(u.userId, profile.id)).toMatchObject({ role: 'OWNER' });
    expect(await firmActions(h, profile.id)).toEqual(['firm.enabled']);
  });

  it('enables an operator firm with named owners; everyone else becomes BOOKKEEPER', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    const rana = await person(h, firm.id);
    const omar = await person(h, firm.id);
    expect((await enable(h, firm.id, { firmEnabled: true, ownerUserIds: [rana.userId] })).status).toBe(200);
    expect(await h.store.memberships.find(rana.userId, firm.id)).toMatchObject({ role: 'OWNER' });
    expect(await h.store.memberships.find(omar.userId, firm.id)).toMatchObject({ role: 'BOOKKEEPER' });
    const detail = await read(await h.app.request(`/admin/v1/organizations/${firm.id}`, { headers: admin }));
    expect(detail.members).toEqual(
      expect.arrayContaining([
        { userId: rana.userId, email: rana.email, role: 'OWNER' },
        { userId: omar.userId, email: omar.email, role: 'BOOKKEEPER' },
      ]),
    );
  });

  it('refuses an operator firm with no owner (422) or an owner who isn’t a member (409 NOT_A_MEMBER)', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    await person(h, firm.id);
    const outsider = await person(h);
    const none = await enable(h, firm.id);
    expect(none.status).toBe(422);
    const notMember = await enable(h, firm.id, { firmEnabled: true, ownerUserIds: [outsider.userId] });
    expect(notMember.status).toBe(409);
    expect((await read(notMember)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_A_MEMBER', userIds: [outsider.userId] } });
    expect(await firmActions(h, firm.id)).toEqual([]);
  });

  it('refuses the built-in personal profile (409 PERSONAL_PROFILE) and an owned Personal one (409 NOT_BUSINESS)', async () => {
    const h = harness();
    const u = await person(h);
    const personal = await enable(h, u.personalId);
    expect(personal.status).toBe(409);
    expect((await read(personal)).error).toMatchObject({ details: { reason: 'PERSONAL_PROFILE' } });
    const home = await read(await h.app.request('/v1/profiles', json({ name: 'Home', type: 'PERSONAL', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, u.me(idem()))));
    const refused = await enable(h, home.id);
    expect(refused.status).toBe(409);
    expect((await read(refused)).error).toMatchObject({ details: { reason: 'NOT_BUSINESS' } });
  });

  it('disables, keeping roles; the same state twice changes nothing and audits nothing', async () => {
    const h = harness();
    const { u, profile } = await ownedBusiness(h);
    await enable(h, profile.id);
    expect((await enable(h, profile.id)).status).toBe(200);
    const off = await enable(h, profile.id, { firmEnabled: false });
    expect(off.status).toBe(200);
    expect((await read(off)).organization.firm.enabledAt).toBeNull();
    expect((await enable(h, profile.id, { firmEnabled: false })).status).toBe(200);
    expect(await h.store.memberships.find(u.userId, profile.id)).toMatchObject({ role: 'OWNER' });
    expect(await firmActions(h, profile.id)).toEqual(['firm.enabled', 'firm.disabled']);
  });

  it('answers 404 for an unknown organization and 401 without the admin token', async () => {
    const h = harness();
    expect((await enable(h, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    const firm = await operatorFirm(h);
    expect((await h.app.request(`/admin/v1/organizations/${firm.id}`, json({ firmEnabled: false }, {}, 'PATCH'))).status).toBe(401);
  });

  it('makes a later grant into the firm BOOKKEEPER, shown on the membership (D3)', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    const rana = await person(h, firm.id);
    await enable(h, firm.id, { firmEnabled: true, ownerUserIds: [rana.userId] });
    const nour = await person(h);
    const granted = await h.app.request(`/admin/v1/users/${nour.userId}/memberships`, json({ organizationId: firm.id }, admin));
    expect(granted.status).toBe(201);
    expect((await read(granted)).membership).toMatchObject({ organizationId: firm.id, role: 'BOOKKEEPER' });
  });
});

describe('DELETE /admin/v1/organizations/{organizationId}/firm-request (D6)', () => {
  it('declines a pending request, audited; the owner sees the offer again and may re-request', async () => {
    const h = harness();
    const { u, profile } = await ownedBusiness(h);
    await h.app.request(`/v1/profiles/${profile.id}/firm-request`, json({}, u.me(idem())));
    const res = await h.app.request(`/admin/v1/organizations/${profile.id}/firm-request`, { method: 'DELETE', headers: admin });
    expect(res.status).toBe(200);
    expect((await read(res)).organization.firm).toEqual({ enabledAt: null, requestedAt: null, requestedByUserId: null });
    const mine = (await read(await h.app.request('/v1/me', { headers: u.me() }))).profiles.find((p: { id: string }) => p.id === profile.id);
    expect(mine).toMatchObject({ firm: false, firmRequestedAt: null });
    expect((await h.app.request(`/v1/profiles/${profile.id}/firm-request`, json({}, u.me(idem())))).status).toBe(202);
    expect(await firmActions(h, profile.id)).toEqual(['firm.requested', 'firm.request_declined', 'firm.requested']);
  });

  it('answers 404 when nothing is pending', async () => {
    const h = harness();
    const { profile } = await ownedBusiness(h);
    expect((await h.app.request(`/admin/v1/organizations/${profile.id}/firm-request`, { method: 'DELETE', headers: admin })).status).toBe(404);
  });
});

describe('GET /admin/v1/firm-requests', () => {
  it('lists pending requests oldest first with the requester’s email, paging with a cursor', async () => {
    const h = harness();
    const a = await ownedBusiness(h);
    const b = await ownedBusiness(h);
    const c = await ownedBusiness(h);
    for (const [i, x] of [a, b, c].entries()) {
      h.clock.now = new Date(NOW.getTime() + i * 60_000);
      await h.app.request(`/v1/profiles/${x.profile.id}/firm-request`, json({}, x.u.me(idem())));
    }
    await enable(h, b.profile.id);
    const first = await read(await h.app.request('/admin/v1/firm-requests?limit=1', { headers: admin }));
    expect(first.data).toEqual([{ organizationId: a.profile.id, name: 'Studio', requestedAt: NOW.toISOString(), requestedByUserId: a.u.userId, requestedByEmail: a.u.email, owned: true }]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await read(await h.app.request(`/admin/v1/firm-requests?limit=1&cursor=${first.nextCursor}`, { headers: admin }));
    expect(second.data.map((r: { organizationId: string }) => r.organizationId)).toEqual([c.profile.id]);
    expect(second.nextCursor).toBeNull();
  });
});
