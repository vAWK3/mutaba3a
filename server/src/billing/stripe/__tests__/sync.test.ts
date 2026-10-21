import pino from 'pino';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../repositories/memory.js';
import type { CreateUserInput } from '../../../repositories/ports.js';
import { entitlementsFor } from '../../coverage.js';
import { StripeGatewayError, type StripeGateway } from '../gateway.js';
import { createStripeSync, ReconcileRunning } from '../sync.js';
import { FakeStripeGateway, stripeObjects } from './fake.js';

/** MUT-360 §2.3: events and the nightly reconcile through one sync path, on the memory store and a fake Stripe. */
const NOW = new Date('2026-11-01T09:00:00.000Z');
let n = 0;
const unique = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

function harness(options: { reconcileGateway?: StripeGateway } = {}) {
  const store = new MemoryLedgerStore();
  const clock = { now: NOW };
  const stripe = new FakeStripeGateway(() => clock.now);
  stripe.products.set('prod_F', stripeObjects.product('prod_F', 'freelancer'));
  stripe.products.set('prod_FIRM', stripeObjects.product('prod_FIRM', 'firm'));
  stripe.products.set('prod_NOTIER', stripeObjects.product('prod_NOTIER', null));
  const sync = createStripeSync({
    store,
    webhookGateway: stripe,
    reconcileGateway: options.reconcileGateway ?? stripe,
    logger: pino({ level: 'silent' }),
    now: () => clock.now,
  });
  const tick = (ms = 1000) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  const person = async () => {
    const input: CreateUserInput = {
      email: `p-${unique()}@studio.ps`,
      displayName: 'Rana Saleh',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
      locale: 'en',
      personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: NOW,
    };
    const { user, personalOrganization } = await store.users.create(input);
    return { userId: user.id, personalId: personalOrganization.id };
  };
  const event = (type: string, object: Record<string, unknown>, id = `evt_${unique()}`, livemode = false) =>
    ({ id, object: 'event', type, livemode, created: 0, data: { object } }) as unknown as Stripe.Event;
  const billingOf = async (organizationId: string) => {
    const organization = (await store.organizations.getById(organizationId))!;
    return (await entitlementsFor(store, [{ organization, malafatConnected: false }], clock.now)).get(organizationId);
  };
  const changes = async (organizationId: string) =>
    (await store.audit.list(organizationId, {}, { limit: 100, cursor: null })).items.filter((e) => e.action === 'billing.subscription_changed');
  return { store, stripe, sync, tick, person, event, billingOf, changes, clock };
}

