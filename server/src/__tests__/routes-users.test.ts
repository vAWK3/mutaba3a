import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../auth/users.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { redeemSetupLink, SETUP_TEST_PASSWORD, setupTokenOf } from './helpers/provision.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const hasher = createArgon2Hasher(ARGON2_MINIMUMS);

function harness() {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-11T09:00:00Z') };
  const logs: string[] = [];
  const app = createApp({
    store,
    logger: pino({ level: 'trace' }, { write: (line: string) => void logs.push(line) }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    passwordHasher: hasher,
  });
  return { app, store, clock, logs };
}
type Harness = ReturnType<typeof harness>;

const send = (method: string, body?: unknown, headers: Record<string, string> = admin) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function organization(h: Harness, name = `Sader Law Firm ${++seq}`): Promise<{ id: string }> {
  const res = await h.app.request('/admin/v1/organizations', send('POST', { name, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }));
  expect(res.status).toBe(201);
  return read(res);
}

async function createUser(h: Harness, organizationId: string, email = `partner${++seq}@firm.ps`) {
  const res = await h.app.request('/admin/v1/users', send('POST', { email, displayName: 'Nour Haddad', organizationId }));
  expect(res.status).toBe(201);
  return read(res) as Promise<{
    user: { id: string; email: string; status: string; passwordChangedAt: string };
    memberships: { organizationId: string }[];
    personalProfile: { id: string; name: string };
    setupLink: { url: string; expiresAt: string; purpose: string };
  }>;
}

async function auditActions(h: Harness, organizationId: string): Promise<{ action: string; actorType: string; entityId: string }[]> {
  const res = await h.app.request(`/admin/v1/organizations/${organizationId}/audit?limit=200`, send('GET'));
  // The admin audit endpoint answers newest first; the assertions read oldest first.
  return [...(await read(res)).events].reverse();
}

describe('POST /admin/v1/users', () => {
  it('creates a user with their personal and firm memberships and a one-time setup link, never a password (MUT-235)', async () => {
    const h = harness();
    const org = await organization(h);
    const res = await h.app.request('/admin/v1/users', send('POST', { email: '  Partner@Firm.PS ', displayName: 'Nour Haddad', organizationId: org.id }));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('$argon2id$');
    const body = JSON.parse(text);
    // MUT-209: a new account is Arabic unless the operator asks otherwise, and so is its personal profile's name
    expect(body.user).toMatchObject({ email: 'partner@firm.ps', displayName: 'Nour Haddad', locale: 'ar', status: 'ACTIVE' });
    expect(body.personalProfile.name).toBe('شخصي');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.memberships).toEqual([
      { organizationId: body.personalProfile.id, createdAt: '2026-10-11T09:00:00.000Z' },
      { organizationId: org.id, createdAt: '2026-10-11T09:00:00.000Z' },
    ]);
    expect(body).not.toHaveProperty('initialPassword');
    expect(body.setupLink).toEqual({ url: expect.stringMatching(/^http:\/\/localhost\/setup#[A-Za-z0-9_-]{43}$/), expiresAt: '2026-10-14T09:00:00.000Z', purpose: 'SETUP' });

    const stored = await h.store.users.getById(body.user.id);
    expect(stored!.passwordHash).toBeNull();
  });

  it('takes setupLinkValidHours between 1 and 720 (MUT-235)', async () => {
    const h = harness();
    const org = await organization(h);
    const make = (hours: number) => h.app.request('/admin/v1/users', send('POST', { email: `h${++seq}@firm.ps`, displayName: 'Nour', organizationId: org.id, setupLinkValidHours: hours }));
    expect((await read(await make(1))).setupLink.expiresAt).toBe('2026-10-11T10:00:00.000Z');
    expect((await read(await make(720))).setupLink.expiresAt).toBe('2026-11-10T09:00:00.000Z');
    expect((await make(0)).status).toBe(422);
    expect((await make(721)).status).toBe(422);
  });

  it('accepts locale en when the operator asks for it', async () => {
    const h = harness();
    const org = await organization(h);
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'en@firm.ps', displayName: 'Nour', locale: 'en', organizationId: org.id }));
    expect(res.status).toBe(201);
    expect((await read(res)).user.locale).toBe('en');
  });

  it('refuses a reused email in any case or spacing with 409', async () => {
    const h = harness();
    const org = await organization(h);
    await createUser(h, org.id, 'partner@firm.ps');
    const res = await h.app.request('/admin/v1/users', send('POST', { email: ' PARTNER@firm.ps', displayName: 'Again', organizationId: org.id }));
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', message: 'A user with this email already exists' });
  });

  it('answers 404 for an unknown organization and creates nobody', async () => {
    const h = harness();
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'ghost@firm.ps', displayName: 'Ghost', organizationId: '00000000-0000-4000-8000-000000000000' }));
    expect(res.status).toBe(404);
    expect(await h.store.users.findByEmail('ghost@firm.ps')).toBeNull();
  });

  it.each([
    [{ email: 'not-an-email', displayName: 'X' }],
    [{ email: 'ok@firm.ps', displayName: '' }],
    [{ email: 'ok@firm.ps', displayName: 'X', locale: 'fr' }],
  ])('answers 422 for %j', async (partial) => {
    const h = harness();
    const org = await organization(h);
    const res = await h.app.request('/admin/v1/users', send('POST', { organizationId: org.id, ...partial }));
    expect(res.status).toBe(422);
  });
});

