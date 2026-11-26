import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { FakeTaxAuthority } from '../jurisdictions/il/tax-authority/__tests__/fake-client.js';
import { reconnectStageOf } from '../jurisdictions/il/tax-authority/reconnect-reminder.js';
import { TokenBox } from '../jurisdictions/il/tax-authority/token-box.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-571 AC3: the Tax Authority consent lasts 90 days. The daily job mails the profile's owner ten days before it ends
 * and once it has ended, each once per consent (the send log), with a link to connect again.
 */
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const JOB_TOKEN = 'test-job-token-with-at-least-32-characters-long';
const DAY = 86_400_000;
const JOB = '/jobs/v1/issuing/tax-authority-reminders';
const ADMIN = '/admin/v1/issuing/tax-authority-reminders';
const box = new TokenBox('route-test-secret-with-at-least-32-characters');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

function harness(opts: { taxAuthority?: boolean } = {}) {
  let now = new Date('2026-11-22T07:00:00Z');
  const store = new MemoryLedgerStore();
  const outbox = new MemoryMailTransport(() => now);
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport: outbox, store, logger, now: () => now, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => now,
    mailer,
    jobToken: JOB_TOKEN,
    ...(opts.taxAuthority === false ? {} : { taxAuthority: { client: new FakeTaxAuthority(), box, stateSecret: 'state-secret-for-tests', accountingSoftwareNumber: 987654321 } }),
  });
  /** A profile connected until `endsIn` days from now (a fractional day lands mid-day). */
  async function connected(endsIn: number, options: { locale?: 'en' | 'ar'; environment?: string; email?: string } = {}) {
    const email = options.email ?? 'owner@studio.example';
    const { user, personalOrganization } = await store.users.create({
      email,
      displayName: 'Rana Saleh',
      passwordHash: 'x',
      locale: options.locale ?? 'en',
      personal: { name: 'Saleh Studio', slug: `studio-${email}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: now,
    });
    await store.issuing.putTaxConnection({
      organizationId: personalOrganization.id,
      environment: options.environment ?? 'sandbox',
      accessTokenSealed: box.seal('access'),
      accessExpiresAt: new Date(now.getTime() + 600_000),
      refreshTokenSealed: box.seal('refresh'),
      refreshExpiresAt: new Date(now.getTime() + endsIn * DAY),
      connectedByUserId: user.id,
      connectedAt: new Date(now.getTime() - (90 - endsIn) * DAY),
    });
    return { user, profileId: personalOrganization.id };
  }
  const post = (path: string, headers: Record<string, string>, body?: unknown) =>
    app.request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const job = () => post(JOB, { 'x-job-token': JOB_TOKEN });
  const advance = (days: number) => (now = new Date(now.getTime() + days * DAY));
  return { store, outbox, connected, post, job, advance };
}

describe('the reminder windows', () => {
  const end = new Date('2026-12-02T07:00:00Z');
  const at = (iso: string) => new Date(iso);
  it('soon from ten days before (days rounded up), ended for seven days after, nothing outside', () => {
    expect(reconnectStageOf(end, at('2026-11-22T06:59:59Z'))).toBeNull();
    expect(reconnectStageOf(end, at('2026-11-22T07:00:00Z'))).toEqual({ stage: 'soon', daysLeft: 10 });
    expect(reconnectStageOf(end, at('2026-12-01T20:00:00Z'))).toEqual({ stage: 'soon', daysLeft: 1 });
    expect(reconnectStageOf(end, end)).toEqual({ stage: 'ended' });
    expect(reconnectStageOf(end, at('2026-12-09T06:59:59Z'))).toEqual({ stage: 'ended' });
    expect(reconnectStageOf(end, at('2026-12-09T07:00:00Z'))).toBeNull();
  });
});

describe('POST /jobs/v1/issuing/tax-authority-reminders (Cloud Scheduler)', () => {
  it('AC3: ten days before the end the owner is mailed once, with a link to the setup; a retry and the next days send nothing new', async () => {
    const h = harness();
    const { profileId } = await h.connected(9.5);
    const res = await h.job();
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toEqual({ dryRun: false, checked: 1, due: 1, sent: 1, duplicate: 0, notSent: 0, skipped: 0 });
    expect(JSON.stringify(body)).not.toContain('owner@studio.example');
    const [mail] = h.outbox.list({ to: 'owner@studio.example' });
    expect(mail!.template).toBe('tax-authority-reconnect');
    expect(mail!.subject).toBe('Your MTB3A connection to the Tax Authority ends within 10 days');
    expect(mail!.text).toContain(`http://localhost/p/${profileId}/you/invoicing`);
    expect(mail!.text).toContain('“Saleh Studio”');
    expect(await read(await h.job())).toMatchObject({ sent: 0, duplicate: 1 });
    h.advance(3);
    expect(await read(await h.job())).toMatchObject({ sent: 0, duplicate: 1 });
    expect(h.outbox.list({ to: 'owner@studio.example' })).toHaveLength(1);
  });

  it('AC3: on the end the owner is mailed once more, that it has ended; a week later nothing', async () => {
    const h = harness();
    await h.connected(9.5, { locale: 'ar' });
    await h.job();
    h.advance(10);
    expect(await read(await h.job())).toMatchObject({ sent: 1 });
    const mails = h.outbox.list({ to: 'owner@studio.example' });
    expect(mails).toHaveLength(2);
    expect(mails[1]!.subject).toBe('انتهى ربط متابعة بسلطة الضرائب');
    expect(await read(await h.job())).toMatchObject({ sent: 0, duplicate: 1 });
    h.advance(7);
    expect(await read(await h.job())).toMatchObject({ checked: 0 });
  });

  it('a reconnect starts a new consent: its own reminder, ten days before its own end', async () => {
    const h = harness();
    const { profileId, user } = await h.connected(5);
    await h.job();
    const current = (await h.store.issuing.getTaxConnection(profileId))!;
    await h.store.issuing.putTaxConnection({ ...current, refreshExpiresAt: new Date(current.refreshExpiresAt!.getTime() + 85 * DAY), connectedByUserId: user.id });
    expect(await read(await h.job())).toMatchObject({ checked: 0 });
    h.advance(81);
    expect(await read(await h.job())).toMatchObject({ sent: 1 });
    expect(h.outbox.list({ to: 'owner@studio.example' })).toHaveLength(2);
  });

  it('nobody else: weeks left, another environment, a disconnected profile', async () => {
    const h = harness();
    await h.connected(30);
    await h.connected(3, { environment: 'production', email: 'prod@studio.example' });
    const { profileId } = await h.connected(3, { email: 'gone@studio.example' });
    await h.store.issuing.deleteTaxConnection(profileId);
    expect(await read(await h.job())).toMatchObject({ checked: 1, sent: 0, skipped: 1 });
    expect(h.outbox.list({})).toHaveLength(0);
  });

  it('needs the job token; a server without the Tax Authority answers an empty run', async () => {
    expect((await harness().post(JOB, {})).status).toBe(401);
    const off = harness({ taxAuthority: false });
    await off.connected(3);
    expect(await read(await off.job())).toMatchObject({ checked: 0, sent: 0 });
  });
});

describe('POST /admin/v1/issuing/tax-authority-reminders (the operator)', () => {
  it('a dry run lists who would be mailed and mails nothing', async () => {
    const h = harness();
    const { profileId } = await h.connected(4);
    const res = await h.post(ADMIN, { 'x-admin-token': ADMIN_TOKEN }, { dryRun: true });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.summary).toMatchObject({ dryRun: true, due: 1, sent: 0 });
    expect(body.rows).toEqual([{ organizationId: profileId, stage: 'soon', action: 'send', skip: null, outcome: null }]);
    expect(h.outbox.list({})).toHaveLength(0);
  });
});