describe('Stripe sync (MUT-360)', () => {
  it('links a hand-made subscription through the customer’s metadata and the payer reads as paid (AC3)', async () => {
    const h = await harness();
    const u = await h.person();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: u.userId }));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));

    expect(await h.sync.handleEvent(h.event('customer.subscription.created', { id: 'sub_1' }), 'req-1')).toMatchObject({ status: 200, result: 'processed' });
    expect(await h.store.billing.getAccount('cus_1')).toMatchObject({ userId: u.userId, currency: 'ILS', country: 'IL' });
    expect(await h.billingOf(u.personalId)).toMatchObject({ state: 'ACTIVE', source: 'STRIPE', tier: 'FREELANCER' });
    expect(h.stripe.calls).toEqual(['subscription:sub_1']);
  });

  it('ends in Stripe’s current state whatever order events arrive in, and an older read never overwrites (AC2)', async () => {
    const h = await harness();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F', status: 'canceled' }));
    await h.sync.handleEvent(h.event('customer.subscription.updated', { id: 'sub_1' }), null);
    h.tick();
    await h.sync.handleEvent(h.event('customer.subscription.created', { id: 'sub_1' }), null);
    const facts = await h.store.billing.factsFor({ ownerUserIds: [], organizationIds: [] });
    expect(facts.subscriptions).toEqual([]); // unlinked, no org: covers nobody
    const listed = { value: { ...h.stripe.subscriptions.get('sub_1')!, status: 'active' } as Stripe.Subscription, fetchedAt: new Date(NOW.getTime() - 60_000) };
    listed.value.customer = h.stripe.customers.get('cus_1')!;
    expect(await h.sync.syncSubscription({ subscription: listed, products: h.stripe.products }, { linkHint: null, source: 'reconcile', eventId: null, requestId: null })).toMatchObject({
      outcome: 'stale',
    });
    const fresh = await h.sync.syncSubscription({ id: 'sub_1' }, { linkHint: null, source: 'webhook', eventId: null, requestId: null });
    expect(fresh).toMatchObject({ outcome: 'unchanged' });
  });

  it('replays nothing: a processed event is a duplicate, and is not fetched again (AC1)', async () => {
    const h = await harness();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    const e = h.event('customer.subscription.updated', { id: 'sub_1' });
    expect(await h.sync.handleEvent(e, null)).toMatchObject({ result: 'processed' });
    expect(await h.sync.handleEvent(e, null)).toMatchObject({ status: 200, result: 'duplicate' });
    expect(h.stripe.calls).toEqual(['subscription:sub_1']);
  });

  it('a checkout links its customer to the person who checked out and creates the account in the subscription’s currency (D6)', async () => {
    const h = await harness();
    const u = await h.person();
    h.stripe.customers.set('cus_new', stripeObjects.customer('cus_new', {}, null));
    h.stripe.subscriptions.set('sub_new', stripeObjects.subscription({ id: 'sub_new', customer: 'cus_new', product: 'prod_F', currency: 'usd' }));
    const checkout = h.event('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: 'sub_new', customer: 'cus_new', client_reference_id: u.userId });
    expect(await h.sync.handleEvent(checkout, null)).toMatchObject({ status: 200, result: 'processed' });
    expect(await h.store.billing.getAccount('cus_new')).toMatchObject({ userId: u.userId, currency: 'USD', country: null });
    const linked = (await h.store.audit.list(u.personalId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action === 'billing.account_linked');
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ actorType: 'SYSTEM', entityType: 'user', entityId: u.userId, metadata: { stripeCustomerId: 'cus_new', userId: u.userId, source: 'stripe' } });
  });

  it('customer.updated refreshes an existing account and never creates one', async () => {
    const h = await harness();
    const u = await h.person();
    h.stripe.customers.set('cus_unknown', stripeObjects.customer('cus_unknown', { mutaba3a_user_id: u.userId }));
    expect(await h.sync.handleEvent(h.event('customer.updated', { id: 'cus_unknown' }), null)).toMatchObject({ status: 200, result: 'noop' });
    expect(await h.store.billing.getAccount('cus_unknown')).toBeNull();

    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', {}, 'JO'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F', currency: 'usd' }));
    await h.sync.handleEvent(h.event('customer.subscription.created', { id: 'sub_1' }), null);
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: u.userId }, 'JO'));
    expect(await h.sync.handleEvent(h.event('customer.updated', { id: 'cus_1' }), null)).toMatchObject({ status: 200, result: 'processed' });
    expect(await h.store.billing.getAccount('cus_1')).toMatchObject({ userId: u.userId, country: 'JO', currency: 'USD' });
  });

  it('never moves an operator’s link: a different person in metadata is recorded, not followed (D5)', async () => {
    const h = await harness();
    const a = await h.person();
    const b = await h.person();
    await h.store.billing.linkAccount({ stripeCustomerId: 'cus_1', userId: a.userId, currency: 'ILS', at: NOW, audit: [] });
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: b.userId }));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    expect(await h.sync.handleEvent(h.event('customer.subscription.created', { id: 'sub_1' }), null)).toMatchObject({ status: 200, codes: ['CUSTOMER_LINKED_ELSEWHERE'] });
    expect(await h.store.billing.getAccount('cus_1')).toMatchObject({ userId: a.userId });
    expect(await h.billingOf(a.personalId)).toMatchObject({ source: 'STRIPE' });
    expect((await h.billingOf(b.personalId))?.source).not.toBe('STRIPE');
  });

  it('audits a change once per covered profile, and nothing when nothing changed', async () => {
    const h = await harness();
    const u = await h.person();
    const created = await h.store.organizations.createOwned(u.userId, { name: 'Studio', slug: `studio-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: NOW }, 6, { actorId: u.userId, requestId: null });
    if (created.kind !== 'created') throw new Error('owned profile not created');
    const business = created.organization;
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: u.userId }));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    await h.sync.handleEvent(h.event('customer.subscription.created', { id: 'sub_1' }), null);
    h.tick();
    await h.sync.handleEvent(h.event('invoice.paid', { id: 'in_1', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } } }), null);
    expect(await h.changes(u.personalId)).toHaveLength(1);
    expect(await h.changes(business.id)).toHaveLength(1);
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F', status: 'past_due' }));
    h.tick();
    await h.sync.handleEvent(h.event('invoice.payment_failed', { id: 'in_2', subscription: 'sub_1' }), null);
    expect(await h.changes(u.personalId)).toHaveLength(2);
    expect(await h.billingOf(business.id)).toMatchObject({ state: 'GRACE', source: 'STRIPE' });
  });

  it('answers the cases with nothing to do with 200 and stores nothing', async () => {
    const h = await harness();
    expect(await h.sync.handleEvent(h.event('charge.refunded', { id: 'ch_1' }), null)).toMatchObject({ status: 200, result: 'ignored' });
    expect(await h.sync.handleEvent(h.event('customer.subscription.updated', { id: 'sub_1' }, 'evt_live', true), null)).toMatchObject({ status: 200, result: 'ignored' });
    expect(await h.sync.handleEvent(h.event('invoice.paid', { id: 'in_1', parent: null }), null)).toMatchObject({ status: 200, result: 'noop' });
    expect(await h.sync.handleEvent(h.event('checkout.session.completed', { id: 'cs_1', mode: 'payment', subscription: null, customer: 'cus_1' }), null)).toMatchObject({ status: 200, result: 'noop' });
    h.stripe.customers.set('cus_gone', { id: 'cus_gone', object: 'customer', deleted: true } as Stripe.DeletedCustomer);
    h.stripe.subscriptions.set('sub_gone', stripeObjects.subscription({ id: 'sub_gone', customer: 'cus_gone', product: 'prod_F' }));
    expect(await h.sync.handleEvent(h.event('customer.subscription.deleted', { id: 'sub_gone' }), null)).toMatchObject({ status: 200, result: 'noop', codes: ['CUSTOMER_DELETED'] });
    expect(await h.store.billing.listAccounts({})).toEqual([]);
    expect(h.stripe.calls).toEqual(['subscription:sub_gone']);
  });

  it('a slow or failing Stripe call answers 500 and the redelivery is handled once (D7)', async () => {
    const h = await harness();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    const e = h.event('customer.subscription.created', { id: 'sub_1' });
    h.stripe.failNext();
    expect(await h.sync.handleEvent(e, null)).toMatchObject({ status: 500, result: 'error' });
    expect(await h.store.billing.getAccount('cus_1')).toBeNull();
    expect(await h.sync.handleEvent(e, null)).toMatchObject({ status: 200, result: 'processed' });
    expect(await h.sync.handleEvent(e, null)).toMatchObject({ result: 'duplicate' });
  });

  it('a subscription it can’t read is recorded and answered 200, and handled again when redelivered', async () => {
    const h = await harness();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_NOTIER' }));
    const e = h.event('customer.subscription.created', { id: 'sub_1' });
    expect(await h.sync.handleEvent(e, null)).toMatchObject({ status: 200, result: 'error', codes: ['UNKNOWN_TIER'] });
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    expect(await h.sync.handleEvent(e, null)).toMatchObject({ status: 200, result: 'processed' });
  });

  it('an organization id that names no profile is dropped and noted', async () => {
    const h = await harness();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_FIRM', metadata: { mutaba3a_organization_id: '33333333-3333-4333-8333-333333333333' } }));
    expect(await h.sync.handleEvent(h.event('customer.subscription.created', { id: 'sub_1' }), null)).toMatchObject({ status: 200, result: 'processed', codes: ['UNKNOWN_ORG'] });
  });

  it('reconcile mirrors subscriptions nobody told it about, creating their accounts, and repairs drift (AC4)', async () => {
    const h = await harness();
    const u = await h.person();
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: u.userId }));
    h.stripe.customers.set('cus_2', stripeObjects.customer('cus_2', {}, 'JO'));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    h.stripe.subscriptions.set('sub_2', stripeObjects.subscription({ id: 'sub_2', customer: 'cus_2', product: 'prod_F', currency: 'usd' }));
    h.stripe.subscriptions.set('sub_bad', stripeObjects.subscription({ id: 'sub_bad', customer: 'cus_2', product: 'prod_NOTIER', currency: 'usd' }));

    expect(await h.sync.reconcile('req-rec')).toEqual({ checked: 3, changed: 2, unlinked: 1, errors: [{ subscriptionId: 'sub_bad', code: 'UNKNOWN_TIER' }], pruned: 0 });
    expect(await h.billingOf(u.personalId)).toMatchObject({ state: 'ACTIVE', source: 'STRIPE' });
    expect(h.stripe.calls).toEqual(['listProducts', 'listSubscriptions']);

    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F', status: 'canceled' }));
    h.tick();
    expect(await h.sync.reconcile(null)).toMatchObject({ checked: 3, changed: 1 });
    expect(await h.billingOf(u.personalId)).toMatchObject({ state: 'READ_ONLY', source: 'STRIPE' });
    h.tick();
    const before = (await h.changes(u.personalId)).length;
    expect(await h.sync.reconcile(null)).toMatchObject({ changed: 0 });
    expect(await h.changes(u.personalId)).toHaveLength(before);
  });

  it('reconcile refuses to overlap itself, and a listing failure still ends in a summary', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: StripeGateway = {
      livemode: false,
      verifyEvent: () => {
        throw new Error('unused');
      },
      subscription: () => Promise.reject(new Error('unused')),
      customer: () => Promise.reject(new Error('unused')),
      listSubscriptions: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            await gate;
            throw new StripeGatewayError({ code: null, type: 'StripeAPIError', requestId: null, transient: true });
          },
        }),
      }),
      listProducts: async () => new Map(),
    };
    const h = await harness({ reconcileGateway: slow });
    const first = h.sync.reconcile(null);
    await expect(h.sync.reconcile(null)).rejects.toBeInstanceOf(ReconcileRunning);
    release();
    expect(await first).toMatchObject({ checked: 0, errors: [{ subscriptionId: null, code: 'LIST_FAILED' }] });
    await expect(h.sync.reconcile(null)).resolves.toBeDefined();
  });

  it('reconcile prunes webhook events older than 90 days', async () => {
    const h = await harness();
    await h.store.billing.beginStripeEvent({ id: 'evt_old', type: 'customer.updated', at: new Date(NOW.getTime() - 91 * 86_400_000) });
    await h.store.billing.beginStripeEvent({ id: 'evt_new', type: 'customer.updated', at: new Date(NOW.getTime() - 89 * 86_400_000) });
    expect(await h.sync.reconcile(null)).toMatchObject({ pruned: 1 });
  });
});
