import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createMailer } from '../../email/mailer.js';
import { MemoryMailTransport } from '../../email/transports/memory.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { UserLocale } from '../../repositories/ports.js';
import { cardFailedStageOf, FIRST_MAIL_WITHIN_HOURS, runCardFailedMail, type CardFailedRunOptions, type FailedPaymentFacts } from '../card-failed-mail.js';

/**
 * MUT-533 (plan D1–D7): our own failed-card mail. An hourly run looks at the mirror's past_due subscriptions; Stripe's
 * open invoices decide. One dunning episode per subscription (its oldest open invoice that a payment attempt failed
 * on): a first mail within 72 h of the first failure, one reminder from the window's midpoint while Stripe still has a
 * retry booked, and never more than those two per invoice. No amount, no card details (Basel, 2026-11-02).
 */
const logger = pino({ level: 'silent' });
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2027-03-10T09:07:00Z');
const WINDOW = 14;
const ORIGIN = 'https://portal.example.test';
let seq = 0;

const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);

function failing(over: Partial<NonNullable<FailedPaymentFacts['episode']>> = {}, status = 'past_due'): FailedPaymentFacts {
  return { status, episode: { invoiceId: 'in_1', attemptCount: 1, nextPaymentAttempt: later(3 * DAY), firstFailedAt: ago(2 * HOUR), needsAuthentication: false, ...over } };
}

describe('cardFailedStageOf (MUT-533 D2)', () => {
  it('the first mail while the first failure is under 72 hours old', () => {
    expect(cardFailedStageOf(failing(), NOW, WINDOW)).toEqual({ stage: 'first', invoiceId: 'in_1' });
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(FIRST_MAIL_WITHIN_HOURS * HOUR - 1) }), NOW, WINDOW)).toMatchObject({ stage: 'first' });
  });

  it('no first mail once 72 hours have passed (a pruned send-log key can never make it current again)', () => {
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(FIRST_MAIL_WITHIN_HOURS * HOUR) }), NOW, WINDOW)).toEqual({ skip: 'no-stage' });
  });

  it('the reminder from the window’s midpoint, not a minute before, with the days left as an upper bound', () => {
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(7 * DAY) }), NOW, WINDOW)).toEqual({ stage: 'reminder', invoiceId: 'in_1', daysLeft: 7 });
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(7 * DAY - 60_000) }), NOW, WINDOW)).toEqual({ skip: 'no-stage' });
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(12 * DAY + HOUR) }), NOW, WINDOW)).toEqual({ stage: 'reminder', invoiceId: 'in_1', daysLeft: 2 });
  });

  it('a short window still waits 3 days for the reminder, and never names fewer than 1 day', () => {
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(3 * DAY - 60_000) }), NOW, 7)).toEqual({ stage: 'first', invoiceId: 'in_1' });
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(3 * DAY) }), NOW, 7)).toEqual({ skip: 'no-stage' });
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(3.5 * DAY) }), NOW, 7)).toEqual({ stage: 'reminder', invoiceId: 'in_1', daysLeft: 4 });
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(9 * DAY) }), NOW, 7)).toEqual({ stage: 'reminder', invoiceId: 'in_1', daysLeft: 1 });
  });

  it('nothing once Stripe has no retry booked: neither the reminder nor a first mail that would promise one (review)', () => {
    expect(cardFailedStageOf(failing({ firstFailedAt: ago(8 * DAY), nextPaymentAttempt: null }), NOW, WINDOW)).toEqual({ skip: 'no-stage' });
    expect(cardFailedStageOf(failing({ nextPaymentAttempt: null }), NOW, WINDOW)).toEqual({ skip: 'no-stage' });
  });

  it('nothing when the subscription is no longer past_due, the invoice settled, or the bank wants the person to confirm', () => {
    expect(cardFailedStageOf(failing({}, 'active'), NOW, WINDOW)).toEqual({ skip: 'not-past-due' });
    expect(cardFailedStageOf({ status: 'past_due', episode: null }, NOW, WINDOW)).toEqual({ skip: 'settled' });
    expect(cardFailedStageOf(failing({ needsAuthentication: true }), NOW, WINDOW)).toEqual({ skip: 'needs-authentication' });
    expect(cardFailedStageOf(null, NOW, WINDOW)).toEqual({ skip: 'gone' });
  });
});

