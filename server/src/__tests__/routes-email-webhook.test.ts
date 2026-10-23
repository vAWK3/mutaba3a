import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { EMAIL_WEBHOOK_PATH } from '../routes/email-webhook.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';

/**
 * MUT-359 A3 (D12, D19, D20): POST /v1/email/resend/webhook. A signed hard bounce or complaint suppresses the
 * address; an unsigned or mis-signed delivery is 401 and writes nothing. The Resend account is shared with
 * Malafat, so only events sent from our own domain count.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const SECRET = `whsec_${Buffer.from('mut359 webhook signing secret!!').toString('base64')}`;
const OTHER_SECRET = `whsec_${Buffer.from('somebody else entirely, 32 bytes').toString('base64')}`;
const FROM_DOMAIN = 'mail.example.test';
const NOW = new Date('2026-10-23T09:00:00Z');

function harness(webhook: { secret: string; fromDomain: string } | null = { secret: SECRET, fromDomain: FROM_DOMAIN }, ipPerMinute = 60) {
  const store = new MemoryLedgerStore();
  const transport = new MemoryMailTransport(() => NOW);
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport, store, logger, now: () => NOW, fromAddress: `no-reply@${FROM_DOMAIN}`, replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 10 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: 'test-admin-token-with-at-least-32-characters',
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    emailWebhook: webhook,
    emailWebhookIpLimiter: new SlidingWindowRateLimiter(ipPerMinute),
  });
  return { app, store, mailer, transport };
}

let n = 0;
function delivery(event: object, opts: { secret?: string; id?: string; at?: Date; signature?: string | null } = {}) {
  const body = JSON.stringify(event);
  const id = opts.id ?? `msg_${++n}`;
  const ts = String(Math.floor((opts.at ?? NOW).getTime() / 1000));
  const key = Buffer.from((opts.secret ?? SECRET).slice('whsec_'.length), 'base64');
  const signature = `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts };
  if (opts.signature !== null) headers['svix-signature'] = opts.signature ?? signature;
  return { method: 'POST', headers, body };
}
const bounced = (to: string[], type = 'Permanent', from = `MTB3A <no-reply@${FROM_DOMAIN}>`) => ({
  type: 'email.bounced',
  created_at: NOW.toISOString(),
  data: { email_id: 'em_1', from, to, subject: 'x', bounce: { type, subType: 'General', message: 'mailbox does not exist' } },
});
const complained = (to: string[], from = `no-reply@${FROM_DOMAIN}`) => ({ type: 'email.complained', created_at: NOW.toISOString(), data: { email_id: 'em_2', from, to, subject: 'x' } });
const post = (h: ReturnType<typeof harness>, init: RequestInit) => h.app.request(EMAIL_WEBHOOK_PATH, init);

describe(`POST ${EMAIL_WEBHOOK_PATH}`, () => {
  it('suppresses a signed hard bounce, normalized, and the mailer then refuses that address', async () => {
    const h = harness();
    const res = await post(h, delivery(bounced(['Gone@Studio.Example'])));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: 'suppressed' });
    expect(await h.store.email.isSuppressed('gone@studio.example')).toBe(true);
    const send = await h.mailer.send({ to: 'gone@studio.example', template: 'account-ready', locale: 'en', vars: { signInLink: 'https://portal.example.test/' }, idempotencyKey: 'k1' });
    expect(send).toEqual({ status: 'suppressed' });
    expect(h.transport.list()).toHaveLength(0);
  });

  it('suppresses a complaint', async () => {
    const h = harness();
    const res = await post(h, delivery(complained(['angry@studio.example'])));
    expect(await res.json()).toEqual({ received: true, result: 'suppressed' });
    expect(await h.store.email.isSuppressed('angry@studio.example')).toBe(true);
  });

  it('ignores a transient bounce, other event types, and events sent from another domain (Malafat’s)', async () => {
    const h = harness();
    for (const event of [
      bounced(['soft@studio.example'], 'Transient'),
      { type: 'email.delivered', created_at: NOW.toISOString(), data: { from: `no-reply@${FROM_DOMAIN}`, to: ['soft@studio.example'] } },
      bounced(['soft@studio.example'], 'Permanent', 'Malafat <no-reply@malafat.example>'),
      complained(['soft@studio.example'], `no-reply@sub.${FROM_DOMAIN}`),
    ]) {
      const res = await post(h, delivery(event));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, result: 'ignored' });
    }
    expect(await h.store.email.isSuppressed('soft@studio.example')).toBe(false);
  });

  it('refuses an unsigned or mis-signed delivery with 401 and writes nothing', async () => {
    const h = harness();
    for (const init of [delivery(bounced(['x@studio.example']), { signature: null }), delivery(bounced(['x@studio.example']), { secret: OTHER_SECRET })]) {
      const res = await post(h, init);
      expect(res.status).toBe(401);
      expect(((await res.json()) as Loose).error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    }
    const replayed = delivery(bounced(['x@studio.example']), { at: new Date(NOW.getTime() - 10 * 60_000) });
    expect((await post(h, replayed)).status).toBe(401);
    expect(await h.store.email.isSuppressed('x@studio.example')).toBe(false);
  });

  it('answers a redelivery with the same result and keeps one suppression', async () => {
    const h = harness();
    const init = delivery(bounced(['twice@studio.example']), { id: 'msg_same' });
    expect((await post(h, init)).status).toBe(200);
    expect((await post(h, init)).status).toBe(200);
    expect(await h.store.email.suppress({ email: 'twice@studio.example', reason: 'COMPLAINT', eventId: 'later', at: NOW })).toEqual({ created: false });
  });

  it('acknowledges a signed body that is not JSON, or not an event it acts on, without writing', async () => {
    const h = harness();
    const id = 'msg_not_json';
    const ts = String(Math.floor(NOW.getTime() / 1000));
    const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64');
    const signature = `v1,${createHmac('sha256', key).update(`${id}.${ts}.not json`).digest('base64')}`;
    const notJson = await post(h, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature }, body: 'not json' });
    expect(notJson.status).toBe(200);
    expect(await notJson.json()).toEqual({ received: true, result: 'ignored' });
    const odd = delivery({ type: 'email.bounced', data: { from: `no-reply@${FROM_DOMAIN}`, to: 'not-a-list', bounce: { type: 'Permanent' } } });
    expect(await (await post(h, odd)).json()).toEqual({ received: true, result: 'ignored' });
  });

  it('refuses a body changed after signing', async () => {
    const h = harness();
    expect((await post(h, { ...delivery(bounced(['x@studio.example'])), body: JSON.stringify(bounced(['y@studio.example'])) })).status).toBe(401);
    expect(await h.store.email.isSuppressed('y@studio.example')).toBe(false);
  });

  it('answers 503 when the server has no webhook secret', async () => {
    const h = harness(null);
    const res = await post(h, delivery(bounced(['x@studio.example'])));
    expect(res.status).toBe(503);
    expect(((await res.json()) as Loose).error.code).toBe('MAILER_NOT_CONFIGURED');
  });

  it('rate-limits failed signatures from one address, never verified deliveries', async () => {
    const h = harness({ secret: SECRET, fromDomain: FROM_DOMAIN }, 2);
    const bad = () => post(h, delivery(bounced(['x@studio.example']), { secret: OTHER_SECRET }));
    expect((await bad()).status).toBe(401);
    expect((await bad()).status).toBe(401);
    expect((await bad()).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await post(h, delivery(bounced([`ok${i}@studio.example`])))).status).toBe(200);
  });

  it('is in the published OpenAPI as a public operation', async () => {
    const h = harness();
    const doc = (await (await h.app.request('/openapi.json')).json()) as Loose;
    expect(doc.paths[EMAIL_WEBHOOK_PATH].post.security).toEqual([]);
  });
});
