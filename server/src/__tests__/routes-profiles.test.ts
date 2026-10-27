import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { GENERAL_PRESET, PERSONAL_PRESET } from '../expenses/presets.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { MAX_OWNED_PROFILES } from '../routes/profiles.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-182: a signed-in person creates and manages their own standalone
 * profiles — POST /v1/profiles, PATCH /v1/profiles/{profileId} and the
 * type-change preview — and GET /v1/me tells every client which profiles
 * they own, of what type, at what version, and how many more they may make.
 * None of these routes name a profile in X-Mutaba3a-Profile: they act on the
 * person, like /v1/me.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

function harness(options: { maxOwnedProfiles?: number } = {}) {
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
    maxOwnedProfiles: options.maxOwnedProfiles,
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

async function firm(h: Harness, label = 'Firm') {
  return (await read(await h.app.request('/admin/v1/organizations', json({ name: `${label} ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
}

/** A signed-in person, optionally a member of `firmId` too. Their personal profile is created with them (MUT-120). */
async function person(h: Harness, options: { firmId?: string; locale?: 'en' | 'ar' } = {}) {
  const email = `owner${++seq}@studio.ps`;
  const body = options.firmId
    ? { email, displayName: 'Rana Saleh', organizationId: options.firmId, locale: options.locale ?? 'en' }
    : { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: options.locale ?? 'en' };
  const created = await provisionUser(h.app, body);
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const me = (extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN, ...extra });
  return { me, userId: created.user.id as string, personalId: created.personalProfile.id as string };
}

const STUDIO = { name: 'Design Studio', type: 'BUSINESS', defaultCurrency: 'USD', timezone: 'Europe/Berlin' };

async function setup(options: { firmId?: string; locale?: 'en' | 'ar' } = {}) {
  const h = harness();
  const u = await person(h, options);
  const create = (body: Record<string, unknown> = STUDIO, headers: Record<string, string> = idem()) => h.app.request('/v1/profiles', json(body, u.me(headers)));
  const patch = (id: string, body: Record<string, unknown>, version: number | string = 1) => h.app.request(`/v1/profiles/${id}`, json(body, u.me({ 'if-match': String(version) }), 'PATCH'));
  const preview = (id: string, to: string) => h.app.request(`/v1/profiles/${id}/type-change?to=${to}`, { headers: u.me() });
  const me = async () => read(await h.app.request('/v1/me', { headers: u.me() }));
  return { h, u, create, patch, preview, me };
}

describe('POST /v1/profiles', () => {
  it('creates a standalone profile the caller owns, as /v1/me would list it (R1)', async () => {
    const { h, u, create } = await setup();
    const res = await create();
    expect(res.status).toBe(201);
    const profile = await read(res);
    expect(profile).toMatchObject({
      name: 'Design Studio',
      source: 'hosted',
      defaultCurrency: 'USD',
      timezone: 'Europe/Berlin',
      writerOfRecord: null,
      type: 'BUSINESS',
      owned: true,
      isPersonalDefault: false,
      version: 1,
      income: { received: true, owed: true, customer: 'optional' },
      access: expect.objectContaining({ customers: 'read-write', projects: 'read-write', payments: 'read-write', expenses: 'read-write' }),
    });
    expect(await h.store.memberships.find(u.userId, profile.id)).not.toBeNull();
    expect(await h.store.organizations.getById(profile.id)).toMatchObject({ ownerUserId: u.userId, profileType: 'BUSINESS', personalOwnerUserId: null });
  });

  it('refuses a SAR profile, and moving a profile to QAR (MUT-388)', async () => {
    const { create, patch } = await setup();
    expect((await create({ ...STUDIO, defaultCurrency: 'SAR' })).status).toBe(422);
    const created = await read(await create({ ...STUDIO, defaultCurrency: 'JOD' }));
    expect((await patch(created.id, { defaultCurrency: 'QAR' })).status).toBe(422);
  });

  it('replays the same key and body, and refuses the same key with another body (R2)', async () => {
    const { h, u, create } = await setup();
    const key = idem();
    const first = await read(await create(STUDIO, key));
    const again = await create(STUDIO, key);
    expect(again.status).toBe(201);
    expect((await read(again)).id).toBe(first.id);
    expect(await h.store.organizations.countOwnedBy(u.userId)).toBe(2);
    const other = await create({ ...STUDIO, name: 'Another' }, key);
    expect(other.status).toBe(422);
    expect((await read(other)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await create(STUDIO, {})).status).toBe(422);
  });

  it.each([
    ['an empty name', { ...STUDIO, name: '   ' }],
    ['a name past 80 characters', { ...STUDIO, name: 'x'.repeat(81) }],
    ['an unknown type', { ...STUDIO, type: 'FIRM' }],
    ['an unsupported currency', { ...STUDIO, defaultCurrency: 'GBP' }],
    ['a zone that is not IANA', { ...STUDIO, timezone: 'Jerusalem' }],
    ['an unknown field', { ...STUDIO, writerOfRecord: 'MALAFAT' }],
    ['a missing type', { name: 'X', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }],
  ])('refuses %s (R3)', async (_label, body) => {
    const { create } = await setup();
    const res = await create(body);
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('VALIDATION_FAILED');
  });

  it('audits the new profile and its membership as the person who made them (R4)', async () => {
    const { h, u, create } = await setup();
    const profile = await read(await create());
    const events = await h.store.audit.listByOrganization(profile.id, 50);
    const actions = events.map((e: Loose) => [e.action, e.actorType, e.actorId]);
    expect(actions).toEqual(expect.arrayContaining([
      ['organization.created', 'USER', u.userId],
      ['membership.granted', 'USER', u.userId],
    ]));
    expect(events.find((e: Loose) => e.action === 'organization.created')?.metadata).toEqual({ owned: true, profileType: 'BUSINESS' });
  });

  it(`stops at ${MAX_OWNED_PROFILES} owned profiles, the personal one counted, and a firm not (R5)`, async () => {
    const f = harness();
    const theFirm = await firm(f);
    const h = f;
    const u = await person(h, { firmId: theFirm.id });
    for (let i = 1; i < MAX_OWNED_PROFILES; i++) expect((await h.app.request('/v1/profiles', json(STUDIO, u.me(idem())))).status).toBe(201);
    const refused = await h.app.request('/v1/profiles', json(STUDIO, u.me(idem())));
    expect(refused.status).toBe(409);
    expect((await read(refused)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'PROFILE_LIMIT', limit: MAX_OWNED_PROFILES } });
    expect(await h.store.organizations.countOwnedBy(u.userId)).toBe(MAX_OWNED_PROFILES);
  });

  it('stops at the local QA override instead, and /v1/me publishes it (MUT-474)', async () => {
    const h = harness({ maxOwnedProfiles: MAX_OWNED_PROFILES + 2 });
    const u = await person(h);
    for (let i = 1; i < MAX_OWNED_PROFILES + 2; i++) expect((await h.app.request('/v1/profiles', json(STUDIO, u.me(idem())))).status).toBe(201);
    const refused = await h.app.request('/v1/profiles', json(STUDIO, u.me(idem())));
    expect(refused.status).toBe(409);
    expect((await read(refused)).error).toMatchObject({ details: { reason: 'PROFILE_LIMIT', limit: MAX_OWNED_PROFILES + 2 } });
    const me = await read(await h.app.request('/v1/me', { headers: u.me() }));
    expect(me.limits).toEqual({ ownedProfiles: MAX_OWNED_PROFILES + 2, maxOwnedProfiles: MAX_OWNED_PROFILES + 2 });
  });

  it('accepts a device session, so the phone can create one too (FC1)', async () => {
    const h = harness();
    const email = `phone${++seq}@studio.ps`;
    const created = await provisionUser(h.app, { email, displayName: 'Rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const device = await read(await h.app.request('/v1/device-sessions', json({ email, password: created.password })));
    const res = await h.app.request('/v1/profiles', json(STUDIO, { authorization: `Bearer ${device.token}`, ...idem() }));
    expect(res.status).toBe(201);
  });
});

describe('PATCH /v1/profiles/{profileId}', () => {
  it('renames and changes the default currency under If-Match, leaving records in their own currency (R6, R7)', async () => {
    const { h, u, create, patch } = await setup();
    const profile = await read(await create());
    const on = (extra: Record<string, string> = {}) => u.me({ 'x-mutaba3a-profile': profile.id, ...extra });
    const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, on(idem()))));
    const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Logo', currency: 'USD' }, on(idem()))));
    const res = await patch(profile.id, { name: 'Renamed', defaultCurrency: 'ILS' });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ profile: expect.objectContaining({ id: profile.id, name: 'Renamed', defaultCurrency: 'ILS', version: 2 }), typeChange: null });
    // The default only seeds new records; one made before keeps its own currency.
    expect((await read(await h.app.request(`/v1/projects/${project.id}`, { headers: on() }))).currency).toBe('USD');
  });

  it('answers 409 VERSION_MISMATCH to a stale If-Match, and 422 to a missing one (R8)', async () => {
    const { create, patch } = await setup();
    const profile = await read(await create());
    await patch(profile.id, { name: 'First' });
    const stale = await patch(profile.id, { name: 'Second' }, 1);
    expect(stale.status).toBe(409);
    expect((await read(stale)).error.details).toMatchObject({ reason: 'VERSION_MISMATCH', currentVersion: 2 });
    expect((await patch(profile.id, { name: 'Third' }, 'abc')).status).toBe(422);
  });

  it('refuses an empty body', async () => {
    const { create, patch } = await setup();
    const profile = await read(await create());
    expect((await patch(profile.id, {})).status).toBe(422);
  });

  it('changes the type: categories replaced in the user’s language, categorized expenses cleared (R9)', async () => {
    const { h, u, create, patch } = await setup({ locale: 'ar' });
    const profile = await read(await create({ ...STUDIO, type: 'PERSONAL' }));
    const on = (extra: Record<string, string> = {}) => u.me({ 'x-mutaba3a-profile': profile.id, ...extra });
    const categories = await read(await h.app.request('/v1/expense-categories', { headers: on() }));
    expect(categories.items.map((c: Loose) => c.name)).toEqual(PERSONAL_PRESET.map((c) => c.nameAr));
    const expense = await read(await h.app.request('/v1/expenses', json({ amount: '50.00', currency: 'USD', occurredOn: '2026-10-10', categoryId: categories.items[0].id }, on(idem()))));

    const res = await patch(profile.id, { type: 'BUSINESS' });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ profile: { type: 'BUSINESS', version: 2 }, typeChange: { uncategorizedExpenses: 1, deletedCategories: PERSONAL_PRESET.length, preset: 'general' } });
    const after = await read(await h.app.request('/v1/expense-categories', { headers: on() }));
    expect(after.items.map((c: Loose) => c.name)).toEqual(GENERAL_PRESET.map((c) => c.nameAr));
    expect(await read(await h.app.request(`/v1/expenses/${expense.id}`, { headers: on() }))).toMatchObject({ categoryId: null, version: 2 });

    const events = await h.store.audit.listByOrganization(profile.id, 50);
    expect(events.find((e: Loose) => e.action === 'organization.type_changed')).toMatchObject({
      actorType: 'USER',
      metadata: { from: 'PERSONAL', to: 'BUSINESS', uncategorizedExpenses: 1, deletedCategories: PERSONAL_PRESET.length, preset: 'general' },
    });
    expect(events.find((e: Loose) => e.action === 'expense_category.seeded')).toMatchObject({ actorType: 'SYSTEM', metadata: { preset: 'general', count: GENERAL_PRESET.length, locale: 'ar' } });
  });

  it('applies a rename and a type change together, with one version bump (R16, D4)', async () => {
    const { create, patch } = await setup();
    const profile = await read(await create());
    const res = await patch(profile.id, { name: 'Household', type: 'PERSONAL' });
    expect(await read(res)).toMatchObject({ profile: { name: 'Household', type: 'PERSONAL', version: 2 }, typeChange: { preset: 'personal' } });
  });

  it('answers 404 to a profile the caller is not a member of, and 403 NOT_OWNER on a firm they belong to (R11)', async () => {
    const h = harness();
    const theFirm = await firm(h);
    const u = await person(h, { firmId: theFirm.id });
    const stranger = await person(h);
    const send = (id: string) => h.app.request(`/v1/profiles/${id}`, json({ name: 'Mine' }, u.me({ 'if-match': '1' }), 'PATCH'));
    expect((await send(stranger.personalId)).status).toBe(404);
    expect((await send('00000000-0000-4000-8000-0000000000aa')).status).toBe(404);
    const notOwner = await send(theFirm.id);
    expect(notOwner.status).toBe(403);
    expect((await read(notOwner)).error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { reason: 'NOT_OWNER' } });
    expect((await h.store.organizations.getById(theFirm.id))?.name).toMatch(/^Firm/);
  });

  it('lets the built-in personal profile be renamed but never retyped (R15, D2)', async () => {
    const { h, u, patch } = await setup();
    const retype = await patch(u.personalId, { type: 'BUSINESS' });
    expect(retype.status).toBe(409);
    expect((await read(retype)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'DEFAULT_PERSONAL_PROFILE' } });
    expect(await h.store.organizations.getById(u.personalId)).toMatchObject({ profileType: 'PERSONAL', version: 1 });
    const rename = await patch(u.personalId, { name: 'Home', defaultCurrency: 'USD', type: 'PERSONAL' });
    expect(rename.status).toBe(200);
    expect(await read(rename)).toMatchObject({ profile: { name: 'Home', defaultCurrency: 'USD', isPersonalDefault: true, type: 'PERSONAL' }, typeChange: null });
  });
});

describe('GET /v1/profiles/{profileId}/type-change', () => {
  it('previews exactly what the change then does, and nothing for the current type (R10)', async () => {
    const { h, u, create, preview, patch } = await setup();
    const profile = await read(await create());
    const on = (extra: Record<string, string> = {}) => u.me({ 'x-mutaba3a-profile': profile.id, ...extra });
    const categories = await read(await h.app.request('/v1/expense-categories', { headers: on() }));
    for (const i of [0, 1]) await h.app.request('/v1/expenses', json({ amount: '10.00', currency: 'USD', occurredOn: '2026-10-10', categoryId: categories.items[i].id }, on(idem())));
    await h.app.request('/v1/expenses', json({ amount: '10.00', currency: 'USD', occurredOn: '2026-10-10' }, on(idem())));

    const same = await preview(profile.id, 'BUSINESS');
    expect(await read(same)).toEqual({ uncategorizedExpenses: 0, deletedCategories: 0, preset: 'general' });
    const shown = await read(await preview(profile.id, 'PERSONAL'));
    expect(shown).toEqual({ uncategorizedExpenses: 2, deletedCategories: GENERAL_PRESET.length, preset: 'personal' });
    const done = await read(await patch(profile.id, { type: 'PERSONAL' }));
    expect(done.typeChange).toEqual(shown);
  });

  it('refuses to preview a change PATCH would refuse: the built-in personal profile, and a firm the caller only belongs to', async () => {
    const h = harness();
    const theFirm = await firm(h);
    const u = await person(h, { firmId: theFirm.id });
    const personal = await h.app.request(`/v1/profiles/${u.personalId}/type-change?to=BUSINESS`, { headers: u.me() });
    expect(personal.status).toBe(409);
    expect((await read(personal)).error.details).toMatchObject({ reason: 'DEFAULT_PERSONAL_PROFILE' });
    expect((await h.app.request(`/v1/profiles/${u.personalId}/type-change?to=PERSONAL`, { headers: u.me() })).status).toBe(200);
    const onFirm = await h.app.request(`/v1/profiles/${theFirm.id}/type-change?to=BUSINESS`, { headers: u.me() });
    expect(onFirm.status).toBe(403);
    expect((await read(onFirm)).error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { reason: 'NOT_OWNER' } });
  });

  it('answers 404 off-limits and 422 without a target type', async () => {
    const { h, preview, create } = await setup();
    const other = await person(h);
    expect((await preview(other.personalId, 'BUSINESS')).status).toBe(404);
    const mine = await read(await create());
    expect((await preview(mine.id, 'FIRM')).status).toBe(422);
  });
});

describe('GET /v1/me (MUT-182 fields)', () => {
  it('marks owned profiles, their type and version, orders firms → created → personal, and counts toward the cap (R13)', async () => {
    const h = harness();
    const theFirm = await firm(h);
    const u = await person(h, { firmId: theFirm.id });
    const created = [];
    for (const name of ['First', 'Second']) created.push(await read(await h.app.request('/v1/profiles', json({ ...STUDIO, name }, u.me(idem())))));
    const me = await read(await h.app.request('/v1/me', { headers: u.me() }));
    expect(me.profiles.map((p: Loose) => [p.id, p.owned, p.type, p.isPersonalDefault])).toEqual([
      [theFirm.id, false, null, false],
      [created[0].id, true, 'BUSINESS', false],
      [created[1].id, true, 'BUSINESS', false],
      [u.personalId, true, 'PERSONAL', true],
    ]);
    expect(me.profiles.every((p: Loose) => p.version === 1)).toBe(true);
    expect(me.limits).toEqual({ ownedProfiles: 3, maxOwnedProfiles: MAX_OWNED_PROFILES });
  });
});

describe('GET /v1/me ordering and the old-revision shape', () => {
  it('lists created profiles oldest first (membership order), whatever their names', async () => {
    const h = harness();
    const u = await person(h);
    const zed = await read(await h.app.request('/v1/profiles', json({ ...STUDIO, name: 'Zed' }, u.me(idem()))));
    h.clock.now = new Date('2026-10-14T10:00:00Z');
    const alpha = await read(await h.app.request('/v1/profiles', json({ ...STUDIO, name: 'Alpha' }, u.me(idem()))));
    const me = await read(await h.app.request('/v1/me', { headers: u.me() }));
    expect(me.profiles.map((p: Loose) => p.id)).toEqual([zed.id, alpha.id, u.personalId]);
  });

  it('still shows a personal profile the old revision wrote without an owner as owned and PERSONAL (qa-reconcile D1)', async () => {
    const h = harness();
    const u = await person(h);
    const row = (h.store as unknown as { orgs: Map<string, { ownerUserId: string | null; profileType: string | null }> }).orgs.get(u.personalId)!;
    Object.assign(row, { ownerUserId: null, profileType: null });
    const me = await read(await h.app.request('/v1/me', { headers: u.me() }));
    expect(me.profiles).toEqual([expect.objectContaining({ id: u.personalId, owned: true, type: 'PERSONAL', isPersonalDefault: true })]);
    expect(me.limits.ownedProfiles).toBe(1);
    // Its owner can still rename it, which stamps it.
    const renamed = await h.app.request(`/v1/profiles/${u.personalId}`, json({ name: 'Home' }, u.me({ 'if-match': '1' }), 'PATCH'));
    expect(renamed.status).toBe(200);
    expect(row).toMatchObject({ ownerUserId: u.userId, profileType: 'PERSONAL' });
  });
});

describe('the first category list on an unstamped personal profile', () => {
  it('seeds the personal preset, not the general one (re-review: D1 left this door open)', async () => {
    const h = harness();
    const u = await person(h);
    const row = (h.store as unknown as { orgs: Map<string, { ownerUserId: string | null; profileType: string | null }> }).orgs.get(u.personalId)!;
    Object.assign(row, { ownerUserId: null, profileType: null });
    const categories = await read(await h.app.request('/v1/expense-categories', { headers: u.me({ 'x-mutaba3a-profile': u.personalId }) }));
    expect(categories.items.map((c: Loose) => c.name)).toEqual(PERSONAL_PRESET.map((c) => c.name));
  });
});

describe('an owned BUSINESS profile is written exactly like the personal one (R14, AC A3)', () => {
  it('takes customers, projects, income (received and owed), a settle and an expense from its owner’s session', async () => {
    const { h, u, create } = await setup();
    const profile = await read(await create({ ...STUDIO, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }));
    const on = (extra: Record<string, string> = {}) => u.me({ 'x-mutaba3a-profile': profile.id, ...extra });
    const customer = await h.app.request('/v1/customers', json({ name: 'Haddad' }, on(idem())));
    expect(customer.status).toBe(201);
    const customerId = (await read(customer)).id;
    expect((await h.app.request('/v1/projects', json({ customerId, name: 'Logo', currency: 'ILS' }, on(idem())))).status).toBe(201);
    expect((await h.app.request('/v1/income', json({ kind: 'received', amount: '100.00', currency: 'ILS', occurredOn: '2026-10-13', customerId }, on(idem())))).status).toBe(201);
    const owed = await h.app.request('/v1/income', json({ kind: 'owed', amount: '250.00', currency: 'ILS', occurredOn: '2026-10-13', customerId }, on(idem())));
    expect(owed.status).toBe(201);
    const receivableId = (await read(owed)).id;
    expect((await h.app.request(`/v1/receivables/${receivableId}/settle`, json({}, on(idem())))).status).toBe(201);
    expect((await h.app.request('/v1/expenses', json({ amount: '30.00', currency: 'ILS', occurredOn: '2026-10-13' }, on(idem())))).status).toBe(201);
  });
});
