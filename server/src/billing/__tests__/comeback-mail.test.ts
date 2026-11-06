import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createMailer } from '../../email/mailer.js';
import { MemoryMailTransport } from '../../email/transports/memory.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { UserLocale } from '../../repositories/ports.js';
import { runComebackMail, type ComebackRunOptions } from '../comeback-mail.js';
import type { ComebackOffer } from '../comeback.js';

/**
 * MUT-534 (D10–D13): the daily come-back mail. Candidates are subscriptions Stripe ended 30–104 days ago; the rules
 * decide; Stripe says whether the plan took money. Each stage is recorded (COMEBACK_OFFERED) before it is mailed, once
 * per person ever, and that record is what opens the offer at Checkout.
 */
const logger = pino({ level: 'silent' });
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-03-10T08:30:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const SUBSCRIBE = 'https://portal.example.test/?billing=true&step=subscribe';
const OFFER: ComebackOffer = {
  id: 'comeback-2026',
  couponIds: { ILS: 'mtb3a_comeback_first_month_ils', USD: 'mtb3a_comeback_first_month_usd' },
  firstMonth: { ILS: 900, USD: 300 },
  listMonth: { ILS: 2900, USD: 900 },
  firstYear: { ILS: 27000, USD: 8400 },
  listYear: { ILS: 29000, USD: 9000 },
};
let seq = 0;

