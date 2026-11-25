import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { runMonthlySummaryMail, type MonthlySummaryRunOptions } from '../billing/monthly-summary-mail.js';
import type { Catalog } from '../billing/checkout.js';
import type { PlanGateway } from '../billing/stripe/plan-gateway.js';
import { verifyMailOffToken } from '../email/mail-off-token.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-535 (plan D1–D13): the monthly summary run. People are made through the API (so their records are real), their
 * billing facts are written to the store, and the run is called directly with a memory mailer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const logger = pino({ level: 'silent' });
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const PORTAL = 'https://portal.example.test';
/** 1 December 2026, 14:00 in Jerusalem: the run reports November. */
const NOW = new Date('2026-12-01T12:00:00Z');
const CATALOG: Catalog = {
  ILS: { month: { id: 'price_m_ils', unitAmount: 2900, productId: 'prod_f' }, year: { id: 'price_y_ils', unitAmount: 29000, productId: 'prod_f' } },
  USD: { month: { id: 'price_m_usd', unitAmount: 900, productId: 'prod_f' }, year: { id: 'price_y_usd', unitAmount: 9000, productId: 'prod_f' } },
};
let seq = 0;
let ik = 0;
const idem = () => ({ 'idempotency-key': `mut535-key-${++ik}` });
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function harness(setup: { dailyCap?: number } = {}) {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-11-20T09:00:00Z') };
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  const outbox = new MemoryMailTransport(() => NOW);
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: setup.dailyCap ?? 500, securityReserve: 0, perRecipient: 3 } });
  const paid = new Map<string, number>();

  async function person(opts: { locale?: 'ar' | 'en'; timezone?: string; plan?: 'monthly' | 'trial' | 'none'; verified?: boolean; paidInvoices?: number } = {}) {
    const firm = await read(await app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, { 'x-admin-token': ADMIN_TOKEN })));
    const email = `p${seq}@studio.ps`;
    const created = await provisionUser(app, { email, displayName: 'Rana Saleh', organizationId: firm.id, locale: opts.locale ?? 'en', ...(opts.timezone ? { timezone: opts.timezone } : {}) });
    const userId = created.user.id as string;
    const personal = created.personalProfile.id as string;
    const res = await app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
    const cookie = `${COOKIE}=${new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? ''}`;
    const on = { cookie, ...SAME_ORIGIN, 'x-mutaba3a-profile': personal };
    const people = (store as Loose).people as Map<string, Loose>;
    people.get(userId).emailVerifiedAt = opts.verified === false ? null : clock.now;
    const plan = opts.plan ?? 'monthly';
    if (plan === 'trial') (store as Loose).trialStarts.set(userId, new Date(NOW.getTime() - 5 * 86_400_000));
    if (plan === 'monthly') {
      await store.billing.saveAccount({ stripeCustomerId: `cus_${seq}`, userId, country: 'IL', currency: 'ILS', at: clock.now, linkAudit: [] });
      await store.billing.saveSubscription({
        stripeCustomerId: `cus_${seq}`,
        stripeSubscriptionId: `sub_${seq}`,
        tier: 'FREELANCER',
        organizationId: null,
        status: 'active',
        currentPeriodEnd: new Date('2026-12-20T00:00:00Z'),
        cancelAtPeriodEnd: false,
        priceLookupKey: 'freelancer_list_monthly_ils',
        founderUntil: null,
        offerId: null,
        endedAt: null,
        stripeUpdatedAt: clock.now,
        at: clock.now,
        audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
      });
      paid.set(`sub_${seq}`, opts.paidInvoices ?? 1);
    }
    const income = (body: Record<string, unknown>) => app.request('/v1/income', json({ currency: 'ILS', ...body }, { ...on, ...idem() }));
    const customer = async () => (await read(await app.request('/v1/customers', json({ name: `Client ${++seq}` }, { ...on, ...idem() })))).id as string;
    return { userId, personal, email, income, customer, store };
  }

  const options = (over: Partial<MonthlySummaryRunOptions> = {}): MonthlySummaryRunOptions => ({
    store,
    mailer,
    logger,
    now: NOW,
    portalOrigin: PORTAL,
    pepper: PEPPER,
    stripe: { catalog: async () => CATALOG, plan: { paidInvoiceCount: async (id: string) => paid.get(id) ?? 0 } as unknown as PlanGateway },
    dryRun: false,
    ...over,
  });
  const mailsTo = (email: string) => outbox.list({ to: email }).filter((m) => m.template === 'monthly-summary');
  return { app, store, clock, outbox, person, mailsTo, run: (over: Partial<MonthlySummaryRunOptions> = {}) => runMonthlySummaryMail(options(over)) };
}