async function createdPersonalId(h: Harness, userId: string): Promise<string> {
  const memberships = await h.store.memberships.listByUser(userId);
  const orgs = await Promise.all(memberships.map((m) => h.store.organizations.getById(m.organizationId)));
  const personal = orgs.filter((o) => o?.personalOwnerUserId === userId);
  expect(personal).toHaveLength(1);
  return personal[0]!.id;
}

describe('personal profile (MUT-120)', () => {
  it('creates the personal profile beside the firm, named for the locale, inheriting the firm currency and timezone', async () => {
    const h = harness();
    const res = await h.app.request('/admin/v1/organizations', send('POST', { name: 'Haddad & Co', defaultCurrency: 'USD', timezone: 'Asia/Hebron' }));
    const firm = await read(res);
    const created = await createUser(h, firm.id);
    // Created without a locale: Arabic by default (MUT-209), so the personal profile is شخصي
    expect(created.personalProfile.name).toBe('شخصي');
    expect(created.memberships.map((m) => m.organizationId)).toEqual([created.personalProfile.id, firm.id]);
    expect(await h.store.organizations.getById(created.personalProfile.id)).toMatchObject({
      name: 'شخصي',
      defaultCurrency: 'USD',
      timezone: 'Asia/Hebron',
      personalOwnerUserId: created.user.id,
    });
    expect((await h.store.organizations.getById(created.personalProfile.id))?.slug).toMatch(/^personal-[0-9a-f-]{36}$/);
  });

  it('names it شخصي for an Arabic-locale user', async () => {
    const h = harness();
    const org = await organization(h);
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'ar@firm.ps', displayName: 'نور', locale: 'ar', organizationId: org.id }));
    expect((await read(res)).personalProfile.name).toBe('شخصي');
  });

  it('creates a personal-only user from a currency and timezone, with no firm', async () => {
    const h = harness();
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'solo@firm.ps', displayName: 'Solo', defaultCurrency: 'EUR', timezone: 'Europe/Berlin' }));
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(body.memberships).toEqual([{ organizationId: body.personalProfile.id, createdAt: '2026-10-11T09:00:00.000Z' }]);
    expect(await h.store.organizations.getById(body.personalProfile.id)).toMatchObject({ defaultCurrency: 'EUR', timezone: 'Europe/Berlin', personalOwnerUserId: body.user.id });
  });

  it.each([
    [{}],
    [{ defaultCurrency: 'ILS' }],
    [{ timezone: 'Asia/Jerusalem' }],
  ])('answers 422 with no firm and an incomplete %j, creating nobody', async (partial) => {
    const h = harness();
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'half@firm.ps', displayName: 'Half', ...partial }));
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('VALIDATION_FAILED');
    expect(await h.store.users.findByEmail('half@firm.ps')).toBeNull();
  });

  it.each([
    [{ defaultCurrency: 'ILS', timezone: 'Asia/Jerusalim' }, false],
    [{ timezone: 'Mars/Olympus_Mons' }, true],
  ])('answers 422 for an unknown IANA timezone %j (firm: %s), creating nobody (MUT-120 review)', async (partial, withFirm) => {
    const h = harness();
    const org = withFirm ? await organization(h) : null;
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'tz@firm.ps', displayName: 'TZ', ...(org ? { organizationId: org.id } : {}), ...partial }));
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('VALIDATION_FAILED');
    expect(await h.store.users.findByEmail('tz@firm.ps')).toBeNull();
  });

  it('refuses to revoke a user’s own personal-profile membership, and keeps it (MUT-120 review)', async () => {
    const h = harness();
    const org = await organization(h);
    const { user, personalProfile } = await createUser(h, org.id);
    const res = await h.app.request(`/admin/v1/users/${user.id}/memberships/${personalProfile.id}`, send('DELETE'));
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'PERSONAL_PROFILE' } });
    expect(await h.store.memberships.find(user.id, personalProfile.id)).not.toBeNull();
    expect((await h.app.request(`/admin/v1/users/${user.id}/memberships/${org.id}`, send('DELETE'))).status).toBe(200);
  });

  it('lets a request currency and timezone override the firm’s', async () => {
    const h = harness();
    const org = await organization(h);
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'o@firm.ps', displayName: 'O', organizationId: org.id, defaultCurrency: 'USD', timezone: 'Asia/Hebron' }));
    const body = await read(res);
    expect(await h.store.organizations.getById(body.personalProfile.id)).toMatchObject({ defaultCurrency: 'USD', timezone: 'Asia/Hebron' });
  });

  it('a retried create answers 409 and leaves the user with exactly one personal profile', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id, 'retry@firm.ps');
    const again = await h.app.request('/admin/v1/users', send('POST', { email: 'retry@firm.ps', displayName: 'Again', organizationId: org.id }));
    expect(again.status).toBe(409);
    const personal = (await h.store.organizations.list()).filter((o) => o.personalOwnerUserId !== null);
    expect(personal.map((o) => o.personalOwnerUserId)).toEqual([user.id]);
  });

  it('refuses to grant a personal profile to anyone but its owner', async () => {
    const h = harness();
    const org = await organization(h);
    const a = await createUser(h, org.id);
    const b = await createUser(h, org.id);
    const res = await h.app.request(`/admin/v1/users/${b.user.id}/memberships`, send('POST', { organizationId: a.personalProfile.id }));
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'PERSONAL_PROFILE' } });
    expect(await h.store.memberships.find(b.user.id, a.personalProfile.id)).toBeNull();
    const own = await h.app.request(`/admin/v1/users/${a.user.id}/memberships`, send('POST', { organizationId: a.personalProfile.id }));
    expect(own.status).toBe(200);
    expect((await read(own)).created).toBe(false);
  });

  it('refuses to create a user inside someone else’s personal profile, creating nobody', async () => {
    const h = harness();
    const org = await organization(h);
    const a = await createUser(h, org.id);
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'intruder@firm.ps', displayName: 'Intruder', organizationId: a.personalProfile.id }));
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'PERSONAL_PROFILE' } });
    expect(await h.store.users.findByEmail('intruder@firm.ps')).toBeNull();
  });

  it('audits as ADMIN: organization.created, user.created and the setup link on the personal profile; the user events on the firm', async () => {
    const h = harness();
    const org = await organization(h);
    const { user, personalProfile } = await createUser(h, org.id);
    const summary = (events: { action: string; actorType: string }[]) => events.map((e) => `${e.actorType}:${e.action}`);
    // MUT-235: creating a user also issues their first setup link.
    expect(summary(await auditActions(h, personalProfile.id))).toEqual(['ADMIN:organization.created', 'ADMIN:user.created', 'ADMIN:user.setup_link_issued']);
    expect(summary((await auditActions(h, org.id)).filter((e) => e.entityId === user.id))).toEqual(['ADMIN:user.created', 'ADMIN:user.setup_link_issued']);
  });
});

