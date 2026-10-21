import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MAX_PROFILE_OWNERS } from '../co-owners.js';
import { CURRENT_TERMS } from '../legal.js';
import { termsAcceptedAudit } from '../terms-acceptance.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-373 (ADR-163): co-owners. The operator makes a person a co-owner of a Business profile someone created
 * (`POST /admin/v1/users/{id}/memberships` with `role: OWNER`); they own it as fully as its creator, and leave — or
 * are removed by the creator — through `DELETE /v1/profiles/{id}/owners/{userId}`. Everything they recorded stays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

function harness() {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-14T09:00:00Z') };
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
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function person(h: Harness, options: { displayName?: string; firmId?: string } = {}) {
  const email = `person${++seq}@studio.ps`;
  const displayName = options.displayName ?? `Person ${seq}`;
  const body = options.firmId ? { email, displayName, organizationId: options.firmId } : { email, displayName, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' };
  const created = await provisionUser(h.app, body);
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const me = (extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN, ...extra });
  return { me, email, userId: created.user.id as string, personalId: created.personalProfile.id as string };
}
type Person = Awaited<ReturnType<typeof person>>;

async function businessOf(h: Harness, creator: Person, type: 'BUSINESS' | 'PERSONAL' = 'BUSINESS') {
  const res = await h.app.request('/v1/profiles', json({ name: 'Sader & Haddad', type, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, creator.me(idem())));
  expect(res.status).toBe(201);
  return (await read(res)).id as string;
}

const grant = (h: Harness, userId: string, organizationId: string, role?: 'OWNER') =>
  h.app.request(`/admin/v1/users/${userId}/memberships`, json({ organizationId, ...(role ? { role } : {}) }, admin));
const removeOwner = (h: Harness, actor: Person, profileId: string, userId: string, headers = idem()) =>
  h.app.request(`/v1/profiles/${profileId}/owners/${userId}`, { method: 'DELETE', headers: actor.me(headers) });
const meOf = async (h: Harness, p: Person) => read(await h.app.request('/v1/me', { headers: p.me() }));
const profileIn = async (h: Harness, p: Person, id: string) => (await meOf(h, p)).profiles.find((x: Loose) => x.id === id);

/** A creator, a co-owner the operator added, and their shared Business profile. */
async function shared() {
  const h = harness();
  const basel = await person(h, { displayName: 'Basel Sader' });
  const lina = await person(h, { displayName: 'Lina Haddad' });
  const id = await businessOf(h, basel);
  expect((await grant(h, lina.userId, id, 'OWNER')).status).toBe(201);
  return { h, basel, lina, id };
}

describe('the operator adds a co-owner (role OWNER)', () => {
  it('grants an owned Business profile, idempotently, and audits it with the role', async () => {
    const { h, lina, id } = await shared();
    expect(await h.store.memberships.find(lina.userId, id)).toMatchObject({ role: 'OWNER' });
    const again = await grant(h, lina.userId, id, 'OWNER');
    expect(again.status).toBe(200);
    expect((await read(again)).created).toBe(false);
    const audit = await h.store.audit.listByOrganization(id, 50);
    expect(audit.filter((e) => e.action === 'membership.granted' && e.entityId === lina.userId)).toEqual([
      expect.objectContaining({ actorType: 'ADMIN', metadata: { role: 'OWNER' } }),
    ]);
  });

  it('still refuses a grant without a role on any owned profile (regression R1(2), S4)', async () => {
    const { h, id } = await shared();
    const stranger = await person(h);
    const res = await grant(h, stranger.userId, id);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'OWNED_PROFILE' });
  });

  it.each([
    ['the built-in personal profile', 'personal', 'PERSONAL_PROFILE'],
    ['an owned Personal profile', 'ownedPersonal', 'NOT_BUSINESS'],
    ['an operator firm', 'firm', 'NOT_CO_OWNABLE'],
  ] as const)('refuses %s (%s → %s)', async (_label, kind, reason) => {
    const h = harness();
    const basel = await person(h);
    const lina = await person(h);
    const firm = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))).id as string;
    const target = kind === 'personal' ? basel.personalId : kind === 'ownedPersonal' ? await businessOf(h, basel, 'PERSONAL') : firm;
    const res = await grant(h, lina.userId, target, 'OWNER');
    expect(res.status).toBe(409);
    expect((await read(res)).error.details.reason).toBe(reason);
    expect(await h.store.memberships.find(lina.userId, target)).toBeNull();
  });

  it(`stops at ${MAX_PROFILE_OWNERS} owners, the creator included`, async () => {
    const { h, id } = await shared();
    const third = await person(h);
    expect((await grant(h, third.userId, id, 'OWNER')).status).toBe(201);
    const fourth = await person(h);
    const res = await grant(h, fourth.userId, id, 'OWNER');
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'OWNER_LIMIT', limit: MAX_PROFILE_OWNERS });
  });

  it('refuses a disabled account (USER_DISABLED, qa-reconcile D2), and writes nothing', async () => {
    const h = harness();
    const basel = await person(h);
    const lina = await person(h);
    const id = await businessOf(h, basel);
    expect((await h.app.request(`/admin/v1/users/${lina.userId}/disable`, { method: 'POST', headers: admin })).status).toBe(200);
    const res = await grant(h, lina.userId, id, 'OWNER');
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'USER_DISABLED' });
    expect(await h.store.memberships.find(lina.userId, id)).toBeNull();
    expect((await h.store.audit.listByOrganization(id, 50)).filter((e) => e.action === 'membership.granted' && e.entityId === lina.userId)).toEqual([]);
  });

  it('audits an operator revoke of a co-owner with the role they held', async () => {
    const { h, lina, id } = await shared();
    expect((await h.app.request(`/admin/v1/users/${lina.userId}/memberships/${id}`, { method: 'DELETE', headers: admin })).status).toBe(200);
    expect(await h.store.memberships.find(lina.userId, id)).toBeNull();
    const revoked = (await h.store.audit.listByOrganization(id, 50)).filter((e) => e.action === 'membership.revoked');
    expect(revoked).toEqual([expect.objectContaining({ actorType: 'ADMIN', entityId: lina.userId, metadata: { role: 'OWNER', reason: 'operator' } })]);
  });

  it('refuses to turn an existing member with another role into an owner (eng review D7)', async () => {
    const { h, id } = await shared();
    const bookkeeper = await person(h);
    // Unreachable through the API until MUT-306: with firm features on, a store grant lands as BOOKKEEPER (MUT-300).
    expect((await h.app.request(`/admin/v1/organizations/${id}`, json({ firmEnabled: true }, admin, 'PATCH'))).status).toBe(200);
    expect((await h.store.memberships.grant(bookkeeper.userId, id, h.clock.now)).membership.role).toBe('BOOKKEEPER');
    const res = await grant(h, bookkeeper.userId, id, 'OWNER');
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'ROLE_CHANGE_NOT_SUPPORTED', role: 'BOOKKEEPER' });
  });
});