describe('MUT-535: the monthly summary run', () => {
  it('mails a payer last month per currency, with the In & out link and an opt-out link that names them (AC1)', async () => {
    const h = await harness();
    const p = await h.person();
    const client = await p.customer();
    const first = await p.income({ kind: 'received', amount: '12400.00', occurredOn: '2026-11-05' });
    expect(first.status, await first.clone().text()).toBe(201);
    expect((await p.income({ kind: 'received', amount: '900.00', currency: 'USD', occurredOn: '2026-11-07' })).status).toBe(201);
    expect((await p.income({ kind: 'owed', amount: '3200.00', occurredOn: '2026-11-02', dueDate: '2026-11-15', customerId: client, title: 'Work' })).status).toBe(201);
    expect((await p.income({ kind: 'received', amount: '50.00', occurredOn: '2026-10-05' })).status).toBe(201);

    const { summary } = await h.run();

    expect(summary).toMatchObject({ month: '2026-11', sent: 1, incomplete: false });
    const [mail] = h.mailsTo(p.email);
    expect(mail!.subject).toBe('Your November in MTB3A');
    expect(mail!.text).toContain('Came in during November: ₪12,400 · $900');
    expect(mail!.text).toContain('Still owed: ₪3,200');
    expect(mail!.text).toContain('Overdue: ₪3,200 (1 entry)');
    // MUT-657: the profile's home, opened on In & out (this month's money), not Owed
    expect(mail!.text).toContain(`${PORTAL}/p/${p.personal}?view=in-out`);
    const token = /mail-off#([A-Za-z0-9_.-]+)/.exec(mail!.text)?.[1] ?? '';
    expect(verifyMailOffToken(PEPPER, token)).toBe(p.userId);
    // ADR-279: mail clients offer their own one-click unsubscribe (RFC 8058)
    expect(mail!.headers).toEqual({
      'List-Unsubscribe': `<${PORTAL}/v1/mail-preferences/unsubscribe?mail=monthly-summary&token=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    // One paid invoice: no yearly line yet (AC4).
    expect(mail!.text).not.toContain('Switch to yearly');
  });

  it('writes in the person’s language', async () => {
    const h = await harness();
    const p = await h.person({ locale: 'ar' });
    await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    await h.run();
    expect(h.mailsTo(p.email)[0]!.subject).toBe('تشرين الثاني في متابعة');
  });

  it('carries the Switch to yearly line after a monthly payer’s 2nd payment (AC4)', async () => {
    const h = await harness();
    const p = await h.person({ paidInvoices: 2 });
    await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    await h.run();
    const text = h.mailsTo(p.email)[0]!.text;
    expect(text).toContain('Switch to yearly and save ₪58 a year:');
    expect(text).toContain(`${PORTAL}/?billing=true&step=switch`);
  });

  it('goes without the yearly line, not without the mail, when Stripe is missing', async () => {
    const h = await harness();
    const p = await h.person({ paidInvoices: 2 });
    await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    await h.run({ stripe: null });
    expect(h.mailsTo(p.email)[0]!.text).not.toContain('yearly');
  });

  it('mails a trialist too', async () => {
    const h = await harness();
    const p = await h.person({ plan: 'trial' });
    await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    const { summary } = await h.run();
    expect(summary.sent).toBe(1);
  });

  it('sends nothing for a month with no entries, however much is owed (AC5)', async () => {
    const h = await harness();
    const p = await h.person();
    const client = await p.customer();
    await p.income({ kind: 'owed', amount: '300.00', occurredOn: '2026-09-02', customerId: client, title: 'Work' });
    const { rows } = await h.run();
    expect(rows.find((r) => r.userId === p.userId)).toMatchObject({ action: 'skip', skip: 'nothing-to-show' });
    expect(h.mailsTo(p.email)).toHaveLength(0);
  });

  it('skips with a reason: turned off, nobody paying', async () => {
    const h = await harness();
    const off = await h.person();
    await h.store.users.setMonthlySummaryMail(off.userId, 'OFF', NOW);
    const lapsed = await h.person({ plan: 'none' });
    for (const p of [off, lapsed]) await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    const { rows } = await h.run();
    expect(rows.find((r) => r.userId === off.userId)?.skip).toBe('opted-out');
    expect(rows.find((r) => r.userId === lapsed.userId)).toBeUndefined();
    expect(h.outbox.list().filter((m) => m.template === 'monthly-summary')).toHaveLength(0);
  });

  it('mails an operator-made account whose address was never confirmed by a mailed link (Basel, 2026-11-22, TD-315)', async () => {
    const h = await harness();
    const p = await h.person({ verified: false });
    await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    const { rows } = await h.run();
    expect(rows.find((r) => r.userId === p.userId)).toMatchObject({ action: 'send', skip: null, outcome: 'sent' });
    expect(h.mailsTo(p.email)).toHaveLength(1);
  });

  it('leaves Malafat-covered profiles out by default, and in when the person chose ON_ALL (AC3)', async () => {
    const h = await harness();
    const p = await h.person({ plan: 'none' });
    await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    await h.store.integrations.connect({ organizationId: p.personal, provider: 'MALAFAT', externalTenantId: `t${seq}`, displayName: 'Office', connectedByApiKeyId: 'key', at: NOW });
    const first = await h.run({ dryRun: true });
    expect(first.rows.find((r) => r.userId === p.userId)?.skip).toBe('nothing-covered');
    await h.store.users.setMonthlySummaryMail(p.userId, 'ON_ALL', NOW);
    const second = await h.run({ dryRun: true });
    expect(second.rows.find((r) => r.userId === p.userId)).toMatchObject({ action: 'send', profiles: 1 });
  });

  it('waits for a profile west of UTC whose month isn’t over yet (D3)', async () => {
    const h = await harness();
    const p = await h.person({ timezone: 'America/Los_Angeles' });
    await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    // 07:00 in Jerusalem on the 1st is still 21:00 on 30 November in Los Angeles.
    const { rows } = await h.run({ now: new Date('2026-12-01T05:00:00Z') });
    expect(rows.find((r) => r.userId === p.userId)?.skip).toBe('month-not-over');
  });

  it('a dry run sends nothing; a second real run sends no duplicate', async () => {
    const h = await harness();
    const p = await h.person();
    await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    const dry = await h.run({ dryRun: true });
    expect(dry.summary).toMatchObject({ dryRun: true, due: 1, sent: 0 });
    expect(h.mailsTo(p.email)).toHaveLength(0);
    await h.run();
    const again = await h.run();
    expect(again.summary).toMatchObject({ sent: 0, duplicate: 1 });
    expect(h.mailsTo(p.email)).toHaveLength(1);
  });

  it('stops at its send budget and continues on the next run (D12)', async () => {
    const h = await harness();
    const people = [await h.person(), await h.person(), await h.person()];
    for (const p of people) await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    const first = await h.run({ sendBudget: 2 });
    expect(first.summary).toMatchObject({ sent: 2, incomplete: true });
    const second = await h.run({ sendBudget: 2 });
    expect(second.summary).toMatchObject({ sent: 1, duplicate: 2, incomplete: false });
  });

  it('stops at the first mail the daily cap refuses, so other mail still goes (D12)', async () => {
    const h = await harness({ dailyCap: 1 });
    const people = [await h.person(), await h.person(), await h.person()];
    for (const p of people) await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    const { summary, rows } = await h.run();
    expect(summary).toMatchObject({ sent: 1, notSent: 1, incomplete: true });
    expect(rows).toHaveLength(2);
  });

  it('does not mail a person whose profile can’t be read; the next run tries again (R9)', async () => {
    const h = await harness();
    const p = await h.person();
    await p.income({ kind: 'received', amount: '400.00', occurredOn: '2026-11-05' });
    const list = h.store.receivables.list.bind(h.store.receivables);
    h.store.receivables.list = async () => {
      throw new Error('read failed');
    };
    const { rows } = await h.run();
    expect(rows.find((r) => r.userId === p.userId)?.outcome).toBe('failed');
    h.store.receivables.list = list;
    expect((await h.run()).summary.sent).toBe(1);
  });
});
