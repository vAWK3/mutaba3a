import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { FakeAccountStripeGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-333 (ADR-188): Close my account and Keep my account through the real app — the password, the grace session,
 * Stripe's subscriptions (D1, R5–R7), the mail (D10), the lapse gate (a locked person can close), and the deadline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const JOB = { 'x-job-token': 'test-job-token-with-at-least-32-characters-long' };
const ORIGIN = 'http://localhost';
const T0 = new Date('2026-11-01T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST'): RequestInit => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

function harness(overrides: Partial<AppDependencies> = {}) {
  let now = T0;
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const transport = new MemoryMailTransport(() => now);
  const mailer = createMailer({ transport, store, logger, now: () => now, fromAddress: 'no-reply@mail.example.test', replyTo: 'help@example.test', limits: { daily: 500, securityReserve: 50, perRecipient: 10 } });
  const accountStripe = new FakeAccountStripeGateway();
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => now,
    mailer,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: false, trustedProxyHops: 1, deviceIdleDays: 400, deviceAbsoluteDays: 400, portalOrigin: ORIGIN },
    stripe: { webhookGateway: new FakeStripeGateway(() => now), reconcileGateway: new FakeStripeGateway(() => now), accountGateway: accountStripe },
    jobToken: JOB['x-job-token'],
    ...overrides,
  });
  return { app, store, transport, accountStripe, setNow: (at: Date) => void (now = at) };
}
type Harness = ReturnType<typeof harness>;

