import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createMailer } from '../../email/mailer.js';
import type { MailTransport } from '../../email/ports.js';
import { MemoryMailTransport } from '../../email/transports/memory.js';
import { NOOP_TRANSPORT } from '../../email/transports/noop.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { UserLocale } from '../../repositories/ports.js';
import { runTrialMail, trialMailLinks, trialMailStageOf, TRIAL_MAIL_TIME_BUDGET_MS, type TrialMailRunOptions } from '../trial-mail.js';

/**
 * MUT-419 (ADR-160 D3): the trial reminders. A1: with the memory mailer and a fixed clock each stage sends exactly
 * once, never to a covered, paying or suppressed account. A2: running twice on one day sends nothing new. Stages come
 * from `trialTimelineOf`; who is mailed from the same resolver the lapse gate uses (MUT-361).
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const logger = pino({ level: 'silent' });
/** The trial started at 10:30 UTC; the daily job runs at 10:00 UTC. */
const START = new Date('2026-11-01T10:30:00Z');
const jobAt = (day: number) => new Date(Date.UTC(2026, 10, 1 + day, 10, 0, 0));
const ORIGIN = 'https://portal.example.test';

let seq = 0;

function harness(transport: MailTransport | null = null) {
  const store = new MemoryLedgerStore();
  let clock = jobAt(0);
  const outbox = new MemoryMailTransport(() => clock);
  const makeMailer = (t: MailTransport) =>
    createMailer({ transport: t, store, logger, now: () => clock, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  let mailer = makeMailer(transport ?? outbox);

  async function person(opts: { locale?: UserLocale; trialStart?: Date | null; organizationId?: string } = {}) {
    const { user, personalOrganization } = await store.users.create({
      email: `trial${++seq}@studio.example`,
      displayName: 'Rana Saleh',
      passwordHash: 'x',
      locale: opts.locale ?? 'en',
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      personal: { name: 'Personal', slug: `personal-${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: START,
    });
    if (opts.trialStart !== null) await store.billing.setTrialStart(user.id, opts.trialStart ?? START);
    return { user, personal: personalOrganization };
  }

  async function subscribe(userId: string, status: string) {
    const customer = `cus_${++seq}`;
    await store.billing.saveAccount({ stripeCustomerId: customer, userId, country: 'IL', currency: 'ILS', at: START, linkAudit: [] });
    await store.billing.saveSubscription({
      stripeCustomerId: customer,
      stripeSubscriptionId: `sub_${seq}`,
      tier: 'FREELANCER',
      organizationId: null,
      status,
      currentPeriodEnd: new Date(START.getTime() + 60 * DAY),
      cancelAtPeriodEnd: false,
      priceLookupKey: 'freelancer_list_monthly_ils',
      founderUntil: null,
      stripeUpdatedAt: START,
      at: START,
      audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    });
  }

  async function grant(target: { userId: string } | { organizationId: string }) {
    await store.billing.createGrant({
      id: randomUUID(),
      userId: 'userId' in target ? target.userId : null,
      organizationId: 'organizationId' in target ? target.organizationId : null,
      tier: 'FREELANCER',
      reason: 'pilot',
      expiresAt: null,
      grantedBy: 'admin',
      at: START,
      audit: [],
    });
  }

  const options = (overrides: Partial<TrialMailRunOptions> = {}): TrialMailRunOptions => ({
    store,
    mailer,
    logger,
    now: clock,
    gateOn: true,
    links: trialMailLinks(ORIGIN),
    dryRun: false,
    ...overrides,
  });

  return {
    store,
    outbox,
    person,
    subscribe,
    grant,
    setClock: (at: Date) => {
      clock = at;
    },
    useTransport: (t: MailTransport) => {
      mailer = makeMailer(t);
    },
    run: (overrides: Partial<TrialMailRunOptions> = {}) => runTrialMail(options(overrides)),
  };
}

describe('trialMailStageOf (MUT-419 D1, D2)', () => {
  const at = (days: number, hours = 0) => new Date(START.getTime() + days * DAY + hours * HOUR);
  it.each([
    ['day 10.9', at(10, 22), null],
    ['day 11 exactly', at(11), { stage: 'ending-soon', daysLeft: 3 }],
    ['day 11.5', at(11, 12), { stage: 'ending-soon', daysLeft: 3 }],
    ['day 12', at(12), { stage: 'ending-soon', daysLeft: 2 }],
    ['day 13.5', at(13, 12), { stage: 'ending-soon', daysLeft: 1 }],
    ['the trial’s end', at(14), { stage: 'ended', daysLeft: null }],
    ['day 26.9', at(26, 22), { stage: 'ended', daysLeft: null }],
    ['day 27', at(27), { stage: 'locking-soon', daysLeft: 3 }],
    ['day 29.9', at(29, 22), { stage: 'locking-soon', daysLeft: 1 }],
    ['the lock', at(30), null],
    ['before the trial', at(-1), null],
  ])('%s', (_label, now, expected) => {
    expect(trialMailStageOf(START, now)).toEqual(expected);
  });

  it('R3: a daily run never says more days than are left (job at 10:00, trial started at 10:30)', () => {
    // Day 11's run is half an hour before the window opens; day 12's has 2 days and 30 minutes left: "within 3 days".
    expect(trialMailStageOf(START, jobAt(11))).toBeNull();
    expect(trialMailStageOf(START, jobAt(12))).toEqual({ stage: 'ending-soon', daysLeft: 3 });
    expect(trialMailStageOf(START, jobAt(28))).toEqual({ stage: 'locking-soon', daysLeft: 3 });
  });
});

describe('runTrialMail (MUT-419)', () => {
  it('A1: a trial person with no card gets each stage exactly once, in order, when the job runs every day', async () => {
    const h = harness();
    const { user } = await h.person();
    for (let day = 0; day <= 32; day++) {
      h.setClock(jobAt(day));
      await h.run({ now: jobAt(day) });
    }
    const mails = h.outbox.list({ to: user.email });
    expect(mails.map((m) => [m.template, m.at.slice(0, 10)])).toEqual([
      ['trial-ending-soon', '2026-11-13'],
      ['trial-ended', '2026-11-16'],
      ['trial-locking-soon', '2026-11-29'],
    ]);
    expect(mails[0]!.subject).toBe('Your MTB3A free trial ends within 3 days');
    expect(mails[0]!.text).toContain(`${ORIGIN}/?billing=true&step=subscribe`);
    expect(mails[1]!.text).toContain(`${ORIGIN}/?yourData=true`);
    expect(mails[2]!.subject).toBe('Your MTB3A account locks within 3 days');
  });

  it('A2: running twice on the same day sends nothing new', async () => {
    const h = harness();
    const { user } = await h.person();
    h.setClock(jobAt(15));
    const first = await h.run({ now: jobAt(15) });
    const second = await h.run({ now: jobAt(15) });
    expect(first.summary).toMatchObject({ due: 1, sent: 1, duplicate: 0 });
    expect(second.summary).toMatchObject({ due: 1, sent: 0, duplicate: 1 });
    expect(second.rows).toEqual([expect.objectContaining({ userId: user.id, stage: 'ended', action: 'send', outcome: 'duplicate' })]);
    expect(h.outbox.list({ to: user.email })).toHaveLength(1);
  });

  it('keys each mail trial:<userId>:<stage>, so a later run in another stage still sends', async () => {
    const h = harness();
    const { user } = await h.person();
    h.setClock(jobAt(12));
    await h.run({ now: jobAt(12) });
    h.setClock(jobAt(13));
    expect((await h.run({ now: jobAt(13) })).summary).toMatchObject({ sent: 0, duplicate: 1 });
    h.setClock(jobAt(14));
    // Day 14 at 10:00 is half an hour before the end: still ending-soon, still the same key.
    expect((await h.run({ now: jobAt(14) })).rows[0]).toMatchObject({ stage: 'ending-soon', daysLeft: 1, outcome: 'duplicate' });
    h.setClock(jobAt(15));
    expect((await h.run({ now: jobAt(15) })).rows[0]).toMatchObject({ stage: 'ended', outcome: 'sent' });
    expect(h.outbox.list({ to: user.email }).map((m) => m.template)).toEqual(['trial-ending-soon', 'trial-ended']);
  });

  it('A1: never mails someone paying, covered, suppressed, pending review or disabled', async () => {
    const h = harness();
    const trialing = await h.person(); // Checkout with a trial: a card on file
    await h.subscribe(trialing.user.id, 'trialing');
    const active = await h.person();
    await h.subscribe(active.user.id, 'active');
    const lapsed = await h.person(); // paid, then cancelled: paid-lapse mail is Stripe's (scope out)
    await h.subscribe(lapsed.user.id, 'canceled');
    const granted = await h.person();
    await h.grant({ userId: granted.user.id });
    const suppressed = await h.person();
    await h.store.email.suppress({ email: suppressed.user.email, reason: 'HARD_BOUNCE', eventId: 'msg_1', at: START });
    const pending = await h.person();
    await h.store.users.setStatus(pending.user.id, 'PENDING_REVIEW', START);
    const disabled = await h.person();
    await h.store.users.setStatus(disabled.user.id, 'DISABLED', START);
    const noTrial = await h.person({ trialStart: null });
    const plain = await h.person();

    h.setClock(jobAt(20));
    const { rows, summary } = await h.run({ now: jobAt(20) });
    const why = new Map(rows.map((r) => [r.userId, r.action === 'skip' ? r.skip : r.outcome]));
    expect(why.get(trialing.user.id)).toBe('paying');
    expect(why.get(active.user.id)).toBe('paying');
    expect(why.get(lapsed.user.id)).toBe('paying');
    expect(why.get(granted.user.id)).toBe('covered');
    expect(why.get(suppressed.user.id)).toBe('suppressed');
    expect(why.get(plain.user.id)).toBe('sent');
    for (const absent of [pending, disabled, noTrial]) expect(why.has(absent.user.id)).toBe(false);
    expect(summary).toMatchObject({ due: 1, sent: 1, skipped: { paying: 3, covered: 1, suppressed: 1, otherProfiles: 0, gateOff: 0 } });
    expect(h.outbox.list().map((m) => m.to)).toEqual([plain.user.email]);
  });

  it('R4: skips anyone whose standing the trial alone doesn’t decide, so "your account" is never wrong', async () => {
    const h = harness();
    // A member of an operator firm with no plan (NONE: read-only for ever, never locked).
    const firm = await h.store.organizations.create({ name: 'Firm', slug: `firm-${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const firmMember = await h.person({ organizationId: firm.id });
    // A member of a firm with a plan: they keep writing there after their trial.
    const coveredFirm = await h.store.organizations.create({ name: 'Covered', slug: `firm-${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    await h.grant({ organizationId: coveredFirm.id });
    const coveredMember = await h.person({ organizationId: coveredFirm.id });
    // Their own second profile is covered on its own (an org grant), and one is fed by Malafat.
    const mixed = await h.person();
    const business = await h.store.organizations.createOwned(mixed.user.id, { name: 'Studio', slug: `studio-${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: START }, 6, { actorId: mixed.user.id, requestId: null });
    if (business.kind !== 'created') throw new Error('no business profile');
    await h.grant({ organizationId: business.organization.id });
    const malafat = await h.person();
    const fed = await h.store.organizations.createOwned(malafat.user.id, { name: 'Fed', slug: `fed-${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: START }, 6, { actorId: malafat.user.id, requestId: null });
    if (fed.kind !== 'created') throw new Error('no business profile');
    await h.store.integrations.connect({ organizationId: fed.organization.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Fed', connectedByApiKeyId: randomUUID(), at: START });
    // Two profiles of their own, both on the trial: the trial decides everything, so they are mailed.
    const twoOwn = await h.person();
    await h.store.organizations.createOwned(twoOwn.user.id, { name: 'Shop', slug: `shop-${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: START }, 6, { actorId: twoOwn.user.id, requestId: null });

    h.setClock(jobAt(28));
    const { rows } = await h.run({ now: jobAt(28) });
    const why = new Map(rows.map((r) => [r.userId, r.action === 'skip' ? r.skip : r.outcome]));
    expect(why.get(firmMember.user.id)).toBe('other-profiles');
    expect(why.get(coveredMember.user.id)).toBe('other-profiles');
    expect(why.get(mixed.user.id)).toBe('covered');
    expect(why.get(malafat.user.id)).toBe('covered');
    expect(why.get(twoOwn.user.id)).toBe('sent');
    expect(h.outbox.list().map((m) => [m.to, m.template])).toEqual([[twoOwn.user.email, 'trial-locking-soon']]);
  });

  it('A3: writes in the person’s language (Arabic by default)', async () => {
    const h = harness();
    const ar = await h.person({ locale: 'ar' });
    const en = await h.person({ locale: 'en' });
    h.setClock(jobAt(12));
    await h.run({ now: jobAt(12) });
    const [arMail] = h.outbox.list({ to: ar.user.email });
    const [enMail] = h.outbox.list({ to: en.user.email });
    expect(arMail).toMatchObject({ locale: 'ar', subject: 'تنتهي تجربتك المجانية في متابعة خلال 3 أيام' });
    expect(arMail!.html).toContain('<html lang="ar" dir="rtl">');
    expect(enMail).toMatchObject({ locale: 'en', subject: 'Your MTB3A free trial ends within 3 days' });
  });

  it('a dry run lists who would get what and mails nothing; the real run afterwards still sends', async () => {
    const h = harness();
    const due = await h.person();
    const paying = await h.person();
    await h.subscribe(paying.user.id, 'active');
    h.setClock(jobAt(28));
    const dry = await h.run({ now: jobAt(28), dryRun: true });
    expect(dry.summary).toMatchObject({ dryRun: true, due: 1, sent: 0, skipped: { paying: 1 } });
    expect(dry.rows).toEqual(
      expect.arrayContaining([
        { userId: due.user.id, email: due.user.email, locale: 'en', stage: 'locking-soon', daysLeft: 3, action: 'send', skip: null, outcome: null },
        expect.objectContaining({ userId: paying.user.id, action: 'skip', skip: 'paying' }),
      ]),
    );
    expect(h.outbox.list()).toHaveLength(0);
    expect((await h.run({ now: jobAt(28) })).summary).toMatchObject({ sent: 1 });
  });

  it('with mail off nothing is claimed, so turning mail on later still sends', async () => {
    const h = harness(NOOP_TRANSPORT);
    const { user } = await h.person();
    h.setClock(jobAt(20));
    const off = await h.run({ now: jobAt(20) });
    expect(off.summary).toMatchObject({ due: 1, sent: 0, notSent: 1 });
    expect(off.rows[0]!.outcome).toBe('disabled');
    h.useTransport(h.outbox);
    await h.run({ now: jobAt(20) });
    expect(h.outbox.list({ to: user.email }).map((m) => m.template)).toEqual(['trial-ended']);
  });

  it('R5: with the lapse gate off nobody goes read-only or locks, so nothing is mailed', async () => {
    const h = harness();
    await h.person();
    h.setClock(jobAt(20));
    const { summary, rows } = await h.run({ now: jobAt(20), gateOn: false });
    expect(summary).toMatchObject({ due: 0, sent: 0, skipped: { gateOff: 1 } });
    expect(rows[0]).toMatchObject({ action: 'skip', skip: 'gate-off' });
    expect(h.outbox.list()).toHaveLength(0);
  });

  it('R1: stops starting sends once its time budget is spent, and the next run sends the rest once', async () => {
    const h = harness();
    const first = await h.person({ trialStart: new Date(START.getTime() - HOUR) });
    const second = await h.person();
    h.setClock(jobAt(20));
    // The budget is measured on its own clock, not the business one: the run's `now` stays fixed.
    const ticks = [0, TRIAL_MAIL_TIME_BUDGET_MS + 1];
    const cut = await h.run({ now: jobAt(20), elapsedMs: () => ticks.shift() ?? Number.POSITIVE_INFINITY });
    expect(cut.summary).toMatchObject({ incomplete: true, sent: 1 });
    expect(cut.rows.map((r) => r.userId)).toEqual([first.user.id]);
    const rest = await h.run({ now: jobAt(20) });
    expect(rest.summary).toMatchObject({ incomplete: false, sent: 1, duplicate: 1 });
    expect(h.outbox.list().map((m) => m.to)).toEqual([first.user.email, second.user.email]);
  });
});
