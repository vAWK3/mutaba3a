import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { mailOffToken } from '../../email/mail-off-token.js';
import { unsubscribeToken } from '../../email/unsubscribe.js';
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
const PORTAL = 'https://portal.example.test';
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const OFFER: ComebackOffer = {
  id: 'comeback-2026',
  plan: 'freelancer',
  percentOff: null,
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

  async function lapsed(opts: { locale?: UserLocale; endedDaysAgo?: number; tier?: 'FREELANCER' | 'SOLO' | 'BUSINESS' | 'FIRM' | 'ACCOUNTANT'; currency?: 'ILS' | 'USD'; paidInvoices?: number } = {}) {
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
    optOut: { portalOrigin: PORTAL, pepper: PEPPER },
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
    expect(mail!.subject).toBe('פרסומת: سجلاتك في متابعة ما زالت هنا');
    expect(mail!.text).toContain('⁨₪9⁩');
    expect(mail!.text).toContain('⁨₪270⁩');
    expect(mail!.html).toContain('step=subscribe');
    // s.30A: an advertisement says so in the footer; it is no service email, and it offers its way out
    expect(mail!.html).toContain('هذه رسالة إعلانية من متابعة');
    expect(mail!.html).not.toContain('رسالة خدمة');
    expect(mail!.text).toContain('هذه رسالة إعلانية من متابعة');
    expect(mail!.text).not.toContain('بسبب إجراء على حسابك');
    expect(mail!.html).toContain('data-opt-out');
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
    expect(mail!.subject).toBe('פרסומת: Come back to MTB3A for $3 your first month');
    expect(mail!.text).toContain('then $9 a month');
    expect(mail!.html).toContain('This is a promotional email from MTB3A');
    expect(mail!.html).not.toContain('service email');
    expect(mail!.text).toContain('This is a promotional email from MTB3A');
    expect(mail!.text).not.toContain('because of an action on your MTB3A account');
    expect(mail!.text).toContain('Unsubscribe.');
  });

  it('skips with a reason: never paid, a stay offer this year, covered by a grant, between the windows, suppressed', async () => {
    const h = harness();
    await h.lapsed({ paidInvoices: 0 });

    const stay = await h.lapsed();
    await h.store.billing.claimRetentionEvent({ userId: stay.user.id, stripeSubscriptionId: stay.subscriptionId, kind: 'STAY_OFFER', reason: 'too_expensive', months: 2, startsAt: ago(100), endsAt: null, at: ago(100) });
    const granted = await h.lapsed();
    await h.store.billing.createGrant({ id: randomUUID(), userId: granted.user.id, organizationId: null, tier: 'FREELANCER', reason: 'pilot', expiresAt: null, grantedBy: 'admin', at: ago(1), audit: [] });
    await h.lapsed({ endedDaysAgo: 60 });
    const quiet = await h.lapsed();
    await h.store.email.suppress({ email: quiet.user.email, reason: 'HARD_BOUNCE', eventId: 'msg_b1', at: NOW });
    const { summary } = await h.run();
    expect(summary).toMatchObject({ sent: 0, skipped: { neverPaid: 1, firm: 0, stayOfferRecent: 1, covered: 1, noStage: 1, suppressed: 1 } });
    expect(h.outbox.list({})).toHaveLength(0);
    expect(await h.store.billing.retentionEventsOf(quiet.user.id)).toEqual([]);
  });

  describe('MUT-703 (§13 Q5): with the plans on sale, the plan the person lapsed from at the plans’ percent', () => {
    const planOffer = (plan: 'solo' | 'business' | 'firm', first: number, list: number): ComebackOffer => ({
      id: 'comeback-plans-2026',
      plan,
      percentOff: 67,
      couponIds: { ILS: 'mtb3a_comeback_first_month_plans_67', USD: 'mtb3a_comeback_first_month_plans_67' },
      firstMonth: { ILS: first, USD: null },
      listMonth: { ILS: list, USD: null },
      firstYear: { ILS: null, USD: null },
      listYear: { ILS: null, USD: null },
    });
    const PLAN_OFFERS = { solo: planOffer('solo', 1287, 3900), business: planOffer('business', 2937, 8900), firm: planOffer('firm', 8217, 24900) };

    it('a lapsed Firm payer is mailed Firm’s first month (no yearly line); a legacy Freelancer lapser is offered Solo', async () => {
      const h = harness();
      const asked: Array<string | null> = [];
      const firm = await h.lapsed({ tier: 'FIRM' });
      const legacy = await h.lapsed({ tier: 'FREELANCER', locale: 'ar' });
      const stripe = { offer: async (plan: 'solo' | 'business' | 'firm' | null) => (asked.push(plan), plan ? PLAN_OFFERS[plan] : OFFER), paidInvoices: async () => 1 };
      const { summary } = await h.run({ planSales: true, stripe });
      expect(summary).toMatchObject({ sent: 2, skipped: { firm: 0 } });
      // One read per plan a run needs.
      expect(asked.sort()).toEqual(['firm', 'solo']);
      const [firmMail] = h.outbox.list({ to: firm.user.email });
      expect(firmMail!.text).toContain('Plan: Firm');
      expect(firmMail!.text).toContain('Come back to Firm for ₪82.17 for your first month, then ₪249 a month.');
      expect(firmMail!.text).not.toContain('Prefer a year?');
      const [legacyMail] = h.outbox.list({ to: legacy.user.email });
      expect(legacyMail!.text).toContain('«مستقل»');
      expect(legacyMail!.text).toContain('⁨₪12.87⁩');
      expect(legacyMail!.text).not.toContain('تفضّل الاشتراك السنوي');
    });

    it('with the plans off, the legacy offer as before (Firm included now)', async () => {
      const h = harness();
      const asked: Array<string | null> = [];
      const firm = await h.lapsed({ tier: 'FIRM' });
      await h.run({ stripe: { offer: async (plan) => (asked.push(plan), OFFER), paidInvoices: async () => 1 } });
      expect(asked).toEqual([null]);
      expect(h.outbox.list({ to: firm.user.email })[0]!.text).toContain('Prefer a year? Your first year is ₪270, then ₪290.');
    });
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

  it('is promotional: it carries a one-click unsubscribe (link and List-Unsubscribe headers), and an opted-out person is skipped (ADR-279)', async () => {
    const h = harness();
    const { user } = await h.lapsed();
    await h.run();
    const [mail] = h.outbox.list({ to: user.email });
    const token = mailOffToken(PEPPER, user.id);
    expect(mail!.html).toContain(`${PORTAL}/mail-off?mail=offers#${token}`);
    expect(mail!.text).toContain(`${PORTAL}/mail-off?mail=offers#${token}`);
    expect(mail!.headers).toEqual({
      'List-Unsubscribe': `<${PORTAL}/v1/mail-preferences/unsubscribe?mail=offers&token=${unsubscribeToken(PEPPER, 'offers', user.id)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });

    const quiet = await h.lapsed();
    await h.store.users.setOfferMail(quiet.user.id, 'OFF', NOW);
    const { summary, rows } = await h.run();
    expect(rows.find((r) => r.userId === quiet.user.id)).toMatchObject({ action: 'skip', skip: 'opted-out' });
    expect(summary.skipped.optedOut).toBe(1);
    expect(h.outbox.list({ to: quiet.user.email })).toHaveLength(0);
    expect(await h.store.billing.retentionEventsOf(quiet.user.id)).toEqual([]);
  });
});