describe('a co-owner owns the profile as fully as its creator', () => {
  it('lists it as owned, with its owners creator-first, beside their own private personal profile', async () => {
    const { h, basel, lina, id } = await shared();
    const linaView = await profileIn(h, lina, id);
    expect(linaView).toMatchObject({ owned: true, isPersonalDefault: false, type: 'BUSINESS' });
    expect(linaView.owners).toEqual([
      { userId: basel.userId, name: 'Basel Sader', email: basel.email, creator: true },
      { userId: lina.userId, name: 'Lina Haddad', email: lina.email, creator: false },
    ]);
    expect((await profileIn(h, basel, id)).owners).toEqual(linaView.owners);
    // Each keeps a private personal profile: the other never sees it.
    expect(await profileIn(h, lina, basel.personalId)).toBeUndefined();
    expect(await profileIn(h, basel, lina.personalId)).toBeUndefined();
    expect((await profileIn(h, lina, lina.personalId)).owners).toEqual([{ userId: lina.userId, name: 'Lina Haddad', email: lina.email, creator: true }]);
  });

  it('counts the shared profile toward its creator’s cap only', async () => {
    const { h, basel, lina } = await shared();
    expect((await meOf(h, basel)).limits.ownedProfiles).toBe(2);
    expect((await meOf(h, lina)).limits.ownedProfiles).toBe(1);
  });

  it('renames it and changes its currency, and the response carries its owners (outside voice OV4)', async () => {
    const { h, lina, id } = await shared();
    const res = await h.app.request(`/v1/profiles/${id}`, json({ name: 'S&H Studio', defaultCurrency: 'USD' }, lina.me({ 'if-match': '1' }), 'PATCH'));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.profile).toMatchObject({ name: 'S&H Studio', defaultCurrency: 'USD', owned: true });
    expect(body.profile.owners).toHaveLength(2);
  });

  it('keeps a shared profile Business: the preview and PATCH both refuse PERSONAL (CO_OWNED)', async () => {
    const { h, lina, id } = await shared();
    const preview = await h.app.request(`/v1/profiles/${id}/type-change?to=PERSONAL`, { headers: lina.me() });
    expect(preview.status).toBe(409);
    expect((await read(preview)).error.details).toEqual({ reason: 'CO_OWNED' });
    const patch = await h.app.request(`/v1/profiles/${id}`, json({ type: 'PERSONAL' }, lina.me({ 'if-match': '1' }), 'PATCH'));
    expect(patch.status).toBe(409);
    expect((await read(patch)).error.details).toEqual({ reason: 'CO_OWNED' });
    expect((await h.store.organizations.getById(id))!.profileType).toBe('BUSINESS');
  });

  it('records income, adds a client, and re-dates only their own capture', async () => {
    const { h, basel, lina, id } = await shared();
    const as = (p: Person) => p.me({ 'x-mutaba3a-profile': id, ...idem() });
    expect((await h.app.request('/v1/customers', json({ name: 'Al-Quds Bakery' }, as(lina)))).status).toBe(201);
    expect((await h.app.request('/v1/income', json({ kind: 'received', amount: '300.00', currency: 'ILS', occurredOn: '2026-10-08' }, as(lina)))).status).toBe(201);
    const capture = (by: Person) =>
      h.store.payments.capture({ organizationId: id, customerId: null, projectId: null, currency: 'ILS', amountMinor: 1000n, receivedOn: '2026-10-08', method: 'CASH', notes: null, requestId: null, createdByUserId: by.userId, captureSource: 'app' }, h.clock.now);
    const mine = await capture(lina);
    const theirs = await capture(basel);
    const redate = (paymentId: string) => h.app.request(`/v1/payments/${paymentId}`, json({ receivedOn: '2026-10-01' }, lina.me({ 'x-mutaba3a-profile': id, 'if-match': '1' }), 'PATCH'));
    expect((await redate(mine.id)).status).toBe(200);
    expect((await redate(theirs.id)).status).toBe(404);
  });

  it('re-dates only an Owed entry they captured, and the entry says who did (qa-reconcile D1)', async () => {
    const { h, basel, lina, id } = await shared();
    const client = await read(await h.app.request('/v1/customers', json({ name: 'Al-Quds Bakery' }, lina.me({ 'x-mutaba3a-profile': id, ...idem() }))));
    const owe = async (by: Person) => {
      const res = await h.app.request('/v1/income', json({ kind: 'owed', amount: '120.00', currency: 'ILS', occurredOn: '2026-10-08', customerId: client.id, dueDate: '2026-11-15' }, by.me({ 'x-mutaba3a-profile': id, ...idem() })));
      expect(res.status).toBe(201);
      return (await read(res)).id as string;
    };
    const mine = await owe(lina);
    const theirs = await owe(basel);
    const entry = async (rid: string) => read(await h.app.request(`/v1/receivables/${rid}`, { headers: lina.me({ 'x-mutaba3a-profile': id }) }));
    expect((await entry(mine)).capturedByUserId).toBe(lina.userId);
    expect((await entry(theirs)).capturedByUserId).toBe(basel.userId);
    const redate = (rid: string) => h.app.request(`/v1/income/${rid}`, json({ occurredOn: '2026-10-01' }, lina.me({ 'x-mutaba3a-profile': id, 'if-match': '1' }), 'PATCH'));
    expect((await redate(mine)).status).toBe(200);
    expect((await redate(theirs)).status).toBe(404);
  });

  it('may ask for firm features, and both owners see who asked (DR13)', async () => {
    const { h, basel, lina, id } = await shared();
    expect((await h.app.request(`/v1/profiles/${id}/firm-request`, { method: 'POST', headers: lina.me(idem()) })).status).toBe(202);
    expect((await profileIn(h, basel, id)).firmRequestedBy).toEqual({ userId: lina.userId, name: 'Lina Haddad' });
    // The request outlives the person: once they leave, the creator still sees it, no longer named.
    expect((await removeOwner(h, lina, id, lina.userId)).status).toBe(200);
    expect((await profileIn(h, basel, id)).firmRequestedBy).toEqual({ userId: lina.userId, name: null });
  });

  it('keeps every owner OWNER when firm features are turned on (no demotion)', async () => {
    const { h, basel, lina, id } = await shared();
    expect((await h.app.request(`/admin/v1/organizations/${id}`, json({ firmEnabled: true }, admin, 'PATCH'))).status).toBe(200);
    expect(await h.store.memberships.find(basel.userId, id)).toMatchObject({ role: 'OWNER' });
    expect(await h.store.memberships.find(lina.userId, id)).toMatchObject({ role: 'OWNER' });
  });
});

