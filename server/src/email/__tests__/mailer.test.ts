import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { createMailer, MAIL_CAP_REACHED, MAIL_LOG_UNAVAILABLE, MAIL_PROVIDER_FAILED, MAIL_PROVIDER_RATE_LIMITED, type MailerOptions } from '../mailer.js';
import { MailTransportError, TEMPLATE_IDS, UNOWNED_DOMAINS, type MailTransport, type OutgoingMail } from '../ports.js';
import { MemoryMailTransport } from '../transports/memory.js';
import { NOOP_TRANSPORT } from '../transports/noop.js';

/**
 * MUT-359 A1 and A4 through the memory transport: every template in both languages goes out and reads back; a
 * suppressed or unowned address gets nothing; the global cap refuses the 501st mail in 24 h and logs `error`; one
 * recipient can't take the cap; security mail keeps its reserve; a key never sends twice.
 */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line) as Record<string, unknown>);
      done();
    },
  });
  return { logger: pino({ level: 'debug' }, stream), lines };
}

function harness(overrides: Partial<MailerOptions> = {}) {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-23T09:00:00Z') };
  const transport = new MemoryMailTransport(() => clock.now);
  const { logger, lines } = capture();
  const mailer = createMailer({
    transport,
    store,
    logger,
    now: () => clock.now,
    fromAddress: 'no-reply@mail.example.test',
    replyTo: 'help@example.test',
    limits: { daily: 500, securityReserve: 50, perRecipient: 10 },
    ...overrides,
  });
  return { store, clock, transport, mailer, lines };
}

const LINK = 'https://portal.example.test/setup#tok';
const vars = {
  'finish-signup': { link: LINK, validHours: 24 },
  'account-exists': { signInLink: 'https://portal.example.test/', recoverLink: 'https://portal.example.test/recover' },
  'reset-password': { link: LINK, validHours: 1 },
  'finish-setup': { link: LINK, validHours: 72 },
  'password-changed': { first: false, signInLink: 'https://portal.example.test/' },
  'account-under-review': {},
  'account-ready': { signInLink: 'https://portal.example.test/' },
  'account-declined': { supportAddress: 'help@example.test' },
  'review-digest': { pending: 2, command: 'npm run signups:review', reviewLink: null },
  'trial-ending-soon': { daysLeft: 3, subscribeLink: 'https://portal.example.test/?billing=true&step=subscribe' },
  'trial-ended': { subscribeLink: 'https://portal.example.test/?billing=true&step=subscribe', exportLink: 'https://portal.example.test/?yourData=true' },
  'trial-locking-soon': { daysLeft: 1, subscribeLink: 'https://portal.example.test/?billing=true&step=subscribe', exportLink: 'https://portal.example.test/?yourData=true' },
  'account-closing': { deleteOn: { year: 2026, month: 11, day: 23 }, signInLink: 'https://portal.example.test/sign-in' },
  'passkey-added': { passkeyName: 'iCloud Keychain', signInLink: 'https://portal.example.test/' },
} as const;
let seq = 0;
const signup = (to: string) => ({ to, template: 'finish-signup' as const, locale: 'en' as const, vars: vars['finish-signup'], idempotencyKey: `signup-${++seq}` });