describe('GET /admin/v1/users', () => {
  it('finds by email regardless of case and spacing, and lists nothing for an unknown one', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id, 'partner@firm.ps');
    const found = await read(await h.app.request(`/admin/v1/users?email=${encodeURIComponent(' Partner@FIRM.ps ')}`, send('GET')));
    expect(found.users.map((u: { id: string }) => u.id)).toEqual([user.id]);
    const none = await read(await h.app.request('/admin/v1/users?email=nobody%40firm.ps', send('GET')));
    expect(none.users).toEqual([]);
  });

  it('returns a user with its memberships by id, 404 when unknown', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    const res = await h.app.request(`/admin/v1/users/${user.id}`, send('GET'));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.user.id).toBe(user.id);
    expect(body.memberships.map((m: { organizationId: string }) => m.organizationId).sort()).toEqual([org.id, (await createdPersonalId(h, user.id))].sort());
    expect((await h.app.request('/admin/v1/users/00000000-0000-4000-8000-000000000000', send('GET'))).status).toBe(404);
  });
});

describe('memberships', () => {
  it('grants a second organization once, then reports it already existed', async () => {
    const h = harness();
    const a = await organization(h);
    const b = await organization(h);
    const { user } = await createUser(h, a.id);
    const first = await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    expect(first.status).toBe(201);
    expect((await read(first)).created).toBe(true);
    const again = await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    expect(again.status).toBe(200);
    expect((await read(again)).created).toBe(false);
  });

  it('answers 404 for an unknown user or organization on grant', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    const nobody = '00000000-0000-4000-8000-000000000000';
    expect((await h.app.request(`/admin/v1/users/${nobody}/memberships`, send('POST', { organizationId: org.id }))).status).toBe(404);
    expect((await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: nobody }))).status).toBe(404);
  });

  it('removes once, then reports nothing removed; 404 for an unknown user', async () => {
    const h = harness();
    const a = await organization(h);
    const b = await organization(h);
    const { user } = await createUser(h, a.id);
    await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    const first = await h.app.request(`/admin/v1/users/${user.id}/memberships/${b.id}`, send('DELETE'));
    expect(first.status).toBe(200);
    expect((await read(first)).removed).toBe(true);
    expect((await read(await h.app.request(`/admin/v1/users/${user.id}/memberships/${b.id}`, send('DELETE')))).removed).toBe(false);
    expect((await h.app.request(`/admin/v1/users/00000000-0000-4000-8000-000000000000/memberships/${b.id}`, send('DELETE'))).status).toBe(404);
  });
});

