import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import Stripe from 'stripe';
import { createApp, type AppDependencies } from '../app.js';
import { createStripeGateway, StripeGatewayError, WEBHOOK_BUDGET, type StripeGateway } from '../billing/stripe/gateway.js';
import { FAKE_WEBHOOK_SECRET, FakeStripeGateway, stripeObjects } from '../billing/stripe/__tests__/fake.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-360 (§2.5, ADR-165): the Stripe webhook and the two reconcile doors, through the real app. Signatures are real
 * (the fake signs with the SDK), so AC1 is tested end to end; AC3 is read back on GET /v1/me.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const JOB_TOKEN = 'test-job-token-with-at-least-32-characters!!';
const WEBHOOK = '/v1/billing/stripe/webhook';
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-11-01T09:00:00Z');

function harness(overrides: Partial<AppDependencies> & { stripeOff?: boolean; gateway?: StripeGateway } = {}) {
  const store = new MemoryLedgerStore();
  const clock = { now: NOW };
  const stripe = new FakeStripeGateway(() => clock.now);
  stripe.products.set('prod_F', stripeObjects.product('prod_F', 'freelancer'));
  const logs: string[] = [];
  const gateway = overrides.gateway ?? stripe;
  const app = createApp({
    store,
    logger: pino({ level: 'info' }, { write: (line: string) => void logs.push(line) }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
    stripe: overrides.stripeOff ? null : { webhookGateway: gateway, reconcileGateway: gateway },
    jobToken: JOB_TOKEN,
    ...overrides,
  });
  const deliver = (event: Record<string, unknown>, init: { signature?: string; secret?: string } = {}) => {
    const signed = stripe.sign(event, init.secret);
    return app.request(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': init.signature ?? signed.signature }, body: signed.raw });
  };
  return { app, store, stripe, clock, deliver, logs };
}
type Harness = ReturnType<typeof harness>;

async function person(h: Harness) {
  const email = `stripe${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
  const res = await h.app.request('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json', ...SAME_ORIGIN }, body: JSON.stringify({ email, password: created.password }) });
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const me = async () => read(await h.app.request('/v1/me', { headers: { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN } }));
  return { me, userId: created.user.id as string, personalId: created.personalProfile.id as string };
}

const subscriptionEvent = (id = `evt_${++seq}`) => ({ id, type: 'customer.subscription.created', data: { object: { id: 'sub_1' } } });
const changes = async (h: Harness, organizationId: string) =>
  (await h.store.audit.list(organizationId, {}, { limit: 100, cursor: null })).items.filter((e) => e.action === 'billing.subscription_changed');

describe('POST /v1/billing/stripe/webhook (MUT-360)', () => {
  it('a hand-made subscription with mutaba3a_user_id shows up on GET /v1/me with no operator step (AC3)', async () => {
    const h = harness();
    const u = await person(h);
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: u.userId }));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    const res = await h.deliver(subscriptionEvent());
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ received: true, result: 'processed' });
    const billing = (await u.me()).profiles.find((p: { id: string }) => p.id === u.personalId).billing;
    expect(billing).toMatchObject({ state: 'ACTIVE', source: 'STRIPE', tier: 'FREELANCER' });
  });

  it('refuses a missing, foreign or expired signature with 400 and changes nothing (AC1)', async () => {
    const h = harness();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    const event = subscriptionEvent('evt_signed');
    const missing = await h.app.request(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...event, object: 'event' }) });
    expect(missing.status).toBe(400);
    expect((await read(missing)).error.code).toBe('INVALID_SIGNATURE');
    expect((await h.deliver(event, { secret: 'whsec_another_endpoint' })).status).toBe(400);
    const signed = h.stripe.sign(event);
    const tampered = await h.app.request(WEBHOOK, { method: 'POST', headers: { 'stripe-signature': signed.signature }, body: signed.raw.replace('sub_1', 'sub_2') });
    expect(tampered.status).toBe(400);
    const old = new Stripe('sk_test_x').webhooks.generateTestHeaderString({ payload: signed.raw, secret: FAKE_WEBHOOK_SECRET, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect((await h.app.request(WEBHOOK, { method: 'POST', headers: { 'stripe-signature': old }, body: signed.raw })).status).toBe(400);
    expect(h.stripe.calls).toEqual([]);
    expect(await h.store.billing.getAccount('cus_1')).toBeNull();
    // The same event, properly signed, is still new: nothing was recorded for it.
    expect(await read(await h.deliver(event))).toEqual({ received: true, result: 'processed' });
  });

  it('replaying a delivered event changes nothing the second time (AC1)', async () => {
    const h = harness();
    const u = await person(h);
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: u.userId }));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    const event = subscriptionEvent();
    expect(await read(await h.deliver(event))).toEqual({ received: true, result: 'processed' });
    expect(await read(await h.deliver(event))).toEqual({ received: true, result: 'duplicate' });
    expect(await changes(h, u.personalId)).toHaveLength(1);
    expect(h.stripe.calls).toEqual(['subscription:sub_1']);
  });

  it('answers 500 when Stripe can’t be read, so Stripe redelivers, and handles the redelivery', async () => {
    const h = harness();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    const event = subscriptionEvent();
    h.stripe.failNext();
    const failed = await h.deliver(event);
    expect(failed.status).toBe(500);
    expect((await read(failed)).error.code).toBe('INTERNAL');
    expect(await read(await h.deliver(event))).toEqual({ received: true, result: 'processed' });
  });

  it('ignores events it doesn’t handle, with 200', async () => {
    const h = harness();
    expect(await read(await h.deliver({ id: 'evt_x', type: 'charge.refunded', data: { object: { id: 'ch_1' } } }))).toEqual({ received: true, result: 'ignored' });
  });

  it('answers 503 when Stripe isn’t configured, 413 past 256 KB and 429 past the per-address budget', async () => {
    const off = harness({ stripeOff: true });
    const res = await off.deliver(subscriptionEvent());
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('BILLING_NOT_CONFIGURED');

    const h = harness();
    const big = await h.app.request(WEBHOOK, { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: 'x'.repeat(256 * 1024 + 1) });
    expect(big.status).toBe(413);
    expect((await read(big)).error.code).toBe('PAYLOAD_TOO_LARGE');

    // MUT-360 review: only failed signatures count (Stripe's IPs are shared), so junk can't 429 real events.
    const limited = harness({ stripeWebhookIpLimiter: new SlidingWindowRateLimiter(1) });
    expect((await limited.deliver({ id: 'evt_bad1', type: 'charge.refunded', data: { object: {} } }, { secret: 'whsec_someone_else' })).status).toBe(400);
    const second = await limited.deliver({ id: 'evt_bad2', type: 'charge.refunded', data: { object: {} } }, { secret: 'whsec_someone_else' });
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).not.toBeNull();
    for (const id of ['evt_a', 'evt_b', 'evt_c']) expect((await limited.deliver({ id, type: 'charge.refunded', data: { object: {} } })).status).toBe(200);
  });

  it('never logs the Stripe key or what Stripe answered, even when the real gateway fails (AC5)', async () => {
    const key = 'rk_test_secret_key_never_in_logs';
    const failing = Stripe.createFetchHttpClient((async () =>
      new Response(JSON.stringify({ error: { type: 'api_error', message: 'upstream body that must not be logged' } }), { status: 500, headers: { 'content-type': 'application/json' } })) as typeof fetch);
    const real = createStripeGateway({ secretKey: key, webhookSecret: FAKE_WEBHOOK_SECRET, ...WEBHOOK_BUDGET, now: () => NOW, httpClient: failing });
    const h = harness({ gateway: real });
    const res = await h.deliver(subscriptionEvent(), {});
    expect(res.status).toBe(500);
    const all = h.logs.join('\n');
    expect(all).toContain('stripe event failed');
    expect(all).not.toContain(key);
    expect(all).not.toContain('upstream body that must not be logged');
    expect(all).not.toContain('t=');
  });
});

describe('GET /admin/v1/billing/status (MUT-360 review: the cutover check)', () => {
  it('shows the mirror and the entitlement with grants left out, so a grant is revoked only once Stripe covers', async () => {
    const h = harness();
    const u = await person(h);
    const email = (await u.me()).user.email as string;
    const admin = { 'x-admin-token': ADMIN_TOKEN };
    const status = async () => read(await h.app.request(`/admin/v1/billing/status?email=${encodeURIComponent(email)}`, { headers: admin }));
    await h.app.request('/admin/v1/billing/grants', { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ userId: u.userId, tier: 'FREELANCER', reason: 'pilot' }) });

    const before = await status();
    expect(before.user).toMatchObject({ id: u.userId, email });
    expect(before.accounts).toEqual([]);
    expect(before.subscriptions).toEqual([]);
    expect(before.profiles.find((p: { id: string }) => p.id === u.personalId)).toMatchObject({ billing: { state: 'ACTIVE', source: 'OPERATOR' }, billingWithoutGrants: { source: 'NONE' } });

    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: u.userId }));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    await h.deliver(subscriptionEvent());
    const after = await status();
    expect(after.accounts).toMatchObject([{ stripeCustomerId: 'cus_1', userId: u.userId }]);
    expect(after.subscriptions).toMatchObject([{ stripeSubscriptionId: 'sub_1', tier: 'FREELANCER', status: 'active', payerUserId: u.userId }]);
    expect(after.profiles.find((p: { id: string }) => p.id === u.personalId)).toMatchObject({ billing: { source: 'OPERATOR' }, billingWithoutGrants: { state: 'ACTIVE', source: 'STRIPE' } });

    expect((await h.app.request(`/admin/v1/billing/status?email=nobody%40example.test`, { headers: admin })).status).toBe(404);
    expect((await h.app.request(`/admin/v1/billing/status?email=${encodeURIComponent(email)}`)).status).toBe(401);
  });
});

describe('Stripe reconcile doors (MUT-360 D2)', () => {
  const run = (h: Harness, path: string, headers: Record<string, string>) => h.app.request(path, { method: 'POST', headers });

  it('the Scheduler’s job token opens only /jobs, and the admin token only /admin', async () => {
    const h = harness();
    const job = await run(h, '/jobs/v1/billing/stripe-reconcile', { 'x-job-token': JOB_TOKEN });
    expect(job.status).toBe(200);
    expect(await read(job)).toEqual({ checked: 0, changed: 0, unlinked: 0, errors: [], pruned: 0 });
    expect((await run(h, '/jobs/v1/billing/stripe-reconcile', { 'x-job-token': `${JOB_TOKEN}x` })).status).toBe(401);
    expect((await run(h, '/jobs/v1/billing/stripe-reconcile', {})).status).toBe(401);
    expect((await read(await run(h, '/jobs/v1/billing/stripe-reconcile', { 'x-admin-token': ADMIN_TOKEN }))).error.code).toBe('JOB_UNAUTHORIZED');
    expect((await read(await run(h, '/admin/v1/billing/stripe/reconcile', { 'x-job-token': JOB_TOKEN }))).error.code).toBe('ADMIN_UNAUTHORIZED');
    expect((await run(h, '/admin/v1/billing/stripe/reconcile', { 'x-admin-token': ADMIN_TOKEN })).status).toBe(200);
  });

  it('a reconcile that could not list Stripe answers 502 RECONCILE_FAILED, so the Scheduler records a failure', async () => {
    const broken: StripeGateway = {
      livemode: false,
      verifyEvent: () => {
        throw new Error('unused');
      },
      subscription: () => Promise.reject(new Error('unused')),
      customer: () => Promise.reject(new Error('unused')),
      listSubscriptions: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new StripeGatewayError({ code: null, type: 'StripeAuthenticationError', requestId: null, transient: true })),
        }),
      }),
      listProducts: async () => new Map(),
    };
    const h = harness({ gateway: broken });
    const res = await run(h, '/jobs/v1/billing/stripe-reconcile', { 'x-job-token': JOB_TOKEN });
    expect(res.status).toBe(502);
    const body = await read(res);
    expect(body.error.code).toBe('RECONCILE_FAILED');
    expect(body.error.details).toMatchObject({ checked: 0, errors: [{ subscriptionId: null, code: 'LIST_FAILED' }] });
  });

  it('with no job token configured, /jobs answers 503 and never compares an empty header', async () => {
    const h = harness({ jobToken: null });
    const res = await run(h, '/jobs/v1/billing/stripe-reconcile', { 'x-job-token': '' });
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('JOBS_NOT_CONFIGURED');
    expect((await run(h, '/jobs/v1/billing/stripe-reconcile', {})).status).toBe(503);
  });

  it('reconcile mirrors and reports; unconfigured Stripe answers 503', async () => {
    const h = harness();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    expect(await read(await run(h, '/admin/v1/billing/stripe/reconcile', { 'x-admin-token': ADMIN_TOKEN }))).toEqual({ checked: 1, changed: 1, unlinked: 1, errors: [], pruned: 0 });
    const off = harness({ stripeOff: true });
    expect((await run(off, '/jobs/v1/billing/stripe-reconcile', { 'x-job-token': JOB_TOKEN })).status).toBe(503);
  });

  it('/jobs is never the portal’s page, even with the portal served', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'mut360-portal-'));
    await writeFile(join(distDir, 'index.html'), '<!doctype html><html><body>portal shell</body></html>');
    const h = harness({ portal: { distDir } });
    expect(await (await h.app.request('/some/client/route')).text()).toContain('portal shell');
    const jobs = await h.app.request('/jobs/anything', { headers: { 'x-job-token': JOB_TOKEN } });
    expect(jobs.status).toBe(404);
    expect(jobs.headers.get('content-type')).toContain('application/json');
  });
});
