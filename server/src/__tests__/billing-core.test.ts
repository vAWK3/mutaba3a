import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { entitlementsFor } from '../billing/coverage.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { buildMe } from '../routes/me.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-358 (ADR-160): `billing` on GET /v1/me for every profile, and the operator's grant and link routes. Nothing is
 * enforced yet (MUT-361); these pin what the server reports and what the operator can change, audited.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-11-01T09:00:00Z');
const DAY = 86_400_000;

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
  const email = `person${++seq}@studio.ps`;
  const body = firmId ? { email, displayName: 'Rana Saleh', organizationId: firmId, locale: 'en' } : { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' };
  const created = await provisionUser(h.app, body);
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const me = async () => read(await h.app.request('/v1/me', { headers: { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN } }));
  return { me, email, userId: created.user.id as string, personalId: created.personalProfile.id as string };
}

async function operatorFirm(h: Harness) {
  return (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
}

const billingOf = (me: Loose, profileId: string) => me.profiles.find((p: { id: string }) => p.id === profileId).billing;
const auditActions = async (h: Harness, organizationId: string) =>
  (await read(await h.app.request(`/admin/v1/organizations/${organizationId}/audit`, { headers: admin }))).events
    .map((e: { action: string }) => e.action)
    .filter((a: string) => a.startsWith('billing.'));

describe('GET /v1/me billing (AC3)', () => {
  it('reports each profile’s entitlement: a person provisioned after the backfill has no coverage yet', async () => {
    const h = harness();
    const u = await person(h);
    expect(billingOf(await u.me(), u.personalId)).toEqual({ state: 'READ_ONLY', source: 'NONE', tier: null, until: null });
  });

  it('follows a grant, a Stripe subscription and the trial, with ISO timestamps', async () => {
    const h = harness();
    const u = await person(h);
    await h.store.billing.setTrialStart(u.userId, new Date(NOW.getTime() - 2 * DAY));
    expect(billingOf(await u.me(), u.personalId)).toEqual({ state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: new Date(NOW.getTime() + 12 * DAY).toISOString() });

    const periodEnd = new Date(NOW.getTime() + 20 * DAY);
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_A1', userId: u.userId, country: 'IL', currency: 'ILS' });
    await h.store.billing.saveSubscription({
      stripeCustomerId: 'cus_A1',
      stripeSubscriptionId: 'sub_A1',
      tier: 'FREELANCER',
      organizationId: null,
      status: 'past_due',
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      priceLookupKey: 'freelancer_founder_monthly_ils',
      founderUntil: null,
      stripeUpdatedAt: NOW,
    });
    expect(billingOf(await u.me(), u.personalId)).toEqual({ state: 'GRACE', source: 'STRIPE', tier: 'FREELANCER', until: periodEnd.toISOString() });

    await h.app.request('/admin/v1/billing/grants', json({ userId: u.userId, tier: 'FREELANCER', reason: 'pilot' }, admin));
    expect(billingOf(await u.me(), u.personalId)).toMatchObject({ state: 'ACTIVE', source: 'OPERATOR' });
  });

  it('a Malafat-connected firm is covered by Malafat for every member', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    const u = await person(h, firm.id);
    await h.store.integrations.connect({ organizationId: firm.id, provider: 'MALAFAT', externalTenantId: `t-${++seq}`, displayName: 'Firm', connectedByApiKeyId: null, at: NOW } as Loose);
    expect(billingOf(await u.me(), firm.id)).toEqual({ state: 'ACTIVE', source: 'MALAFAT', tier: null, until: null });
  });

  it('is null in the portal’s signed-out mode (no billing applies)', async () => {
    const h = harness();
    const u = await person(h);
    const user = await h.store.users.getById(u.userId);
    const me = await buildMe(h.store, user!, null, null);
    expect(me.profiles.every((p) => p.billing === null)).toBe(true);
  });

  it('reads billing once for all of a person’s profiles (brief §2.3)', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    const u = await person(h, firm.id);
    const spy = vi.spyOn(h.store.billing, 'factsFor');
    const organizations = await Promise.all([firm.id, u.personalId].map((id) => h.store.organizations.getById(id)));
    await entitlementsFor(h.store, organizations.map((organization) => ({ organization: organization!, malafatConnected: false })), NOW);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the local-mode snapshot (review R1)', () => {
  it('never carries billing state, so the shipped local format is unchanged', async () => {
    const store = new MemoryLedgerStore();
    const maps = Object.keys(store.snapshot().maps);
    expect(maps.filter((name) => /billing|grant|trial/i.test(name))).toEqual([]);
  });
});

describe('POST /admin/v1/billing/grants (AC4)', () => {
  it('grants a person by email; audited on each profile they own, not on a firm they belong to', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    const u = await person(h, firm.id);
    const res = await h.app.request('/admin/v1/billing/grants', json({ userEmail: u.email.toUpperCase(), tier: 'FREELANCER', reason: 'pilot P01' }, admin));
    expect(res.status).toBe(201);
    expect(await read(res)).toMatchObject({ userId: u.userId, organizationId: null, tier: 'FREELANCER', reason: 'pilot P01', expiresAt: null, grantedBy: 'admin', revokedAt: null });
    expect(await auditActions(h, u.personalId)).toEqual(['billing.grant_created']);
    expect(await auditActions(h, firm.id)).toEqual([]);
  });

  it('grants one profile until a date; audited on that profile', async () => {
    const h = harness();
    const firm = await operatorFirm(h);
    const expiresAt = new Date(NOW.getTime() + 30 * DAY).toISOString();
    const res = await h.app.request('/admin/v1/billing/grants', json({ organizationId: firm.id, tier: 'FIRM', reason: 'pilot firm', expiresAt }, admin));
    expect(res.status).toBe(201);
    expect(await read(res)).toMatchObject({ organizationId: firm.id, tier: 'FIRM', expiresAt });
    expect(await auditActions(h, firm.id)).toEqual(['billing.grant_created']);
  });

  it('refuses two targets, a past expiry, an unknown person or profile, and a missing admin token', async () => {
    const h = harness();
    const u = await person(h);
    const post = (body: unknown, headers = admin) => h.app.request('/admin/v1/billing/grants', json(body, headers));
    expect((await post({ userId: u.userId, organizationId: u.personalId, tier: 'FIRM', reason: 'x' })).status).toBe(422);
    expect((await post({ userId: u.userId, tier: 'FIRM', reason: 'x', expiresAt: new Date(NOW.getTime() - DAY).toISOString() })).status).toBe(422);
    expect((await post({ userEmail: 'nobody@studio.ps', tier: 'FIRM', reason: 'x' })).status).toBe(404);
    expect((await post({ organizationId: '00000000-0000-4000-8000-000000000000', tier: 'FIRM', reason: 'x' })).status).toBe(404);
    expect((await post({ userId: u.userId, tier: 'FIRM', reason: 'x' }, {} as typeof admin)).status).toBe(401);
  });
});