describe('password reset and status', () => {
  it('a reset issues a link and changes nothing else: the old password works until the link is used (MUT-235, AC 4)', async () => {
    const h = harness();
    const org = await organization(h);
    const { user, setupLink } = await createUser(h, org.id);
    await redeemSetupLink(h.app, setupLink.url);
    const signIn = (password: string) => h.app.request('/v1/sessions', send('POST', { email: user.email, password }, { origin: 'http://localhost' }));
    const session = (await signIn(SETUP_TEST_PASSWORD)).headers.get('set-cookie')!.split(';')[0]!;
    h.clock.now = new Date('2026-10-11T10:30:00Z');
    const res = await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST', {}));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.setupLink).toMatchObject({ purpose: 'RESET', expiresAt: '2026-10-14T10:30:00.000Z' });
    expect(setupTokenOf(body.setupLink.url)).not.toBe(setupTokenOf(setupLink.url));
    expect((await signIn(SETUP_TEST_PASSWORD)).status).toBe(201);
    expect((await h.app.request('/v1/me', { headers: { cookie: session } })).status).toBe(200);
    await redeemSetupLink(h.app, body.setupLink.url, 'the-new-password-chosen');
    expect((await signIn(SETUP_TEST_PASSWORD)).status).toBe(401);
    expect((await signIn('the-new-password-chosen')).status).toBe(201);
    expect((await h.app.request('/admin/v1/users/00000000-0000-4000-8000-000000000000/setup-link', send('POST', {}))).status).toBe(404);
  });

  it('a reset before any password was set is a SETUP link, and supersedes the first one', async () => {
    const h = harness();
    const org = await organization(h);
    const { user, setupLink } = await createUser(h, org.id);
    const body = await read(await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST', { validHours: 24 })));
    expect(body.setupLink).toMatchObject({ purpose: 'SETUP', expiresAt: '2026-10-12T09:00:00.000Z' });
    const first = await h.app.request('/v1/account-setup/check', send('POST', { token: setupTokenOf(setupLink.url) }, { origin: 'http://localhost' }));
    expect(await read(first)).toEqual({ state: 'superseded' });
  });

  it('with lock, the old password and every session stop working at once (MUT-235 D2)', async () => {
    const h = harness();
    const org = await organization(h);
    const { user, setupLink } = await createUser(h, org.id);
    await redeemSetupLink(h.app, setupLink.url);
    const signIn = (password: string) => h.app.request('/v1/sessions', send('POST', { email: user.email, password }, { origin: 'http://localhost' }));
    const cookie = (await signIn(SETUP_TEST_PASSWORD)).headers.get('set-cookie')!.split(';')[0]!;
    const device = (await read(await h.app.request('/v1/device-sessions', send('POST', { email: user.email, password: SETUP_TEST_PASSWORD }, {})))).token as string;
    const res = await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST', { lock: true }));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.setupLink.purpose).toBe('RESET');
    expect(body.lock).toBe(true);
    // The audit row is the forensic record that the operator force-signed-out the account.
    // Both links are issued at the same fake-clock instant, so match the rows by content, not order.
    const issued = (await h.store.audit.list(org.id, { action: 'user.setup_link_issued' }, { limit: 10, cursor: null })).items.map((e) => e.metadata);
    expect(issued).toHaveLength(2);
    expect(issued).toContainEqual({ purpose: 'RESET', expiresAt: body.setupLink.expiresAt, lock: true });
    expect(issued).toContainEqual({ purpose: 'SETUP', expiresAt: setupLink.expiresAt });
    expect((await signIn(SETUP_TEST_PASSWORD)).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: { cookie } })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: { authorization: `Bearer ${device}` } })).status).toBe(401);
    await redeemSetupLink(h.app, body.setupLink.url, 'a-fresh-safe-password');
    expect((await signIn('a-fresh-safe-password')).status).toBe(201);
  });

  it('refuses a link for a disabled user, and a validHours out of bounds', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    expect((await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST', { validHours: 721 }))).status).toBe(422);
    await h.app.request(`/admin/v1/users/${user.id}/disable`, send('POST'));
    const res = await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST', {}));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'USER_DISABLED' });
  });

  it('the optional body may be absent; a JSON content type with an empty body is a 422, never a 500 (TD-148)', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    expect((await h.app.request(`/admin/v1/users/${user.id}/setup-link`, { method: 'POST', headers: admin })).status).toBe(200);
    const empty = await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST'));
    expect(empty.status).toBe(422);
    expect((await read(empty)).error.code).toBe('VALIDATION_FAILED');
    expect((await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST', {}))).status).toBe(200);
  });

  it('the old password route is gone', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    expect((await h.app.request(`/admin/v1/users/${user.id}/password`, send('POST'))).status).toBe(404);
  });

  it('disables idempotently and enables again', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    for (let i = 0; i < 2; i++) {
      const res = await h.app.request(`/admin/v1/users/${user.id}/disable`, send('POST'));
      expect(res.status).toBe(200);
      expect((await read(res)).user.status).toBe('DISABLED');
    }
    const enabled = await h.app.request(`/admin/v1/users/${user.id}/enable`, send('POST'));
    expect((await read(enabled)).user.status).toBe('ACTIVE');
    expect((await h.app.request('/admin/v1/users/00000000-0000-4000-8000-000000000000/disable', send('POST'))).status).toBe(404);
  });
});

