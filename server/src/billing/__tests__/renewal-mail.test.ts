import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createMailer } from '../../email/mailer.js';
import { MemoryMailTransport } from '../../email/transports/memory.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { UserLocale } from '../../repositories/ports.js';
import { RENEWAL_NOTICE_DAYS, runRenewalMail, type RenewalFacts, type RenewalMailRunOptions } from '../renewal-mail.js';

/**
 * MUT-525 (TODO-1/D11, DD8): the pre-renewal notice. About 30 days before a launch-offer subscription's first
 * renewal, its payer is told, once, in their language, the day and the new yearly price, and how to cancel. Candidates
 * come from the mirror (offerId); Stripe's own subscription decides (still active, not cancelling, still in its first
 * paid year, still on a list price) and gives the amount the renewal will actually charge.
 */
const logger = pino({ level: 'silent' });
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-10-20T07:00:00Z');
const ORIGIN = 'https://portal.example.test';
let seq = 0;

function harness() {
  const store = new MemoryLedgerStore();
  const outbox = new MemoryMailTransport(() => NOW);
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const stripe = new Map<string, RenewalFacts | Error | null>();
  const asked: string[] = [];

  async function subscriber(opts: { locale?: UserLocale; renewsInDays?: number; offerId?: string | null; status?: string; cancelAtPeriodEnd?: boolean; linked?: boolean } = {}) {
    const { user } = await store.users.create({
      email: `renew${++seq}@studio.example`,
      displayName: 'Rana Saleh',
      passwordHash: 'x',
      locale: opts.locale ?? 'en',
      personal: { name: 'Personal', slug: `personal-r${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: NOW,
    });
    const customer = `cus_r${seq}`;
    const subscriptionId = `sub_r${seq}`;
    const periodEnd = new Date(NOW.getTime() + (opts.renewsInDays ?? 25) * DAY);
    await store.billing.saveAccount({ stripeCustomerId: customer, userId: opts.linked === false ? null : user.id, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
    await store.billing.saveSubscription({
      stripeCustomerId: customer,
      stripeSubscriptionId: subscriptionId,
      tier: 'FREELANCER',
      organizationId: null,
      status: opts.status ?? 'active',
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
      priceLookupKey: 'freelancer_list_yearly_ils',
      founderUntil: null,
      offerId: opts.offerId === undefined ? 'launch-2026' : opts.offerId,
      stripeUpdatedAt: NOW,
      at: NOW,
      audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    });
    stripe.set(subscriptionId, { status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd, firstPaidPeriod: true, unitAmount: 29000, currency: 'ILS', lookupKey: 'freelancer_list_yearly_ils' });
    return { user, subscriptionId, periodEnd };
  }

  const options = (over: Partial<RenewalMailRunOptions> = {}): RenewalMailRunOptions => ({
    store,
    mailer,
    logger,
    now: NOW,
    stripe: {
      renewalOf: async (id) => {
        asked.push(id);
        const facts = stripe.get(id);
        if (facts instanceof Error) throw facts;
        return facts ?? null;
      },
    },
    manageLink: `${ORIGIN}/?billing=true`,
    dryRun: false,
    ...over,
  });

  return { store, outbox, stripe, asked, subscriber, run: (over: Partial<RenewalMailRunOptions> = {}) => runRenewalMail(options(over)) };
}

describe('runRenewalMail (MUT-525 DD8)', () => {
  it('MUT-534 (review): a subscription that came back on the come-back offer is never told its launch-offer year ends', async () => {
    const h = harness();
    const { user } = await h.subscriber({ renewsInDays: 25, offerId: 'comeback-2026' });
    const { summary } = await h.run();
    expect(summary).toMatchObject({ checked: 0, sent: 0 });
    expect(h.outbox.list({ to: user.email })).toHaveLength(0);
  });

  it('mails the payer once, about 30 days ahead: the day, the price the renewal charges, Manage billing', async () => {
    const h = harness();
    const { user, subscriptionId } = await h.subscriber({ renewsInDays: 25 });
    const first = await h.run();
    expect(first.summary).toMatchObject({ checked: 1, due: 1, sent: 1, duplicate: 0 });
    const [mail] = h.outbox.list({ to: user.email });
    expect(mail!.template).toBe('offer-renewing-soon');
    expect(mail!.subject).toBe('Your MTB3A first year ends on November 14, 2027');
    expect(mail!.text).toContain('New price: ₪290 a year, plus VAT where it applies');
    expect(mail!.text).toContain(`${ORIGIN}/?billing=true`);
    expect(h.asked).toEqual([subscriptionId]);
    expect((await h.run()).summary).toMatchObject({ sent: 0, duplicate: 1 });
    expect(h.outbox.list({ to: user.email })).toHaveLength(1);
  });

  it('writes Arabic to an Arabic reader', async () => {
    const h = harness();
    const { user } = await h.subscriber({ locale: 'ar' });
    await h.run();
    expect(h.outbox.list({ to: user.email })[0]!.subject).toBe('تنتهي سنتك الأولى في متابعة يوم 14 تشرين الثاني 2027');
  });

  it(`looks only at offer subscriptions renewing within ${RENEWAL_NOTICE_DAYS} days, active and not cancelling, with a linked payer`, async () => {
    const h = harness();
    await h.subscriber({ renewsInDays: 31 });
    await h.subscriber({ offerId: null });
    await h.subscriber({ status: 'canceled' });
    await h.subscriber({ cancelAtPeriodEnd: true });
    await h.subscriber({ linked: false });
    const run = await h.run();
    expect(run.summary).toMatchObject({ checked: 0, due: 0 });
    expect(h.asked).toEqual([]);
  });

  it('Stripe decides: cancelling, gone, past its first year, or off a list price is skipped and said why', async () => {
    const h = harness();
    // Soonest renewal first.
    const cancelling = await h.subscriber({ renewsInDays: 20 });
    const gone = await h.subscriber({ renewsInDays: 21 });
    const later = await h.subscriber({ renewsInDays: 22 });
    const founder = await h.subscriber({ renewsInDays: 23 });
    h.stripe.set(cancelling.subscriptionId, { ...(h.stripe.get(cancelling.subscriptionId) as RenewalFacts), cancelAtPeriodEnd: true });
    h.stripe.set(gone.subscriptionId, null);
    h.stripe.set(later.subscriptionId, { ...(h.stripe.get(later.subscriptionId) as RenewalFacts), firstPaidPeriod: false });
    h.stripe.set(founder.subscriptionId, { ...(h.stripe.get(founder.subscriptionId) as RenewalFacts), lookupKey: 'freelancer_founder_yearly_ils' });
    const run = await h.run();
    expect(run.rows.map((r) => r.skip)).toEqual(['cancelling', 'gone', 'not-first-year', 'not-list-price']);
    expect(run.summary).toMatchObject({ checked: 4, due: 0, sent: 0 });
    expect(h.outbox.list()).toHaveLength(0);
  });

  it('the price is the subscription’s own, not today’s catalog', async () => {
    const h = harness();
    const { user, subscriptionId } = await h.subscriber();
    h.stripe.set(subscriptionId, { ...(h.stripe.get(subscriptionId) as RenewalFacts), unitAmount: 9000, currency: 'USD', lookupKey: 'freelancer_list_yearly_usd' });
    await h.run();
    expect(h.outbox.list({ to: user.email })[0]!.text).toContain('New price: $90 a year');
  });

  it('a suppressed address is skipped; a dry run mails nothing and says who would get it', async () => {
    const h = harness();
    const quiet = await h.subscriber({ renewsInDays: 20 });
    await h.store.email.suppress({ email: quiet.user.email, reason: 'HARD_BOUNCE', eventId: 'msg_r1', at: NOW });
    const due = await h.subscriber();
    const dry = await h.run({ dryRun: true });
    expect(dry.rows.map((r) => [r.email, r.action, r.skip])).toEqual([
      [quiet.user.email, 'skip', 'suppressed'],
      [due.user.email, 'send', null],
    ]);
    expect(dry.summary).toMatchObject({ dryRun: true, due: 1, sent: 0 });
    expect(h.outbox.list()).toHaveLength(0);
  });

  it('one person’s Stripe failure costs only their mail', async () => {
    const h = harness();
    const broken = await h.subscriber({ renewsInDays: 20 });
    const fine = await h.subscriber({ renewsInDays: 21 });
    h.stripe.set(broken.subscriptionId, new Error('stripe down'));
    const run = await h.run();
    expect(run.rows.map((r) => r.outcome)).toEqual(['failed', 'sent']);
    expect(h.outbox.list({ to: fine.user.email })).toHaveLength(1);
  });
});