async function person(h: Harness, locale: 'en' | 'ar' = 'en') {
  const email = `close${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale });
  return { email, password: created.password as string, userId: created.user.id as string, personalId: created.personalProfile.id as string };
}

async function deviceSession(h: Harness, p: { email: string; password: string }) {
  const res = await h.app.request('/v1/device-sessions', json({ email: p.email, password: p.password }));
  return { status: res.status, auth: { authorization: `Bearer ${(await read(res)).token as string}` } };
}

const close = (h: Harness, auth: Record<string, string>, password: string) => h.app.request('/v1/me/closure', json({ password }, auth));
const keep = (h: Harness, auth: Record<string, string>) => h.app.request('/v1/me/closure', { method: 'DELETE', headers: auth });
const me = async (h: Harness, auth: Record<string, string>) => read(await h.app.request('/v1/me', { headers: auth }));

describe('POST /v1/me/closure (MUT-333)', () => {
  it('closes with the password: 30 days of grace, the closing on /v1/me, a mail naming the day', async () => {
    const h = harness();
    const p = await person(h);
    const { auth } = await deviceSession(h, p);
    const res = await close(h, auth, p.password);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ closure: { requestedAt: T0.toISOString(), deleteAfter: new Date(T0.getTime() + 30 * DAY).toISOString() }, subscriptionsEnded: 0, subscriptionsCancelled: 0 });
    expect((await me(h, auth)).user.closure).toEqual({ requestedAt: T0.toISOString(), deleteAfter: new Date(T0.getTime() + 30 * DAY).toISOString() });

    const [mail] = h.transport.list({ to: p.email }).filter((m) => m.template === 'account-closing');
    expect(mail).toMatchObject({ template: 'account-closing', locale: 'en', subject: 'Your MTB3A account will be deleted on December 1, 2026' });
    expect(mail!.text).toContain(`${ORIGIN}/`);
  });

  it('mails in the account’s language', async () => {
    const h = harness();
    const p = await person(h, 'ar');
    const { auth } = await deviceSession(h, p);
    expect((await close(h, auth, p.password)).status).toBe(200);
    expect(h.transport.list({ to: p.email }).find((m) => m.template === 'account-closing')).toMatchObject({ locale: 'ar' });
  });

  it('refuses a wrong password, counting it toward the lockout, and changes nothing', async () => {
    const h = harness();
    const p = await person(h);
    const { auth } = await deviceSession(h, p);
    const res = await close(h, auth, 'not the password');
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('CURRENT_PASSWORD_WRONG');
    expect((await h.store.users.getById(p.userId))?.failedSignIns).toBe(1);
    expect((await me(h, auth)).user.closure).toBeNull();
    expect(h.transport.list({ to: p.email }).filter((m) => m.template === 'account-closing')).toEqual([]);
  });

  it('signs out every other session, web and phone, and keeps this one for Keep my account', async () => {
    const h = harness();
    const p = await person(h);
    const phone = await deviceSession(h, p);
    const web = await deviceSession(h, p);
    expect((await close(h, web.auth, p.password)).status).toBe(200);
    expect((await h.app.request('/v1/me', { headers: phone.auth })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: web.auth })).status).toBe(200);
  });

  it('while closing, everything but Me, Keep my account and sign-out answers 403 ACCOUNT_CLOSING (D3, R8)', async () => {
    const h = harness();
    const p = await person(h);
    const { auth } = await deviceSession(h, p);
    await close(h, auth, p.password);
    const refused = async (path: string, init: RequestInit = {}) => {
      const res = await h.app.request(path, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });
      expect(res.status, path).toBe(403);
      const body = await read(res);
      expect(body.error.code).toBe('ACCOUNT_CLOSING');
      expect(body.error.details).toEqual({ deleteAfter: new Date(T0.getTime() + 30 * DAY).toISOString() });
    };
    await refused('/v1/customers', { headers: { 'x-mutaba3a-profile': p.personalId } });
    await refused('/v1/records-export', { headers: { 'x-mutaba3a-profile': p.personalId } });
    await refused('/v1/inbox');
    await refused('/v1/billing');
    await refused('/v1/me/closure', json({ password: p.password }));
    // Keep my account and Me still answer; so does sign-out.
    expect((await h.app.request('/v1/me', { headers: auth })).status).toBe(200);
    expect((await h.app.request('/v1/device-sessions/current', { method: 'DELETE', headers: auth })).status).toBeLessThan(300);
  });

  it('a phone signing in during the grace gets a session that sees only the closing (it may keep the account)', async () => {
    const h = harness();
    const p = await person(h);
    const first = await deviceSession(h, p);
    await close(h, first.auth, p.password);
    h.setNow(new Date(T0.getTime() + 10 * DAY));
    const later = await deviceSession(h, p);
    expect(later.status).toBe(201);
    expect((await me(h, later.auth)).user.closure).not.toBeNull();
    expect((await keep(h, later.auth)).status).toBe(200);
    expect((await me(h, later.auth)).user.closure).toBeNull();
  });

  it('ends paying subscriptions at the period end and cancels failing ones now, on every customer naming the person (D1, R5, R7)', async () => {
    const h = harness();
    const p = await person(h);
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_MIRROR', userId: p.userId, country: 'IL', currency: 'ILS', at: T0, linkAudit: [] });
    h.accountStripe
      .customer('cus_MIRROR', { email: p.email, userId: p.userId }, 1)
      .customer('cus_ABANDONED', { email: p.email, userId: p.userId }, 2)
      .customer('cus_SOMEONE', { email: p.email, userId: 'someone-else' })
      .subscription('sub_paying', 'cus_MIRROR', 'active')
      .subscription('sub_ending', 'cus_MIRROR', 'active', { cancelAtPeriodEnd: true })
      .subscription('sub_late', 'cus_ABANDONED', 'past_due')
      .subscription('sub_theirs', 'cus_SOMEONE', 'active');
    const { auth } = await deviceSession(h, p);
    const res = await close(h, auth, p.password);
    expect(await read(res)).toMatchObject({ subscriptionsEnded: 1, subscriptionsCancelled: 1 });
    expect(h.accountStripe.subscriptions.get('sub_paying')).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    expect(h.accountStripe.subscriptions.get('sub_late')?.status).toBe('canceled');
    expect(h.accountStripe.subscriptions.get('sub_ending')?.cancelAtPeriodEnd).toBe(true);
    expect(h.accountStripe.subscriptions.get('sub_theirs')).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
    expect(h.accountStripe.customers.get('cus_MIRROR')?.openCheckouts).toBe(0);
    expect(h.accountStripe.customers.get('cus_ABANDONED')?.openCheckouts).toBe(0);
    expect((await h.store.users.getById(p.userId))?.closure?.endedSubscriptionIds).toEqual(['sub_paying']);
  });

  it('when Stripe fails midway, turns back on what it changed and answers 502 with the account still open (R6)', async () => {
    const h = harness();
    const p = await person(h);
    h.accountStripe.customer('cus_A', { email: p.email, userId: p.userId }).subscription('sub_1', 'cus_A', 'active').subscription('sub_2', 'cus_A', 'active');
    h.accountStripe.failOn('setCancelAtPeriodEnd:sub_2');
    const { auth } = await deviceSession(h, p);
    const res = await close(h, auth, p.password);
    expect(res.status).toBe(502);
    expect((await read(res)).error.code).toBe('STRIPE_UNAVAILABLE');
    expect(h.accountStripe.subscriptions.get('sub_1')?.cancelAtPeriodEnd).toBe(false);
    expect((await me(h, auth)).user.closure).toBeNull();
  });

  it('refuses with 409 ACCOUNT_CLOSE_BLOCKED while a profile they created has other members and no co-owner (R18)', async () => {
    const h = harness();
    const p = await person(h);
    const other = await person(h);
    const created = await h.store.organizations.createOwned(p.userId, { name: 'Nour Firm', slug: `f-${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: T0 }, 6, { actorId: p.userId, requestId: null });
    if (created.kind !== 'created') throw new Error('cap');
    await h.store.organizations.setFirm(created.organization.id, { enabled: true, ownerUserIds: [] }, T0, { actorId: null, requestId: null });
    await h.store.memberships.grant(other.userId, created.organization.id, T0);
    const { auth } = await deviceSession(h, p);
    const res = await close(h, auth, p.password);
    expect(res.status).toBe(409);
    expect(await read(res)).toMatchObject({ error: { code: 'ACCOUNT_CLOSE_BLOCKED', details: { profiles: [{ id: created.organization.id, name: 'Nour Firm' }] } } });
    expect((await me(h, auth)).user.closure).toBeNull();
  });

  it('cancels a failing subscription only after the closing commits, and a failure there never changes the answer (R20)', async () => {
    const h = harness();
    const p = await person(h);
    h.accountStripe.customer('cus_A', { email: p.email, userId: p.userId }, 1).subscription('sub_late', 'cus_A', 'past_due');
    h.accountStripe.failOn('cancelNow');
    const { auth } = await deviceSession(h, p);
    const res = await close(h, auth, p.password);
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ subscriptionsEnded: 0, subscriptionsCancelled: 0 });
    expect((await me(h, auth)).user.closure).not.toBeNull();
    expect(h.accountStripe.customers.get('cus_A')?.openCheckouts).toBe(0);
  });

  it('refuses with 503 when the person has a Stripe customer and the server has no Stripe; anyone else closes', async () => {
    const h = harness({ stripe: null });
    const payer = await person(h);
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_X', userId: payer.userId, country: 'IL', currency: 'ILS', at: T0, linkAudit: [] });
    const payerSession = await deviceSession(h, payer);
    expect((await close(h, payerSession.auth, payer.password)).status).toBe(503);
    const other = await person(h);
    expect((await close(h, (await deviceSession(h, other)).auth, other.password)).status).toBe(200);
  });

  it('a locked person can close and keep their account (MUT-361: open in the lapse gate)', async () => {
    const h = harness({ billingGate: true });
    const p = await person(h);
    await h.store.billing.setTrialStart(p.userId, new Date(T0.getTime() - 31 * DAY));
    const { auth } = await deviceSession(h, p);
    expect((await me(h, auth)).billingStanding).toBe('locked');
    expect((await close(h, auth, p.password)).status).toBe(200);
    expect((await keep(h, auth)).status).toBe(200);
  });
});