describe('mailer (memory transport)', () => {
  it('sends every template in English and Arabic and reads each back from the outbox', async () => {
    const h = harness();
    for (const template of TEMPLATE_IDS) {
      for (const locale of ['en', 'ar'] as const) {
        const result = await h.mailer.send({ to: `Rana+${template}@Studio.Example`, template, locale, vars: vars[template] as never, idempotencyKey: `${template}-${locale}` });
        expect(result.status).toBe('sent');
      }
    }
    const outbox = h.transport.list();
    expect(outbox).toHaveLength(TEMPLATE_IDS.length * 2);
    for (const mail of outbox) {
      expect(mail.to).toBe(mail.to.toLowerCase());
      expect(mail.from).toBe('MTB3A <no-reply@mail.example.test>');
      expect(mail.replyTo).toBe('help@example.test');
      expect(mail.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
      expect(mail.html).toContain(mail.locale === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
    }
    expect(h.transport.list({ to: 'rana+password-changed@studio.example' })).toHaveLength(2);
  });

  it('never sends the same key twice', async () => {
    const h = harness();
    const input = signup('a@studio.example');
    expect((await h.mailer.send(input)).status).toBe('sent');
    expect(await h.mailer.send(input)).toEqual({ status: 'duplicate' });
    expect(h.transport.list()).toHaveLength(1);
  });

  it('sends nothing to a suppressed address, and spends no cap on it', async () => {
    const h = harness({ limits: { daily: 1, securityReserve: 0, perRecipient: 10 } });
    await h.store.email.suppress({ email: 'gone@studio.example', reason: 'HARD_BOUNCE', eventId: 'msg_1', at: h.clock.now });
    expect(await h.mailer.send(signup('Gone@Studio.Example'))).toEqual({ status: 'suppressed' });
    expect((await h.mailer.send(signup('here@studio.example'))).status).toBe('sent');
  });

  it('refuses an unowned domain and anything that is not one plain address', async () => {
    const h = harness();
    expect(await h.mailer.send(signup(`review@${UNOWNED_DOMAINS[0]}`))).toEqual({ status: 'refused', reason: 'UNOWNED_DOMAIN' });
    expect(await h.mailer.send(signup(`x@eu.${UNOWNED_DOMAINS[0]}`))).toEqual({ status: 'refused', reason: 'UNOWNED_DOMAIN' });
    for (const to of ['a@b.example, c@d.example', 'a@b.example\r\nBcc: c@d.example', 'Rana <a@b.example>', 'not-an-address', '']) {
      expect(await h.mailer.send(signup(to))).toEqual({ status: 'refused', reason: 'INVALID_ADDRESS' });
    }
    expect(h.transport.list()).toHaveLength(0);
  });

  it('refuses the 501st mail in 24 hours, logs error, and counts again a day later', async () => {
    const h = harness({ limits: { daily: 500, securityReserve: 0, perRecipient: 10_000 } });
    for (let i = 0; i < 500; i++) expect((await h.mailer.send(signup(`p${i}@studio.example`))).status).toBe('sent');
    expect(await h.mailer.send(signup('p500@studio.example'))).toEqual({ status: 'capped', scope: 'global' });
    const capLog = h.lines.find((l) => l.msg === MAIL_CAP_REACHED);
    expect(capLog?.level).toBe(50);
    expect(capLog).toMatchObject({ scope: 'global', cap: 500, daily: 500, template: 'finish-signup' });
    expect(JSON.stringify(h.lines)).not.toContain('p500@studio.example');

    h.clock.now = new Date(h.clock.now.getTime() + 24 * 3_600_000 + 1);
    expect((await h.mailer.send(signup('p501@studio.example'))).status).toBe('sent');
  });

  it('keeps the reserve for recovery mail: a reset still goes out when signups have used their share', async () => {
    const h = harness({ limits: { daily: 10, securityReserve: 2, perRecipient: 100 } });
    for (let i = 0; i < 8; i++) expect((await h.mailer.send(signup(`s${i}@studio.example`))).status).toBe('sent');
    expect(await h.mailer.send(signup('s8@studio.example'))).toEqual({ status: 'capped', scope: 'global' });
    const reset = (n: number) => ({ to: `r${n}@studio.example`, template: 'reset-password' as const, locale: 'ar' as const, vars: vars['reset-password'], idempotencyKey: `reset-${n}` });
    expect((await h.mailer.send(reset(1))).status).toBe('sent');
    expect((await h.mailer.send(reset(2))).status).toBe('sent');
    expect(await h.mailer.send(reset(3))).toEqual({ status: 'capped', scope: 'global' });
  });

  it('caps one recipient at the per-recipient limit and logs a warning, not an error', async () => {
    const h = harness({ limits: { daily: 500, securityReserve: 0, perRecipient: 3 } });
    for (let i = 0; i < 3; i++) expect((await h.mailer.send(signup('target@studio.example'))).status).toBe('sent');
    expect(await h.mailer.send(signup('TARGET@studio.example'))).toEqual({ status: 'capped', scope: 'recipient' });
    expect((await h.mailer.send(signup('other@studio.example'))).status).toBe('sent');
    expect(h.lines.find((l) => l.msg === MAIL_CAP_REACHED && l.scope === 'recipient')?.level).toBe(40);
  });

  it('reports a provider failure, logs it, and lets the same key send again', async () => {
    let fail: MailTransportError | null = new MailTransportError('unavailable', 'Resend answered 503', 503);
    const inner = new MemoryMailTransport();
    const flaky: MailTransport = { kind: 'resend', deliver: async (m: OutgoingMail) => { if (fail) throw fail; return inner.deliver(m); } };
    const h = harness({ transport: flaky });
    const input = signup('a@studio.example');
    expect(await h.mailer.send(input)).toEqual({ status: 'failed', reason: 'unavailable' });
    expect(h.lines.find((l) => l.msg === MAIL_PROVIDER_FAILED)?.level).toBe(50);
    fail = null;
    expect((await h.mailer.send(input)).status).toBe('sent');
  });

  it('logs a Resend rate limit apart from an outage', async () => {
    const limited: MailTransport = { kind: 'resend', deliver: async () => { throw new MailTransportError('rate_limited', 'Resend answered 429', 429); } };
    const h = harness({ transport: limited });
    expect(await h.mailer.send(signup('a@studio.example'))).toEqual({ status: 'failed', reason: 'rate_limited' });
    expect(h.lines.find((l) => l.msg === MAIL_PROVIDER_RATE_LIMITED)?.level).toBe(50);
  });

  it('treats an unexpected transport error as an unavailable provider', async () => {
    const broken: MailTransport = { kind: 'resend', deliver: async () => { throw new Error('boom'); } };
    const h = harness({ transport: broken });
    expect(await h.mailer.send(signup('a@studio.example'))).toEqual({ status: 'failed', reason: 'unavailable' });
  });

  it('with no mailer configured, sends nothing and warns once', async () => {
    const h = harness({ transport: NOOP_TRANSPORT });
    expect(h.mailer.kind).toBe('noop');
    expect(await h.mailer.send(signup('a@studio.example'))).toEqual({ status: 'disabled' });
    expect(await h.mailer.send(signup('b@studio.example'))).toEqual({ status: 'disabled' });
    expect(h.lines.filter((l) => l.level === 40)).toHaveLength(1);
  });

  it('throws on a caller bug (a link that is not http)', async () => {
    const h = harness();
    await expect(h.mailer.send({ ...signup('a@studio.example'), vars: { link: 'javascript:alert(1)', validHours: 24 } })).rejects.toThrow(/link/);
  });
  it('with the production default reserve, stops other mail at the cap less the reserve and logs that limit', async () => {
    const h = harness({ limits: { daily: 500, securityReserve: 50, perRecipient: 10_000 } });
    for (let i = 0; i < 450; i++) expect((await h.mailer.send(signup(`d${i}@studio.example`))).status).toBe('sent');
    expect(await h.mailer.send(signup('d450@studio.example'))).toEqual({ status: 'capped', scope: 'global' });
    expect(h.lines.find((l) => l.msg === MAIL_CAP_REACHED)).toMatchObject({ cap: 450, daily: 500, reserve: 50, recovery: false });
  });

  it('gives the password notice no reserve, but keeps it outside the per-recipient cap', async () => {
    const h = harness({ limits: { daily: 10, securityReserve: 2, perRecipient: 2 } });
    const notice = (n: number) => ({ to: 'owner@studio.example', template: 'password-changed' as const, locale: 'en' as const, vars: vars['password-changed'], idempotencyKey: `notice-${n}` });
    // Others used up the address's own allowance (e.g. signup or recovery requests for it): the notice still goes.
    for (let i = 0; i < 2; i++) expect((await h.mailer.send(signup('owner@studio.example'))).status).toBe('sent');
    expect(await h.mailer.send(signup('owner@studio.example'))).toEqual({ status: 'capped', scope: 'recipient' });
    for (let i = 0; i < 6; i++) expect((await h.mailer.send(notice(i))).status).toBe('sent');
    // 8 sent: the notice stops at the cap less the reserve, which stays for recovery.
    expect(await h.mailer.send(notice(6))).toEqual({ status: 'capped', scope: 'global' });
    expect((await h.mailer.send({ to: 'r@studio.example', template: 'reset-password', locale: 'en', vars: vars['reset-password'], idempotencyKey: 'reset-x' })).status).toBe('sent');
  });

  it('serializes claims, so concurrent sends to one address never pass its cap', async () => {
    const h = harness({ limits: { daily: 500, securityReserve: 0, perRecipient: 2 } });
    // A store that reads the count, yields, then writes, as the Prisma store does across its awaits.
    const claimed: string[] = [];
    h.store.email.claimDelivery = async (input) => {
      const count = claimed.filter((r) => r === input.recipientDigest).length;
      await new Promise((r) => setTimeout(r, 5));
      if (input.limit.perRecipient !== null && count >= input.limit.perRecipient) return { status: 'capped', scope: 'recipient' };
      claimed.push(input.recipientDigest);
      return { status: 'claimed', id: `c${claimed.length}` };
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => h.mailer.send(signup('burst@studio.example'))));
    expect(results.filter((r) => r.status === 'sent')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'capped')).toHaveLength(4);
  });

  it('reports a delivered mail as sent even when the send log can’t record it', async () => {
    const h = harness();
    h.store.email.finishDelivery = async () => { throw new Error('connection pool timeout'); };
    expect((await h.mailer.send(signup('a@studio.example'))).status).toBe('sent');
    expect(h.lines.find((l) => l.msg === MAIL_PROVIDER_FAILED)).toBeUndefined();
    expect(h.lines.find((l) => l.msg === MAIL_LOG_UNAVAILABLE)?.level).toBe(50);
  });

  it('answers failed, never throws, when the send log is down, and sends nothing', async () => {
    const h = harness();
    h.store.email.isSuppressed = async () => { throw new Error('database is down'); };
    expect(await h.mailer.send(signup('a@studio.example'))).toEqual({ status: 'failed', reason: 'unavailable' });
    expect(h.transport.list()).toHaveLength(0);
    expect(h.lines.find((l) => l.msg === MAIL_LOG_UNAVAILABLE)?.level).toBe(50);
  });

  it('keeps counting a timed-out send, which Resend may still have accepted', async () => {
    let calls = 0;
    const slow: MailTransport = { kind: 'resend', deliver: async () => { calls++; throw new MailTransportError('timeout', 'Resend did not answer within 5000 ms'); } };
    const h = harness({ transport: slow, limits: { daily: 1, securityReserve: 0, perRecipient: 10 } });
    expect(await h.mailer.send(signup('a@studio.example'))).toEqual({ status: 'failed', reason: 'timeout' });
    expect(await h.mailer.send(signup('b@studio.example'))).toEqual({ status: 'capped', scope: 'global' });
    expect(calls).toBe(1);
  });
});