describe('audit', () => {
  it('appends each account mutation, as ADMIN, to every member organization', async () => {
    const h = harness();
    const a = await organization(h);
    const b = await organization(h);
    const { user } = await createUser(h, a.id);
    await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST', {}));
    await h.app.request(`/admin/v1/users/${user.id}/disable`, send('POST'));
    await h.app.request(`/admin/v1/users/${user.id}/enable`, send('POST'));
    await h.app.request(`/admin/v1/users/${user.id}/memberships/${b.id}`, send('DELETE'));

    const userEvents = (events: { action: string; actorType: string; entityId: string }[]) =>
      events.filter((e) => e.entityId === user.id).map((e) => `${e.actorType}:${e.action}`);
    expect(userEvents(await auditActions(h, a.id))).toEqual([
      'ADMIN:user.created',
      'ADMIN:user.setup_link_issued',
      'ADMIN:user.setup_link_issued',
      'ADMIN:user.disabled',
      'ADMIN:user.enabled',
    ]);
    expect(userEvents(await auditActions(h, b.id))).toEqual([
      'ADMIN:membership.granted',
      'ADMIN:user.setup_link_issued',
      'ADMIN:user.disabled',
      'ADMIN:user.enabled',
      'ADMIN:membership.revoked',
    ]);
  });

  it('records the email and display name on user.created', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id, 'nour@firm.ps');
    const res = await h.app.request(`/admin/v1/organizations/${org.id}/audit?limit=200`, send('GET'));
    const created = (await read(res)).events.find((e: { action: string; entityId: string }) => e.action === 'user.created' && e.entityId === user.id);
    expect(created).toMatchObject({ entityType: 'user', metadata: { email: 'nour@firm.ps', displayName: 'Nour Haddad' } });
  });

  it('still answers 200 for a user with no memberships, auditing nowhere', async () => {
    const h = harness();
    const org = await organization(h);
    const { user, personalProfile } = await createUser(h, org.id);
    // MUT-120: the personal membership has to go too before the user has none. The admin API refuses
    // that revoke, so the no-membership state is reached at the store, as an operator repair would.
    await h.app.request(`/admin/v1/users/${user.id}/memberships/${org.id}`, send('DELETE'));
    await h.store.memberships.revoke(user.id, personalProfile.id);
    const before = [h.store.auditCount(org.id), h.store.auditCount(personalProfile.id)];
    expect((await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST', {}))).status).toBe(200);
    expect([h.store.auditCount(org.id), h.store.auditCount(personalProfile.id)]).toEqual(before);
  });
});

