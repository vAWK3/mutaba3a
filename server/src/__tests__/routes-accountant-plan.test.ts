import { describe, expect, it, vi } from 'vitest';
import { SESSION_ORGANIZATION_INDEPENDENT_ROUTES } from '../app.js';
import { buildRouteAccessIndex } from '../auth/middleware.js';
import { accountantMayRead } from '../auth/writability.js';
import { parseBillingCountries } from '../billing/checkout.js';
import { FakeCheckoutGateway, FakePlanGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { buildMe } from '../routes/me.js';
import { closureDeadline } from '../accounts/closure.js';
import {
  ADMIN,
  DAY,
  T0,
  acceptInvite,
  accountantHarness,
  businessOf,
  expenseOn,
  inviteAccountant,
  inviteTokenFor,
  json,
  person,
  read,
  shared,
  signupFromInvite,
  type AccountantHarness,
  type Loose,
  type Person,
} from './helpers/accountants.js';

/**
 * MUT-565 (ADR-251): the Accountant plan through the real app. Free up to 3 client books; the 4th accept answers 402
 * ACCOUNTANT_PLAN_REQUIRED and leaves the invite PENDING; on lapse the 3 oldest stay readable and the rest answer 402 at
 * selectProfile; /v1/me carries `clientBooks` and rows `needsPlan`; the plan never covers the accountant's own profile;
 * Checkout sells it monthly on its own lookup keys. Plan state is seeded with operator grants and the Stripe mirror.
 * Numbers in the describe names are the plan's tests.
 */
const PLAN_ON = { on: true, freeClients: 3, maxClients: 100 };
const COUNTRIES = parseBillingCountries({ consumerCountries: ['IL', 'GB'], customTaxIdCountries: ['IL', 'JO'] });

function planHarness(options: { on?: boolean; maxClients?: number; checkout?: FakeCheckoutGateway; plan?: FakePlanGateway } = {}) {
  const stripe = new FakeStripeGateway(() => T0);
  return accountantHarness({
    accountantPlan: { ...PLAN_ON, on: options.on ?? true, maxClients: options.maxClients ?? 100 },
    billingCountries: COUNTRIES,
    ...(options.checkout || options.plan
      ? { stripe: { webhookGateway: stripe, reconcileGateway: stripe, checkoutGateway: options.checkout ?? new FakeCheckoutGateway(), ...(options.plan ? { planGateway: options.plan } : {}) } }
      : {}),
  });
}

const later = (h: AccountantHarness, ms = 60_000) => h.setNow(new Date(h.now().getTime() + ms));
const me = async (h: AccountantHarness, p: Person) => read(await h.app.request('/v1/me', { headers: p.auth }));

/** A fresh owner's Business profile, shared with `accountant`, a minute after the last. */
async function client(h: AccountantHarness, accountant: Person, name: string): Promise<{ owner: Person; profileId: string }> {
  later(h);
  const owner = await person(h, { displayName: `Owner ${name}` });
  const profileId = await businessOf(h, owner, name);
  await expenseOn(h, owner, profileId, `${name} paper`);
  await shared(h, owner, profileId, accountant);
  return { owner, profileId };
}

/** An invite to `accountant` on a fresh profile, not yet accepted; its token. */
async function pendingInvite(h: AccountantHarness, accountant: Person, name = 'Fourth Studio') {
  later(h);
  const owner = await person(h);
  const profileId = await businessOf(h, owner, name);
  expect((await inviteAccountant(h, owner, profileId, accountant.email)).status).toBe(201);
  return { owner, profileId, token: inviteTokenFor(h, accountant.email) };
}

const grantPlan = async (h: AccountantHarness, userId: string, extra: Record<string, unknown> = {}) => {
  const res = await h.app.request('/admin/v1/billing/grants', json({ userId, tier: 'ACCOUNTANT', reason: 'pilot accountant', ...extra }, ADMIN));
  expect(res.status).toBe(201);
  return (await read(res)).id as string;
};
const revokePlan = async (h: AccountantHarness, grantId: string) => expect((await h.app.request(`/admin/v1/billing/grants/${grantId}`, { method: 'DELETE', headers: ADMIN })).status).toBe(200);

async function subscribe(h: AccountantHarness, userId: string, tier: 'ACCOUNTANT' | 'FREELANCER', status = 'active', key = tier === 'ACCOUNTANT' ? 'accountant_list_monthly_ils' : 'freelancer_list_monthly_ils') {
  const customer = `cus_${userId.slice(0, 8)}`;
  await h.store.billing.saveAccount({ stripeCustomerId: customer, userId, country: 'IL', currency: 'ILS', at: h.now(), linkAudit: [] });
  await h.store.billing.saveSubscription({
    stripeCustomerId: customer,
    stripeSubscriptionId: `sub_${tier}_${userId.slice(0, 8)}_${status}`,
    tier,
    organizationId: null,
    status,
    currentPeriodEnd: new Date(h.now().getTime() + 20 * DAY),
    cancelAtPeriodEnd: false,
    priceLookupKey: key,
    founderUntil: null,
    stripeUpdatedAt: h.now(),
    at: h.now(),
    audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
  });
  return customer;
}

describe('4. accept: the cap, atomically, and the invite stays PENDING (MUT-565)', () => {
  it('3 ACTIVE and no plan: the 4th accept is 402 with details; the invite is still PENDING; it accepts once a grant appears', async () => {
    const h = planHarness();
    const acc = await person(h, { displayName: 'Hadi Accountant' });
    for (const n of ['One', 'Two', 'Three']) await client(h, acc, n);
    const fourth = await pendingInvite(h, acc);

    const refused = await acceptInvite(h, acc, fourth.token);
    expect(refused.status).toBe(402);
    const body = await read(refused);
    expect(body.error.code).toBe('ACCOUNTANT_PLAN_REQUIRED');
    expect(body.error.details).toEqual({ freeLimit: 3, active: 3, inviteExpiresAt: expect.any(String) });
    const grants = (await read(await h.app.request(`/v1/profiles/${fourth.profileId}/accountants`, { headers: fourth.owner.auth }))).items as Loose[];
    expect(grants.map((g) => g.status)).toEqual(['pending']);

    await grantPlan(h, acc.userId);
    const accepted = await acceptInvite(h, acc, fourth.token);
    expect(accepted.status).toBe(200);
    expect(await read(accepted)).toMatchObject({ profileId: fourth.profileId, status: 'active', needsPlan: false });
  });

  it('plan ACTIVE or GRACE accepts the 4th; LAPSED is 402', async () => {
    for (const [status, code] of [['active', 200], ['past_due', 200], ['canceled', 402]] as const) {
      const h = planHarness();
      const acc = await person(h);
      for (const n of ['One', 'Two', 'Three']) await client(h, acc, n);
      await subscribe(h, acc.userId, 'ACCOUNTANT', status);
      expect((await acceptInvite(h, acc, (await pendingInvite(h, acc)).token)).status).toBe(code);
    }
  });

  it('pending invites and ended clients never count; a leave frees a place', async () => {
    const h = planHarness();
    const acc = await person(h);
    const one = await client(h, acc, 'One');
    await client(h, acc, 'Two');
    await pendingInvite(h, acc, 'Pending A');
    await pendingInvite(h, acc, 'Pending B');
    await client(h, acc, 'Three');
    const fourth = await pendingInvite(h, acc);
    expect((await acceptInvite(h, acc, fourth.token)).status).toBe(402);
    expect((await h.app.request(`/v1/clients/${one.profileId}`, { method: 'DELETE', headers: acc.auth })).status).toBe(204);
    expect((await acceptInvite(h, acc, fourth.token)).status).toBe(200);
  });

  it('signup from an invite is never capped (a new account holds none)', async () => {
    const h = planHarness();
    const owner = await person(h);
    const profileId = await businessOf(h, owner);
    expect((await inviteAccountant(h, owner, profileId, 'new-acc@books.ps')).status).toBe(201);
    expect((await signupFromInvite(h, inviteTokenFor(h, 'new-acc@books.ps'))).status).toBe(201);
  });

  it('at the paid ceiling: 409 CONFLICT CLIENT_BOOKS_CEILING ("contact us"), still nothing written', async () => {
    const h = planHarness({ maxClients: 4 });
    const acc = await person(h);
    await grantPlan(h, acc.userId);
    for (const n of ['One', 'Two', 'Three', 'Four']) await client(h, acc, n);
    const fifth = await pendingInvite(h, acc);
    const res = await acceptInvite(h, acc, fifth.token);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'CLIENT_BOOKS_CEILING' });
  });

  it('flag off: no cap and no plan read', async () => {
    const h = planHarness({ on: false });
    const acc = await person(h);
    for (const n of ['One', 'Two', 'Three']) await client(h, acc, n);
    const fourth = await pendingInvite(h, acc, 'Four');
    const factsFor = vi.spyOn(h.store.billing, 'factsFor');
    expect((await acceptInvite(h, acc, fourth.token)).status).toBe(200);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(fourth.profileId) })).status).toBe(200);
    expect(factsFor).not.toHaveBeenCalled();
    const body = await me(h, acc);
    expect(body.clients).toHaveLength(4);
    expect(body.clientBooks).toMatchObject({ count: 4, freeLimit: 3, cap: null, readable: 4 });
    expect(body.clients.every((c: Loose) => c.needsPlan === false)).toBe(true);
  });
});