describe('DELETE /v1/me/closure (MUT-333)', () => {
  it('keeps the account within the grace and turns back on only the subscriptions the closing ended (AC6, D1)', async () => {
    const h = harness();
    const p = await person(h);
    h.accountStripe.customer('cus_A', { email: p.email, userId: p.userId }).subscription('sub_mine', 'cus_A', 'active').subscription('sub_already', 'cus_A', 'active', { cancelAtPeriodEnd: true });
    const { auth } = await deviceSession(h, p);
    await close(h, auth, p.password);
    h.setNow(new Date(T0.getTime() + 29 * DAY));
    const res = await keep(h, auth);
    expect(await read(res)).toEqual({ billingNeedsAttention: false });
    expect(h.accountStripe.subscriptions.get('sub_mine')?.cancelAtPeriodEnd).toBe(false);
    expect(h.accountStripe.subscriptions.get('sub_already')?.cancelAtPeriodEnd).toBe(true);
    expect((await me(h, auth)).user.closure).toBeNull();
    expect((await h.app.request('/v1/customers', { headers: { ...auth, 'x-mutaba3a-profile': p.personalId } })).status).toBe(200);
  });

  it('says billing needs attention when a subscription can’t be turned back on', async () => {
    const h = harness();
    const p = await person(h);
    h.accountStripe.customer('cus_A', { email: p.email, userId: p.userId }).subscription('sub_mine', 'cus_A', 'active');
    const { auth } = await deviceSession(h, p);
    await close(h, auth, p.password);
    h.accountStripe.failOn('setCancelAtPeriodEnd');
    expect(await read(await keep(h, auth))).toEqual({ billingNeedsAttention: true });
    expect((await me(h, auth)).user.closure).toBeNull();
  });

  it('is idempotent for an account that is not closing', async () => {
    const h = harness();
    const p = await person(h);
    const { auth } = await deviceSession(h, p);
    expect(await read(await keep(h, auth))).toEqual({ billingNeedsAttention: false });
  });
});

