import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../app.js';
import { FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-419: the two doors to the trial-mail run, like MUT-360's reconcile. The Scheduler's job route answers counts
 * only (no address reaches its logs); the operator's route answers the rows too, and can dry-run. Both need Stripe
 * (the mails' Subscribe links lead there) and their own token.
 */
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const JOB_TOKEN = 'test-job-token-with-at-least-32-characters-long';
const NOW = new Date('2026-11-21T10:00:00Z');
const DAY = 86_400_000;
const JOB = '/jobs/v1/billing/trial-mail';
const ADMIN = '/admin/v1/billing/trial-mail';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

function harness(overrides: Partial<AppDependencies> & { stripeOff?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  const outbox = new MemoryMailTransport(() => NOW);
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const gateway = new FakeStripeGateway(() => NOW);
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    billingGate: true,
    stripe: overrides.stripeOff ? null : { webhookGateway: gateway, reconcileGateway: gateway },
    jobToken: JOB_TOKEN,
    ...overrides,
  });
  async function trialPerson(daysAgo: number) {
    const { user } = await store.users.create({
      email: `trial${++seq}@studio.example`,
      displayName: 'Rana Saleh',
      passwordHash: 'x',
      locale: 'en',
      personal: { name: 'Personal', slug: `personal-${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: NOW,
    });
    await store.billing.setTrialStart(user.id, new Date(NOW.getTime() - daysAgo * DAY));
    return user;
  }
  const post = (path: string, headers: Record<string, string>, body?: unknown, host = 'http://localhost') =>
    app.request(`${host}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { app, store, outbox, trialPerson, post };
}

describe('POST /jobs/v1/billing/trial-mail (Cloud Scheduler)', () => {
  it('runs the day’s mail and answers counts only, never an address', async () => {
    const h = harness();
    const person = await h.trialPerson(20);
    const res = await h.post(JOB, { 'x-job-token': JOB_TOKEN });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toEqual({ dryRun: false, checked: 1, due: 1, sent: 1, duplicate: 0, notSent: 0, skipped: { paying: 0, covered: 0, otherProfiles: 0, suppressed: 0, gateOff: 0 }, incomplete: false });
    expect(JSON.stringify(body)).not.toContain(person.email);
    expect(h.outbox.list({ to: person.email }).map((m) => m.template)).toEqual(['trial-ended']);
  });

  it('A2: a second call the same day sends nothing new', async () => {
    const h = harness();
    await h.trialPerson(12);
    await h.post(JOB, { 'x-job-token': JOB_TOKEN });
    expect(await read(await h.post(JOB, { 'x-job-token': JOB_TOKEN }))).toMatchObject({ sent: 0, duplicate: 1 });
    expect(h.outbox.list()).toHaveLength(1);
  });

  it('needs the job token, not the admin token', async () => {
    const h = harness();
    expect((await h.post(JOB, {})).status).toBe(401);
    expect((await h.post(JOB, { 'x-admin-token': ADMIN_TOKEN })).status).toBe(401);
    expect((await harness({ jobToken: null }).post(JOB, { 'x-job-token': JOB_TOKEN })).status).toBe(503);
  });

  it('R6: answers 503 BILLING_NOT_CONFIGURED without Stripe, and mails nothing', async () => {
    const h = harness({ stripeOff: true });
    await h.trialPerson(20);
    const res = await h.post(JOB, { 'x-job-token': JOB_TOKEN });
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('BILLING_NOT_CONFIGURED');
    expect(h.outbox.list()).toHaveLength(0);
  });

  it('R5: with the lapse gate off, nobody is mailed', async () => {
    const h = harness({ billingGate: false });
    await h.trialPerson(20);
    expect(await read(await h.post(JOB, { 'x-job-token': JOB_TOKEN }))).toMatchObject({ due: 0, skipped: { gateOff: 1 } });
    expect(h.outbox.list()).toHaveLength(0);
  });

  it('links the portal origin, not the host the Scheduler called', async () => {
    const h = harness({ sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60, absoluteHours: 24, secureCookie: true, trustedProxyHops: 1, portalOrigin: 'https://app.example.test' } });
    const person = await h.trialPerson(12);
    await h.post(JOB, { 'x-job-token': JOB_TOKEN }, undefined, 'https://mutaba3a-api-xyz.a.run.example');
    expect(h.outbox.list({ to: person.email })[0]!.text).toContain('https://app.example.test/?billing=true&step=subscribe');
  });
});

describe('POST /admin/v1/billing/trial-mail (operator)', () => {
  it('a dry run lists who would get what, and mails nothing', async () => {
    const h = harness();
    const due = await h.trialPerson(28);
    const res = await h.post(ADMIN, { 'x-admin-token': ADMIN_TOKEN }, { dryRun: true });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.summary).toMatchObject({ dryRun: true, due: 1, sent: 0 });
    expect(body.rows).toEqual([{ userId: due.id, email: due.email, locale: 'en', stage: 'locking-soon', daysLeft: 2, action: 'send', skip: null, outcome: null }]);
    expect(h.outbox.list()).toHaveLength(0);
  });

  it('a real run sends, and needs the admin token', async () => {
    const h = harness();
    const due = await h.trialPerson(12);
    expect((await h.post(ADMIN, {}, { dryRun: false })).status).toBe(401);
    const body = await read(await h.post(ADMIN, { 'x-admin-token': ADMIN_TOKEN }, { dryRun: false }));
    expect(body.rows[0]).toMatchObject({ userId: due.id, stage: 'ending-soon', outcome: 'sent' });
    expect(h.outbox.list({ to: due.email })).toHaveLength(1);
  });

  it('R11: in production, refuses a real run whose links would point at a loopback origin; a dry run still answers', async () => {
    const h = harness({ trialMail: { refuseLoopbackLinks: true } });
    await h.trialPerson(12);
    const real = await h.post(ADMIN, { 'x-admin-token': ADMIN_TOKEN }, { dryRun: false }, 'http://127.0.0.1:8080');
    expect(real.status).toBe(409);
    expect((await read(real)).error.code).toBe('LINK_ORIGIN_LOOPBACK');
    expect((await h.post(ADMIN, { 'x-admin-token': ADMIN_TOKEN }, { dryRun: true }, 'http://127.0.0.1:8080')).status).toBe(200);
    expect((await h.post(ADMIN, { 'x-admin-token': ADMIN_TOKEN }, { dryRun: false }, 'https://api.example.test')).status).toBe(200);
    expect(h.outbox.list()).toHaveLength(1);
  });
});