describe('an OWNER-role member of a firm never owns it (regression R1(3))', () => {
  it('is not owned on /v1/me, and the store refuses its update outright (outside voice OV2)', async () => {
    const h = harness();
    const firm = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))).id as string;
    const staff = await person(h, { firmId: firm });
    expect(await h.store.memberships.find(staff.userId, firm)).toMatchObject({ role: 'OWNER' });
    expect(await profileIn(h, staff, firm)).toMatchObject({ owned: false, owners: null });
    const patch = await h.app.request(`/v1/profiles/${firm}`, json({ name: 'Mine now' }, staff.me({ 'if-match': '1' }), 'PATCH'));
    expect(patch.status).toBe(403);
    const direct = await h.store.organizations.updateOwned(firm, staff.userId, 1, { name: 'Mine now' }, null, h.clock.now, { actorId: staff.userId, requestId: null, fields: ['name'], preset: null });
    expect(direct).toEqual({ kind: 'not_found' });
    expect((await h.store.organizations.getById(firm))!).toMatchObject({ ownerUserId: null, name: expect.stringMatching(/^Firm /) });
  });
});

describe('leaving and removing (DELETE /v1/profiles/{id}/owners/{userId})', () => {
  it('lets a co-owner leave: access ends at once, their records stay, the leave is audited', async () => {
    const { h, lina, id } = await shared();
    expect((await h.app.request('/v1/income', json({ kind: 'received', amount: '50.00', currency: 'ILS', occurredOn: '2026-10-08' }, lina.me({ 'x-mutaba3a-profile': id, ...idem() })))).status).toBe(201);
    const res = await removeOwner(h, lina, id, lina.userId);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ result: 'left' });
    expect(await profileIn(h, lina, id)).toBeUndefined();
    expect((await h.app.request('/v1/customers', { headers: lina.me({ 'x-mutaba3a-profile': id }) })).status).toBe(404);
    expect((await h.store.payments.list(id, {}, { limit: 10, cursor: null })).items.map((p: Loose) => p.createdByUserId)).toContain(lina.userId);
    const revoked = (await h.store.audit.listByOrganization(id, 50)).filter((e) => e.action === 'membership.revoked');
    expect(revoked).toEqual([expect.objectContaining({ actorType: 'USER', actorId: lina.userId, entityId: lina.userId, metadata: { reason: 'left', role: 'OWNER' } })]);
  });

  it('lets the creator remove a co-owner', async () => {
    const { h, basel, lina, id } = await shared();
    const res = await removeOwner(h, basel, id, lina.userId);
    expect(await read(res)).toEqual({ result: 'removed' });
    expect(await h.store.memberships.find(lina.userId, id)).toBeNull();
    expect((await profileIn(h, basel, id)).owners).toHaveLength(1);
  });

  it('refuses the creator leaving (CREATOR_CANNOT_LEAVE, eng review D3)', async () => {
    const { h, basel, id } = await shared();
    const res = await removeOwner(h, basel, id, basel.userId);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'CREATOR_CANNOT_LEAVE' });
  });

  it('lets only the creator remove someone else (NOT_CREATOR)', async () => {
    const { h, basel, lina, id } = await shared();
    const third = await person(h);
    expect((await grant(h, third.userId, id, 'OWNER')).status).toBe(201);
    for (const target of [basel.userId, third.userId]) {
      const res = await removeOwner(h, lina, id, target);
      expect(res.status).toBe(403);
      expect((await read(res)).error.details).toEqual({ reason: 'NOT_CREATOR' });
      expect(await h.store.memberships.find(target, id)).toMatchObject({ role: 'OWNER' });
    }
    expect((await h.store.audit.listByOrganization(id, 50)).filter((e) => e.action === 'membership.revoked')).toEqual([]);
  });

  it('answers NOT_OWNER to firm staff who belong to the profile but don’t own it', async () => {
    const h = harness();
    const firm = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))).id as string;
    const staff = await person(h, { firmId: firm });
    const res = await removeOwner(h, staff, firm, staff.userId);
    expect(res.status).toBe(403);
    expect((await read(res)).error.details).toEqual({ reason: 'NOT_OWNER' });
    expect(await h.store.memberships.find(staff.userId, firm)).not.toBeNull();
  });

  it('answers 404 to an outsider, and for someone who isn’t a co-owner', async () => {
    const { h, basel, lina, id } = await shared();
    const outsider = await person(h);
    for (const target of [lina.userId, basel.userId, outsider.userId]) expect((await removeOwner(h, outsider, id, target)).status).toBe(404);
    expect((await removeOwner(h, basel, id, outsider.userId)).status).toBe(404);
    expect((await removeOwner(h, lina, id, outsider.userId)).status).toBe(404);
    expect((await removeOwner(h, basel, basel.personalId, lina.userId)).status).toBe(404);
    expect(await h.store.memberships.find(lina.userId, id)).toMatchObject({ role: 'OWNER' });
    expect(await h.store.memberships.find(basel.userId, id)).toMatchObject({ role: 'OWNER' });
    expect(await h.store.memberships.find(outsider.userId, id)).toBeNull();
    expect((await h.store.audit.listByOrganization(id, 50)).filter((e) => e.action === 'membership.revoked')).toEqual([]);
  });

  it('replays the first answer for a retry with the same key, and 404s a fresh one after success', async () => {
    const { h, lina, id } = await shared();
    const key = idem();
    expect((await removeOwner(h, lina, id, lina.userId, key)).status).toBe(200);
    expect((await removeOwner(h, lina, id, lina.userId, key)).status).toBe(200);
    expect((await removeOwner(h, lina, id, lina.userId)).status).toBe(404);
  });
});

describe('terms acceptance (MUT-324) reaches the profiles a person co-owns', () => {
  it('writes user.terms_accepted on the shared profile for the co-owner, and never on a firm they only belong to', async () => {
    const { h, basel, lina, id } = await shared();
    const linaUser = (await h.store.users.getById(lina.userId))!;
    const acceptance = { version: CURRENT_TERMS.version, locale: 'en' as const, textSha256: CURRENT_TERMS.sha256.en, surface: 'portal' as const, clientRelease: null };
    const orgs = (await termsAcceptedAudit(h.store, linaUser, acceptance, 'req-1')).map((e) => e.organizationId);
    expect(orgs.sort()).toEqual([id, lina.personalId].sort());
    expect(orgs).not.toContain(basel.personalId);
  });
});