function harness() {
  const store = new MemoryLedgerStore();
  let clock = NOW;
  const outbox = new MemoryMailTransport(() => clock);
  const mailer = createMailer({ transport: outbox, store, logger, now: () => clock, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const stripe = new Map<string, FailedPaymentFacts | Error | null>();
  const asked: string[] = [];

  async function payer(opts: { locale?: UserLocale; status?: string; linked?: boolean; facts?: FailedPaymentFacts | Error | null; tier?: 'FREELANCER' | 'ACCOUNTANT' } = {}) {
    const { user } = await store.users.create({
      email: `card${++seq}@studio.example`,
      displayName: 'Rana Saleh',
      passwordHash: 'x',
      locale: opts.locale ?? 'en',
      personal: { name: 'Personal', slug: `personal-c${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: NOW,
    });
    const customer = `cus_c${seq}`;
    const subscriptionId = `sub_c${seq}`;
    await store.billing.saveAccount({ stripeCustomerId: customer, userId: opts.linked === false ? null : user.id, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
    await store.billing.saveSubscription({
      stripeCustomerId: customer,
      stripeSubscriptionId: subscriptionId,
      tier: opts.tier ?? 'FREELANCER',
      organizationId: null,
      status: opts.status ?? 'past_due',
      currentPeriodEnd: later(30 * DAY),
      cancelAtPeriodEnd: false,
      priceLookupKey: 'freelancer_list_monthly_ils',
      founderUntil: null,
      offerId: null,
      stripeUpdatedAt: NOW,
      at: NOW,
      audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    });
    stripe.set(subscriptionId, opts.facts === undefined ? failing({ invoiceId: `in_c${seq}` }) : opts.facts);
    return { user, subscriptionId };
  }

  const options = (over: Partial<CardFailedRunOptions> = {}): CardFailedRunOptions => ({
    store,
    mailer,
    logger,
    now: clock,
    stripe: {
      failedPaymentOf: async (id) => {
        asked.push(id);
        const facts = stripe.get(id);
        if (facts instanceof Error) throw facts;
        return facts ?? null;
      },
    },
    updateLink: `${ORIGIN}/?billing=true`,
    windowDays: WINDOW,
    readOnlyAfter: true,
    dryRun: false,
    ...over,
  });

  return {
    store,
    outbox,
    stripe,
    asked,
    payer,
    setNow: (at: Date) => (clock = at),
    run: (over: Partial<CardFailedRunOptions> = {}) => runCardFailedMail(options(over)),
  };
}

describe('runCardFailedMail (MUT-533)', () => {
  it('mails the payer once in their language: what failed, access stays open, Update card, no amount or card', async () => {
    const h = harness();
    const { user } = await h.payer({ locale: 'ar' });
    const first = await h.run();
    expect(first.summary).toMatchObject({ checked: 1, due: 1, sent: 1, duplicate: 0 });
    const [mail] = h.outbox.list({ to: user.email });
    expect(mail!.template).toBe('card-failed');
    expect(mail!.locale).toBe('ar');
    expect(mail!.subject).toBe('لم تنجح عملية الدفع ببطاقتك');
    expect(mail!.text).toContain('يبقى حسابك مفتوحًا بالكامل');
    expect(mail!.html).toContain(`${ORIGIN}/?billing=true`);
    expect(mail!.text).not.toMatch(/₪|\$|\d{4}/);

    const second = await h.run();
    expect(second.summary).toMatchObject({ sent: 0, duplicate: 1 });
    expect(h.outbox.list({ to: user.email })).toHaveLength(1);
  });

  it('never more than two mails for one invoice: the first, then the reminder, then nothing', async () => {
    const h = harness();
    const { user, subscriptionId } = await h.payer();
    await h.run();
    h.stripe.set(subscriptionId, failing({ invoiceId: 'in_c' + seq, firstFailedAt: ago(8 * DAY) }));
    const reminder = await h.run();
    expect(reminder.rows[0]).toMatchObject({ stage: 'reminder', outcome: 'sent' });
    for (let i = 0; i < 3; i += 1) await h.run();
    const mails = h.outbox.list({ to: user.email });
    expect(mails.map((m) => m.template)).toEqual(['card-failed', 'card-failed-reminder']);
    expect(mails[1]!.subject).toBe('Your card still isn’t going through');
    expect(mails[1]!.text).toContain('your plan ends within 6 days at most, and your account becomes read-only');
  });

  it('only the current stage: a run that finds the reminder due sends it alone', async () => {
    const h = harness();
    const { user } = await h.payer({ facts: failing({ invoiceId: 'in_late', firstFailedAt: ago(9 * DAY) }) });
    await h.run();
    expect(h.outbox.list({ to: user.email }).map((m) => m.template)).toEqual(['card-failed-reminder']);
  });

  it('the reminder doesn’t promise read-only while the lapse gate is off', async () => {
    const h = harness();
    const { user } = await h.payer({ facts: failing({ firstFailedAt: ago(8 * DAY) }) });
    await h.run({ readOnlyAfter: false });
    const [mail] = h.outbox.list({ to: user.email });
    expect(mail!.text).toContain('your plan ends within 6 days at most.');
    expect(mail!.text).not.toContain('read-only');
  });

  it('a new failed invoice is its own episode with its own keys', async () => {
    const h = harness();
    const { user, subscriptionId } = await h.payer({ facts: failing({ invoiceId: 'in_a' }) });
    await h.run();
    h.stripe.set(subscriptionId, failing({ invoiceId: 'in_b' }));
    await h.run();
    expect(h.outbox.list({ to: user.email })).toHaveLength(2);
  });

  it('skips with a reason: settled, not past_due in Stripe, 3-D Secure, gone, suppressed; unlinked and active rows are never candidates', async () => {
    const h = harness();
    await h.payer({ facts: { status: 'past_due', episode: null } });
    await h.payer({ facts: failing({}, 'active') });
    await h.payer({ facts: failing({ needsAuthentication: true }) });
    await h.payer({ facts: null });
    const { user: suppressed } = await h.payer();
    await h.store.email.suppress({ email: suppressed.email, reason: 'HARD_BOUNCE', eventId: 'msg_c1', at: NOW });
    await h.payer({ linked: false });
    await h.payer({ status: 'active' });
    const { summary } = await h.run();
    expect(summary).toMatchObject({ checked: 5, sent: 0, skipped: { settled: 1, notPastDue: 1, needsAuthentication: 1, gone: 1, suppressed: 1, noStage: 0 } });
    expect(h.outbox.list({})).toHaveLength(0);
  });

  it('a dry run mails nothing and says who it would mail', async () => {
    const h = harness();
    await h.payer();
    const { summary, rows } = await h.run({ dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, due: 1, sent: 0 });
    expect(rows[0]).toMatchObject({ action: 'send', stage: 'first', outcome: null });
    expect(h.outbox.list({})).toHaveLength(0);
  });

  it('one Stripe failure costs only its row; the next hour tries again', async () => {
    const h = harness();
    await h.payer({ facts: new Error('stripe down') });
    const { user } = await h.payer();
    const { summary, rows } = await h.run();
    expect(rows[0]).toMatchObject({ outcome: 'failed' });
    expect(summary).toMatchObject({ checked: 2, sent: 1 });
    expect(h.outbox.list({ to: user.email })).toHaveLength(1);
  });

  it('stops starting sends when its time budget runs out', async () => {
    const h = harness();
    await h.payer();
    await h.payer();
    let calls = 0;
    const { summary } = await h.run({ elapsedMs: () => (calls++ === 0 ? 0 : 10_000), budgetMs: 5_000 });
    expect(summary).toMatchObject({ checked: 1, incomplete: true });
  });
});

describe('MUT-565 (test 10, review 1): an Accountant plan’s failed card', () => {
  it('the mails for a Freelancer plan never name a plan; the account lines stay as they were', async () => {
    const { renderMail } = await import('../../email/templates/index.js');
    for (const locale of ['en', 'ar'] as const) {
      const first = renderMail('card-failed', locale, { updateLink: 'https://app.example.test/?billing=true' });
      expect(`${first.subject}\n${first.text}`).not.toMatch(/Freelancer|المستقل/);
    }
  });

  it('an ACCOUNTANT past_due run mails the client-books copy: only books past the free 3 lock, never "read-only"', async () => {
    const h = harness();
    const en = await h.payer({ tier: 'ACCOUNTANT', facts: failing({ invoiceId: 'in_acc_en', firstFailedAt: ago(8 * DAY) }) });
    const ar = await h.payer({ tier: 'ACCOUNTANT', locale: 'ar', facts: failing({ invoiceId: 'in_acc_ar' }) });
    await h.run();
    const [reminder] = h.outbox.list({ to: en.user.email });
    expect(reminder!.template).toBe('card-failed-reminder');
    expect(reminder!.text).toContain('Accountant plan');
    expect(reminder!.text).toContain('3 oldest client books');
    expect(reminder!.text).not.toMatch(/read-only/);
    const [first] = h.outbox.list({ to: ar.user.email });
    expect(first!.template).toBe('card-failed');
    expect(first!.text).toContain('خطة المحاسب');
    expect(first!.text).toContain('دفاتر عملائك');
  });
});