function harness() {
  const store = new MemoryLedgerStore();
  const outbox = new MemoryMailTransport(() => NOW);
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const paid = new Map<string, number>();

  async function lapsed(opts: { locale?: UserLocale; endedDaysAgo?: number; tier?: 'FREELANCER' | 'FIRM' | 'ACCOUNTANT'; currency?: 'ILS' | 'USD'; paidInvoices?: number } = {}) {
    const { user } = await store.users.create({
      email: `back${++seq}@studio.example`,
      displayName: 'Rana Saleh',
      passwordHash: 'x',
      locale: opts.locale ?? 'en',
      personal: { name: 'Personal', slug: `personal-b${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: NOW,
    });
    const customer = `cus_b${seq}`;
    const subscriptionId = `sub_b${seq}`;
    await store.billing.saveAccount({ stripeCustomerId: customer, userId: user.id, country: 'IL', currency: opts.currency ?? 'ILS', at: NOW, linkAudit: [] });
    await store.billing.saveSubscription({
      stripeCustomerId: customer,
      stripeSubscriptionId: subscriptionId,
      tier: opts.tier ?? 'FREELANCER',
      organizationId: null,
      status: 'canceled',
      currentPeriodEnd: ago((opts.endedDaysAgo ?? 31) - 10),
      cancelAtPeriodEnd: false,
      priceLookupKey: 'freelancer_list_monthly_ils',
      founderUntil: null,
      offerId: null,
      endedAt: ago(opts.endedDaysAgo ?? 31),
      stripeUpdatedAt: NOW,
      at: NOW,
      audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    });
    paid.set(subscriptionId, opts.paidInvoices ?? 1);
    return { user, subscriptionId };
  }

  const options = (over: Partial<ComebackRunOptions> = {}): ComebackRunOptions => ({
    store,
    mailer,
    logger,
    now: NOW,
    stripe: { offer: async () => OFFER, paidInvoices: async (id) => paid.get(id) ?? 0 },
    subscribeLink: SUBSCRIBE,
    dryRun: false,
    ...over,
  });

  return { store, outbox, lapsed, run: (over: Partial<ComebackRunOptions> = {}) => runComebackMail(options(over)) };
}

describe('runComebackMail (MUT-534)', () => {
  it('30 days after a paid lapse: one mail in their language with the come-back prices, recorded; a second run sends nothing', async () => {
    const h = harness();
    const { user, subscriptionId } = await h.lapsed({ locale: 'ar' });
    const first = await h.run();
    expect(first.summary).toMatchObject({ checked: 1, due: 1, sent: 1 });
    const [mail] = h.outbox.list({ to: user.email });
    expect(mail!.template).toBe('comeback-offer');
    expect(mail!.subject).toBe('سجلاتك في متابعة ما زالت هنا');
    expect(mail!.text).toContain('⁨₪9⁩');
    expect(mail!.text).toContain('⁨₪270⁩');
    expect(mail!.html).toContain('step=subscribe');
    expect(await h.store.billing.retentionEventsOf(user.id)).toMatchObject([{ kind: 'COMEBACK_OFFERED', reason: 'day-30', stripeSubscriptionId: subscriptionId }]);
    const second = await h.run();
    expect(second.rows[0]).toMatchObject({ action: 'skip', skip: 'already-mailed' });
    expect(h.outbox.list({ to: user.email })).toHaveLength(1);
  });

  it('90 days after: the day-90 mail, in dollars for a dollar payer', async () => {
    const h = harness();
    const { user } = await h.lapsed({ endedDaysAgo: 91, currency: 'USD' });
    await h.run();
    const [mail] = h.outbox.list({ to: user.email });
    expect(mail!.subject).toBe('Come back to MTB3A for $3 your first month');
    expect(mail!.text).toContain('then $9 a month');
  });

  it('skips with a reason: never paid, Firm, a stay offer this year, covered by a grant, between the windows, suppressed', async () => {
    const h = harness();
    await h.lapsed({ paidInvoices: 0 });
    await h.lapsed({ tier: 'FIRM' });
    const stay = await h.lapsed();
    await h.store.billing.claimRetentionEvent({ userId: stay.user.id, stripeSubscriptionId: stay.subscriptionId, kind: 'STAY_OFFER', reason: 'too_expensive', months: 2, startsAt: ago(100), endsAt: null, at: ago(100) });
    const granted = await h.lapsed();
    await h.store.billing.createGrant({ id: randomUUID(), userId: granted.user.id, organizationId: null, tier: 'FREELANCER', reason: 'pilot', expiresAt: null, grantedBy: 'admin', at: ago(1), audit: [] });
    await h.lapsed({ endedDaysAgo: 60 });
    const quiet = await h.lapsed();
    await h.store.email.suppress({ email: quiet.user.email, reason: 'HARD_BOUNCE', eventId: 'msg_b1', at: NOW });
    const { summary } = await h.run();
    expect(summary).toMatchObject({ sent: 0, skipped: { neverPaid: 1, firm: 1, stayOfferRecent: 1, covered: 1, noStage: 1, suppressed: 1 } });
    expect(h.outbox.list({})).toHaveLength(0);
    expect(await h.store.billing.retentionEventsOf(quiet.user.id)).toEqual([]);
  });

  it('MUT-565: an Accountant plan that ended is no come-back for the Freelancer plan: nobody is looked at or mailed', async () => {
    const h = harness();
    const { user } = await h.lapsed({ tier: 'ACCOUNTANT' });
    const { summary } = await h.run();
    expect(summary).toMatchObject({ checked: 0, sent: 0 });
    expect(h.outbox.list({ to: user.email })).toHaveLength(0);
  });

  it('no running offer (no coupon, or a wrong one) mails nobody and records nothing', async () => {
    const h = harness();
    const { user } = await h.lapsed();
    const { summary } = await h.run({ stripe: { offer: async () => null, paidInvoices: async () => 1 } });
    expect(summary).toMatchObject({ sent: 0, skipped: { noOffer: 1 } });
    expect(await h.store.billing.retentionEventsOf(user.id)).toEqual([]);
  });

  it('a dry run records and mails nothing', async () => {
    const h = harness();
    const { user } = await h.lapsed();
    const { rows } = await h.run({ dryRun: true });
    expect(rows[0]).toMatchObject({ action: 'send', stage: 'day-30', outcome: null });
    expect(h.outbox.list({})).toHaveLength(0);
    expect(await h.store.billing.retentionEventsOf(user.id)).toEqual([]);
  });

  it('a mail that couldn’t go out releases its record, so the next run tries again and the offer stays shut', async () => {
    const h = harness();
    const { user } = await h.lapsed();
    const failing = createMailer({ transport: { kind: 'resend', deliver: async () => Promise.reject(new Error('down')) }, store: h.store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
    const { rows } = await h.run({ mailer: failing });
    expect(rows[0]).toMatchObject({ action: 'send', outcome: 'failed' });
    expect(await h.store.billing.retentionEventsOf(user.id)).toEqual([]);
    await h.run();
    expect(h.outbox.list({ to: user.email })).toHaveLength(1);
  });
});
