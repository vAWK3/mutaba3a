import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { DEV_OUTBOX_PATH } from '../routes/dev-outbox.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/** MUT-359 (D11): the memory mailer's outbox, for tests and QA specs; admin token only; never published. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };

function harness(withOutbox: boolean) {
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const transport = new MemoryMailTransport();
  const mailer = createMailer({ transport, store, logger, now: () => new Date(), fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 10 } });
  const app = createApp({ store, logger, rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN['x-admin-token'], keyEnvironment: 'test', version: '0.1.0-test', mailer, devOutbox: withOutbox ? transport : null });
  return { app, mailer };
}

describe(`GET ${DEV_OUTBOX_PATH}`, () => {
  it('lists what the memory mailer sent, filtered by recipient, behind the admin token', async () => {
    const h = harness(true);
    for (const to of ['a@studio.example', 'b@studio.example']) {
      await h.mailer.send({ to, template: 'account-ready', locale: 'ar', vars: { signInLink: 'https://portal.example.test/' }, idempotencyKey: to });
    }
    expect((await h.app.request(DEV_OUTBOX_PATH)).status).toBe(401);
    const all = (await (await h.app.request(DEV_OUTBOX_PATH, { headers: ADMIN })).json()) as Loose;
    expect(all.mails.map((m: Loose) => m.to)).toEqual(['a@studio.example', 'b@studio.example']);
    const one = (await (await h.app.request(`${DEV_OUTBOX_PATH}?to=B@Studio.Example`, { headers: ADMIN })).json()) as Loose;
    expect(one.mails).toHaveLength(1);
    expect(one.mails[0]).toMatchObject({ to: 'b@studio.example', template: 'account-ready', locale: 'ar' });
    expect(one.mails[0].html).toContain('dir="rtl"');
  });

  it('does not exist without a memory outbox, and is never in the published OpenAPI', async () => {
    const h = harness(false);
    expect((await h.app.request(DEV_OUTBOX_PATH, { headers: ADMIN })).status).toBe(404);
    const doc = (await (await harness(true).app.request('/openapi.json')).json()) as Loose;
    expect(Object.keys(doc.paths)).not.toContain(DEV_OUTBOX_PATH);
  });
});