describe('admin authentication', () => {
  const routes: [string, string][] = [
    ['POST', '/admin/v1/users'],
    ['GET', '/admin/v1/users?email=a%40b.c'],
    ['GET', '/admin/v1/users/00000000-0000-4000-8000-000000000000'],
    ['POST', '/admin/v1/users/00000000-0000-4000-8000-000000000000/memberships'],
    ['DELETE', '/admin/v1/users/00000000-0000-4000-8000-000000000000/memberships/00000000-0000-4000-8000-000000000000'],
    ['POST', '/admin/v1/users/00000000-0000-4000-8000-000000000000/setup-link'],
    ['POST', '/admin/v1/users/00000000-0000-4000-8000-000000000000/disable'],
    ['POST', '/admin/v1/users/00000000-0000-4000-8000-000000000000/enable'],
  ];

  it.each(routes)('%s %s refuses a missing or wrong admin token', async (method, path) => {
    const h = harness();
    for (const headers of [{}, { 'x-admin-token': 'wrong-token-with-at-least-32-characters!' }]) {
      const res = await h.app.request(path, send(method, method === 'GET' || method === 'DELETE' ? undefined : {}, headers));
      expect(res.status).toBe(401);
      expect((await read(res)).error.code).toBe('ADMIN_UNAUTHORIZED');
    }
  });
});

describe('secrets never reach the log', () => {
  it('logs no setup-link token, no password and no argon2 hash across every account operation (MUT-235, AC 6)', async () => {
    const h = harness();
    const a = await organization(h);
    const b = await organization(h);
    const { user, setupLink } = await createUser(h, a.id);
    const first = setupTokenOf(setupLink.url);
    await h.app.request('/v1/account-setup/check', send('POST', { token: first }, { origin: 'http://localhost' }));
    await redeemSetupLink(h.app, setupLink.url, 'a-password-for-the-log-test');
    await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    const reset = setupTokenOf((await read(await h.app.request(`/admin/v1/users/${user.id}/setup-link`, send('POST', { lock: true })))).setupLink.url);
    await h.app.request('/v1/account-setup', send('POST', { token: reset, password: 'short' }, { origin: 'http://localhost' }));
    await redeemSetupLink(h.app, `http://localhost/setup#${reset}`, 'another-password-for-the-log');
    await h.app.request('/v1/account-setup', send('POST', { token: reset, password: 'yet-another-password!' }, { origin: 'http://localhost' }));
    await h.app.request(`/admin/v1/users/${user.id}/disable`, send('POST'));
    await h.app.request(`/admin/v1/users/${user.id}/enable`, send('POST'));

    const text = h.logs.join('');
    expect(h.logs.length).toBeGreaterThan(0);
    for (const secret of [first, reset, 'a-password-for-the-log-test', 'another-password-for-the-log', 'yet-another-password!', '$argon2id$']) {
      expect(text).not.toContain(secret);
    }
  });
});