describe('5. the door: lapse keeps the 3 oldest readable (MUT-565)', () => {
  async function lapsed() {
    const h = planHarness();
    const acc = await person(h);
    const grantId = await grantPlan(h, acc.userId);
    const clients = [];
    for (const n of ['One', 'Two', 'Three', 'Four']) clients.push(await client(h, acc, n));
    await revokePlan(h, grantId);
    return { h, acc, clients };
  }

  it('the 3 oldest read 200, the 4th answers 402 ACCOUNTANT_PLAN_REQUIRED {profileId, freeLimit}; restored with the plan', async () => {
    const { h, acc, clients } = await lapsed();
    for (const c of clients.slice(0, 3)) expect((await h.app.request('/v1/expenses', { headers: acc.on(c.profileId) })).status).toBe(200);
    const locked = await h.app.request('/v1/expenses', { headers: acc.on(clients[3]!.profileId) });
    expect(locked.status).toBe(402);
    expect((await read(locked)).error).toMatchObject({ code: 'ACCOUNTANT_PLAN_REQUIRED', details: { profileId: clients[3]!.profileId, freeLimit: 3 } });
    expect((await h.app.request('/v1/profile-entries', { headers: acc.on(clients[3]!.profileId) })).status).toBe(402);

    await grantPlan(h, acc.userId);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(clients[3]!.profileId) })).status).toBe(200);
  });

  it('a revoke of an older client promotes the 4th by itself', async () => {
    const { h, acc, clients } = await lapsed();
    const second = clients[1]!;
    const grants = (await read(await h.app.request(`/v1/profiles/${second.profileId}/accountants`, { headers: second.owner.auth }))).items as Loose[];
    expect((await h.app.request(`/v1/profiles/${second.profileId}/accountants/${grants[0].id}`, { method: 'DELETE', headers: second.owner.auth })).status).toBe(204);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(clients[3]!.profileId) })).status).toBe(200);
  });

  it('a client within the free 3 costs no billing read', async () => {
    const { h, acc, clients } = await lapsed();
    const factsFor = vi.spyOn(h.store.billing, 'factsFor');
    expect((await h.app.request('/v1/expenses', { headers: acc.on(clients[0]!.profileId) })).status).toBe(200);
    expect(factsFor).not.toHaveBeenCalled();
    expect((await h.app.request('/v1/expenses', { headers: acc.on(clients[3]!.profileId) })).status).toBe(402);
    expect(factsFor).toHaveBeenCalledTimes(1);
  });

  it('every allowlisted GET answers 402 on the locked client; every write is still 403 (never 402)', async () => {
    const { h, acc, clients } = await lapsed();
    const locked = clients[3]!.profileId;
    const routeAccess = buildRouteAccessIndex(h.app.openAPIRegistry.definitions, h.app.routes);
    const doc = (await read(await h.app.request('/openapi.json'))) as { paths: Record<string, Record<string, Loose>> };
    const hono = (path: string) => path.replace(/\{([^}]+)\}/g, ':$1');
    const ops = Object.entries(doc.paths)
      .filter(([path]) => path.startsWith('/v1/') && !path.startsWith('/v1/operator/'))
      .flatMap(([path, item]) => (['get', 'post', 'patch', 'delete'] as const).filter((m) => item[m]?.security?.some((r: Loose) => 'session' in r || 'deviceSession' in r)).map((m) => ({ method: m.toUpperCase(), path })))
      .filter((op) => !SESSION_ORGANIZATION_INDEPENDENT_ROUTES.has(`${op.method} ${hono(op.path)}`));
    const allowed = ops.filter((op) => op.method === 'GET' && accountantMayRead(`GET ${hono(op.path)}`, routeAccess.get(`GET ${hono(op.path)}`)?.scopes ?? []));
    expect(allowed.length).toBeGreaterThanOrEqual(30);
    const concrete = (path: string) => path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-0000000000aa');
    const wrong: string[] = [];
    for (const op of allowed) {
      const res = await h.app.request(concrete(op.path), { headers: acc.on(locked) });
      if (res.status !== 402) wrong.push(`${op.method} ${op.path} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
    const write = await h.app.request('/v1/expenses', json({ amount: '1.00', currency: 'ILS', occurredOn: '2026-11-01', title: 'x' }, { ...acc.on(locked), 'idempotency-key': crypto.randomUUID() }));
    expect(write.status).toBe(403);
  });
});

describe('6. rows and /v1/me (MUT-565)', () => {
  it('`needsPlan` on the 4th only; ended rows false; /v1/clients stats null on the locked row; clientBooks shape', async () => {
    const h = planHarness();
    const acc = await person(h);
    const grantId = await grantPlan(h, acc.userId, { expiresAt: new Date(T0.getTime() + 30 * DAY).toISOString() });
    const clients = [];
    for (const n of ['One', 'Two', 'Three', 'Four']) clients.push(await client(h, acc, n));
    const paid = await me(h, acc);
    expect(paid.clientBooks).toEqual({ count: 4, freeLimit: 3, cap: 100, readable: 4, plan: { state: 'ACTIVE', source: 'OPERATOR', until: expect.any(String), cancelAtPeriodEnd: false } });
    await revokePlan(h, grantId);

    const body = await me(h, acc);
    expect(body.clientBooks).toEqual({ count: 4, freeLimit: 3, cap: 3, readable: 3, plan: { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false } });
    expect(body.clients.map((c: Loose) => `${c.name}:${c.needsPlan}`)).toEqual(['One:false', 'Two:false', 'Three:false', 'Four:true']);
    const list = (await read(await h.app.request('/v1/clients', { headers: acc.auth }))).items as Loose[];
    const four = list.find((r) => r.name === 'Four');
    expect(four).toMatchObject({ needsPlan: true, entriesThisMonth: null, lastActivityAt: null });
    expect(list.find((r) => r.name === 'One')).toMatchObject({ needsPlan: false, entriesThisMonth: 1 });
  });

  it('/v1/me resolves the plan from its one billing read (no query of its own)', async () => {
    const h = planHarness();
    const acc = await person(h);
    await client(h, acc, 'One');
    const factsFor = vi.spyOn(h.store.billing, 'factsFor');
    await me(h, acc);
    expect(factsFor).toHaveBeenCalledTimes(1);
  });
});

describe('2. the plan never reaches the accountant’s own profile (MUT-565)', () => {
  it('an ACCOUNTANT subscription or grant leaves the personal profile’s billing and /v1/billing.subscription as they were', async () => {
    const h = planHarness({ checkout: new FakeCheckoutGateway().withGaPrices() });
    const acc = await person(h);
    const before = (await me(h, acc)).profiles.find((p: Loose) => p.id === acc.personalId).billing;
    await subscribe(h, acc.userId, 'ACCOUNTANT');
    await grantPlan(h, acc.userId);
    expect((await me(h, acc)).profiles.find((p: Loose) => p.id === acc.personalId).billing).toEqual(before);
    const billing = await read(await h.app.request('/v1/billing', { headers: acc.auth }));
    expect(billing.subscription).toBeNull();
    expect(billing.accountantPlan).toMatchObject({ state: 'ACTIVE', source: 'OPERATOR', interval: 'month', currency: 'ILS' });
  });

  it('a Freelancer payer may buy the Accountant plan, and an Accountant payer the Freelancer plan', async () => {
    const checkout = new FakeCheckoutGateway().withGaPrices().withAccountantPrices();
    const h = planHarness({ checkout });
    const a = await person(h);
    await subscribe(h, a.userId, 'FREELANCER');
    const body = { interval: 'month', country: 'IL', buyer: 'person', returnPath: '/accountant-invite', plan: 'accountant' };
    expect((await h.app.request('/v1/billing/checkout-session', json(body, a.auth))).status).toBe(200);
    expect((await h.app.request('/v1/billing/checkout-session', json({ ...body, plan: 'freelancer', returnPath: '/' }, a.auth))).status).toBe(409);

    const b = await person(h);
    await subscribe(h, b.userId, 'ACCOUNTANT');
    expect((await h.app.request('/v1/billing/checkout-session', json({ ...body, plan: undefined, returnPath: '/' }, b.auth))).status).toBe(200);
    const again = await h.app.request('/v1/billing/checkout-session', json(body, b.auth));
    expect(again.status).toBe(409);
    expect((await read(again)).error.details.reason).toBe('ALREADY_SUBSCRIBED');
  });
});

describe('7. Checkout for the Accountant plan (MUT-565)', () => {
  const body = (over: Record<string, unknown> = {}) => ({ interval: 'month', country: 'IL', buyer: 'person', returnPath: '/accountant-invite', plan: 'accountant', ...over });

  it('picks the accountant lookup key, no trial, no offer; audited with plan; return paths for the invite and client books', async () => {
    const checkout = new FakeCheckoutGateway().withGaPrices().withAccountantPrices();
    const h = planHarness({ checkout });
    const a = await person(h);
    const res = await h.app.request('/v1/billing/checkout-session', json(body(), a.auth));
    expect(res.status).toBe(200);
    const params = checkout.checkoutSessions.at(-1)!;
    expect(params.line_items).toEqual([{ price: 'price_accountant_list_monthly_ils', quantity: 1 }]);
    expect(params.subscription_data).toEqual({ metadata: { mutaba3a_user_id: a.userId } });
    expect(params.discounts).toBeUndefined();
    expect(params.success_url).toBe('http://localhost/accountant-invite?billing=true&checkout=success');
    const audit = (await h.store.audit.listByOrganization(a.personalId, 50)).find((e) => e.action === 'billing.checkout_started');
    expect(audit?.metadata).toMatchObject({ plan: 'accountant', interval: 'month', currency: 'ILS', offer: null });

    expect((await h.app.request('/v1/billing/checkout-session', json(body({ returnPath: `/client-books/${a.personalId}`, country: 'GB' }), a.auth))).status).toBe(200);
    expect(checkout.checkoutSessions.at(-1)!.line_items).toEqual([{ price: 'price_accountant_list_monthly_usd', quantity: 1 }]);
    expect((await h.app.request('/v1/billing/checkout-session', json(body({ returnPath: '/client-books/x' }), a.auth))).status).toBe(422);
  });

  it('a year is 422; an unpriced plan is 503 PRICES_NOT_SET; a no-expiry grant is COVERED_BY_GRANT; access off is 404', async () => {
    const checkout = new FakeCheckoutGateway().withGaPrices();
    const h = planHarness({ checkout });
    const a = await person(h);
    expect((await h.app.request('/v1/billing/checkout-session', json(body({ interval: 'year' }), a.auth))).status).toBe(422);
    const unpriced = await h.app.request('/v1/billing/checkout-session', json(body(), a.auth));
    expect(unpriced.status).toBe(503);
    expect((await read(unpriced)).error.details.reason).toBe('PRICES_NOT_SET');
    await grantPlan(h, a.userId);
    expect((await read(await h.app.request('/v1/billing/checkout-session', json(body(), a.auth)))).error.details.reason).toBe('COVERED_BY_GRANT');

    const off = accountantHarness({ accountantAccess: false, stripe: { webhookGateway: new FakeStripeGateway(() => T0), reconcileGateway: new FakeStripeGateway(() => T0), checkoutGateway: new FakeCheckoutGateway().withGaPrices().withAccountantPrices() } });
    const p = await person(off);
    expect((await off.app.request('/v1/billing/checkout-session', json(body(), p.auth))).status).toBe(404);
  });

  it('GET /v1/billing carries the monthly price per currency; null when accountant access is off', async () => {
    const h = planHarness({ checkout: new FakeCheckoutGateway().withGaPrices().withAccountantPrices() });
    const a = await person(h);
    expect((await read(await h.app.request('/v1/billing', { headers: a.auth }))).accountantPlan).toEqual({
      state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false, interval: null, currency: null, catalog: { ILS: { month: 9900 }, USD: { month: 2500 } },
    });
    const off = accountantHarness({ accountantAccess: false });
    const p = await person(off);
    expect((await read(await off.app.request('/v1/billing', { headers: p.auth }))).accountantPlan).toBeNull();
  });
});

describe('9. operator grants are person-only (MUT-565)', () => {
  it('an ACCOUNTANT grant on a person is 201; on an organization 422', async () => {
    const h = planHarness();
    const a = await person(h);
    await grantPlan(h, a.userId);
    const res = await h.app.request('/admin/v1/billing/grants', json({ organizationId: a.personalId, tier: 'ACCOUNTANT', reason: 'x' }, ADMIN));
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ACCOUNTANT_PERSON_ONLY' });
  });
});

describe('MUT-565 review fixes', () => {
  it('3: a client whose owner is closing takes no free place: 2 live + 1 closing → the next accept is free', async () => {
    const h = planHarness();
    const acc = await person(h);
    await client(h, acc, 'One');
    await client(h, acc, 'Two');
    const closing = await client(h, acc, 'Closing');
    expect((await h.app.request('/v1/me/closure', json({ password: closing.owner.password }, closing.owner.auth))).status).toBe(200);
    const fourth = await pendingInvite(h, acc);
    expect((await acceptInvite(h, acc, fourth.token)).status).toBe(200);
    const body = await me(h, acc);
    expect(body.clientBooks).toMatchObject({ count: 3, cap: 3, readable: 3 });
    expect(body.clients.filter((c: Loose) => c.status === 'active').every((c: Loose) => c.needsPlan === false)).toBe(true);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(fourth.profileId) })).status).toBe(200);
    expect(closureDeadline).toBeTypeOf('function');
  });

  it('2: card retry pays an Accountant plan’s past-due invoice when the profile plan isn’t past due', async () => {
    const plan = new FakePlanGateway();
    const h = planHarness({ plan });
    const acc = await person(h);
    await subscribe(h, acc.userId, 'FREELANCER', 'active');
    await subscribe(h, acc.userId, 'ACCOUNTANT', 'past_due');
    plan.failedPayments.set(`sub_ACCOUNTANT_${acc.userId.slice(0, 8)}_past_due`, {
      status: 'past_due',
      episode: { invoiceId: 'in_acc', attemptCount: 1, nextPaymentAttempt: new Date(T0.getTime() + DAY), firstFailedAt: new Date(T0.getTime() - DAY), needsAuthentication: false },
    });
    const res = await h.app.request('/v1/billing/card-retry', json({}, acc.auth));
    expect(await read(res)).toEqual({ outcome: 'paid', hostedInvoiceUrl: null });
    expect(plan.retries).toEqual([{ invoiceId: 'in_acc', attemptCount: 1 }]);
  });

  it('4: the Accountant Checkout needs ACCOUNTANT_PLAN on as well (404 while it is off)', async () => {
    const h = planHarness({ on: false, checkout: new FakeCheckoutGateway().withGaPrices().withAccountantPrices() });
    const a = await person(h);
    const res = await h.app.request('/v1/billing/checkout-session', json({ interval: 'month', country: 'IL', buyer: 'person', returnPath: '/', plan: 'accountant' }, a.auth));
    expect(res.status).toBe(404);
  });

  it('5: an Accountant Checkout leaves an open Freelancer Checkout payable, and says which plan it is', async () => {
    const checkout = new FakeCheckoutGateway().withGaPrices().withAccountantPrices();
    const h = planHarness({ checkout });
    const a = await person(h);
    const body = { interval: 'month', country: 'IL', buyer: 'person', returnPath: '/' };
    expect((await h.app.request('/v1/billing/checkout-session', json(body, a.auth))).status).toBe(200);
    expect((await h.app.request('/v1/billing/checkout-session', json({ ...body, plan: 'accountant' }, a.auth))).status).toBe(200);
    const customer = [...checkout.customers.keys()][0]!;
    expect(checkout.openByPlan.get(`${customer}:freelancer`)).toBe(1);
    expect(checkout.openByPlan.get(`${customer}:accountant`)).toBe(1);
    expect(checkout.checkoutSessions.at(-1)!.metadata).toEqual({ mutaba3a_plan: 'accountant' });
  });

  it('8: /v1/me.clientBooks resolves the real plan where billing is off (the signed-out portal shape)', async () => {
    const h = planHarness();
    const acc = await person(h);
    await grantPlan(h, acc.userId);
    for (const n of ['One', 'Two', 'Three', 'Four']) await client(h, acc, n);
    const user = (await h.store.users.getById(acc.userId))!;
    const built = await buildMe(h.store, user, null, null, false, null, undefined, true, PLAN_ON);
    expect(built.clientBooks).toMatchObject({ count: 4, cap: 100, readable: 4, plan: { state: 'ACTIVE', source: 'OPERATOR' } });
    expect(built.clients!.every((c) => !c.needsPlan)).toBe(true);
  });
});