describe('after the deadline (MUT-333 D5)', () => {
  it('the account no longer signs in, and its session is gone', async () => {
    const h = harness();
    const p = await person(h);
    const { auth } = await deviceSession(h, p);
    await close(h, auth, p.password);
    h.setNow(new Date(T0.getTime() + 30 * DAY));
    expect((await h.app.request('/v1/me', { headers: auth })).status).toBe(401);
    const res = await h.app.request('/v1/device-sessions', json({ email: p.email, password: p.password }));
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('INVALID_CREDENTIALS');
    expect((await h.store.users.getById(p.userId))?.failedSignIns).toBe(0);
  });
});

describe('the hard delete doors (MUT-333 D11)', () => {
  it('the hourly job needs the job token and answers counts; the operator can dry-run first', async () => {
    const h = harness();
    const p = await person(h);
    const { auth } = await deviceSession(h, p);
    // MUT-433 (C1): a flagged person's feature rows go with them.
    expect((await h.app.request(`/admin/v1/users/${p.userId}/features/agent_access`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
    await close(h, auth, p.password);
    h.setNow(new Date(T0.getTime() + 30 * DAY + 60_000));

    expect((await h.app.request('/jobs/v1/accounts/purge', { method: 'POST' })).status).toBe(401);
    expect((await h.app.request('/jobs/v1/accounts/purge', { method: 'POST', headers: ADMIN })).status).toBe(401);

    const dry = await read(await h.app.request('/admin/v1/accounts/purge', json({ dryRun: true }, ADMIN)));
    expect(dry.summary).toMatchObject({ dryRun: true, due: 1, purged: 1 });
    expect(dry.rows).toEqual([{ userId: p.userId, outcome: 'would-purge', reason: null, deleteProfileIds: [p.personalId], transfers: [], leaveProfileIds: [], blockedProfileIds: [], stripeCustomers: 0 }]);
    expect(await h.store.users.getById(p.userId)).not.toBeNull();

    const res = await h.app.request('/jobs/v1/accounts/purge', { method: 'POST', headers: JOB });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ dryRun: false, due: 1, purged: 1, failed: 0 });
    expect(await h.store.users.getById(p.userId)).toBeNull();
    expect((await h.store.features.holders('agent_access')).map((holder) => holder.userId)).not.toContain(p.userId);
    const signIn = await h.app.request('/v1/device-sessions', json({ email: p.email, password: p.password }));
    expect(signIn.status).toBe(401);
  });
});