describe('DELETE /admin/v1/billing/grants/{grantId} and the listing', () => {
  it('revokes once (kept, revokedAt set, audited once) and lists active grants only when asked', async () => {
    const h = harness();
    const u = await person(h);
    const grant = await read(await h.app.request('/admin/v1/billing/grants', json({ userId: u.userId, tier: 'FREELANCER', reason: 'pilot' }, admin)));
    const revoke = () => h.app.request(`/admin/v1/billing/grants/${grant.id}`, { method: 'DELETE', headers: admin });
    const first = await revoke();
    expect(first.status).toBe(200);
    expect(await read(first)).toMatchObject({ revoked: true, grant: { id: grant.id, revokedAt: NOW.toISOString() } });
    expect(await read(await revoke())).toMatchObject({ revoked: false });
    expect(await auditActions(h, u.personalId)).toEqual(['billing.grant_revoked', 'billing.grant_created']);

    const list = async (query: string) => (await read(await h.app.request(`/admin/v1/billing/grants?${query}`, { headers: admin }))).grants;
    expect(await list(`userId=${u.userId}`)).toHaveLength(1);
    expect(await list(`userId=${u.userId}&active=true`)).toEqual([]);
    expect((await h.app.request('/admin/v1/billing/grants/00000000-0000-4000-8000-000000000000', { method: 'DELETE', headers: admin })).status).toBe(404);
  });
});

describe('POST /admin/v1/billing/accounts/link and the unlinked listing (AC4)', () => {
  it('creates and links a new customer (currency needed), audits it, and is a no-op the second time', async () => {
    const h = harness();
    const u = await person(h);
    const link = (body: Record<string, unknown>) => h.app.request('/admin/v1/billing/accounts/link', json({ stripeCustomerId: 'cus_P01', userEmail: u.email, ...body }, admin));
    expect((await link({})).status).toBe(422);
    const first = await link({ currency: 'ILS' });
    expect(first.status).toBe(200);
    expect(await read(first)).toMatchObject({ linked: true, account: { stripeCustomerId: 'cus_P01', userId: u.userId, currency: 'ILS' } });
    expect(await read(await link({}))).toMatchObject({ linked: false });
    expect(await auditActions(h, u.personalId)).toEqual(['billing.account_linked']);
  });

  it('lists customers still to be matched, then links one the webhook stored', async () => {
    const h = harness();
    const u = await person(h);
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_UNMATCHED', userId: null, country: 'JO', currency: 'USD' });
    const unlinked = async () => (await read(await h.app.request('/admin/v1/billing/accounts?linked=false', { headers: admin }))).accounts;
    expect((await unlinked()).map((a: { stripeCustomerId: string }) => a.stripeCustomerId)).toEqual(['cus_UNMATCHED']);
    const res = await h.app.request('/admin/v1/billing/accounts/link', json({ stripeCustomerId: 'cus_UNMATCHED', userId: u.userId }, admin));
    expect(await read(res)).toMatchObject({ linked: true, account: { userId: u.userId, currency: 'USD', country: 'JO' } });
    expect(await unlinked()).toEqual([]);
  });

  it('refuses a customer linked to someone else, or a person who already has another customer (409)', async () => {
    const h = harness();
    const a = await person(h);
    const b = await person(h);
    const link = (customer: string, userId: string) => h.app.request('/admin/v1/billing/accounts/link', json({ stripeCustomerId: customer, userId, currency: 'USD' }, admin));
    await link('cus_A', a.userId);
    const elsewhere = await link('cus_A', b.userId);
    expect(elsewhere.status).toBe(409);
    expect((await read(elsewhere)).error.details).toMatchObject({ reason: 'CUSTOMER_LINKED_ELSEWHERE' });
    const another = await link('cus_B', a.userId);
    expect(another.status).toBe(409);
    expect((await read(another)).error.details).toMatchObject({ reason: 'USER_HAS_ANOTHER_ACCOUNT' });
    expect((await h.app.request('/admin/v1/billing/accounts/link', json({ stripeCustomerId: 'not-a-customer', userId: a.userId }, admin))).status).toBe(422);
  });
});
