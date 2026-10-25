import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { webauthnConfigOf } from '../auth/webauthn.js';
import { createMailer } from '../email/mailer.js';
import type { MailTransport } from '../email/ports.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';

/**
 * MUT-414: adding a passkey mails the account's address once, in its language; a suppressed address gets nothing and
 * a broken provider changes nothing about the add. Through the real app, its default passkey events and the mailer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const NOW = new Date('2026-10-25T09:00:00Z');
const PORTAL = 'http://localhost';
const COOKIE = '__Host-mut_session';
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

function harness(transport: MailTransport = new MemoryMailTransport(() => NOW)) {
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: 'help@example.test', limits: { daily: 500, securityReserve: 50, perRecipient: 10 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
    webauthn: webauthnConfigOf({ rpId: 'localhost', origins: PORTAL }),
  });
  return { app, store };
}

let seq = 0;
async function signedIn(h: ReturnType<typeof harness>, locale: 'ar' | 'en') {
  const org = (await (await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN))).json()) as Loose;
  const email = `passkey${++seq}@studio.example`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', organizationId: org.id, locale });
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, { origin: PORTAL }));
  expect(res.status).toBe(201);
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return { email, headers: { cookie: `${COOKIE}=${token}`, origin: PORTAL } };
}

/** The passkey mails only: provisioning's setup redeem sends its own password notice. */
const passkeyMails = (transport: MemoryMailTransport, to: string) => transport.list({ to }).filter((m) => m.template === 'passkey-added');

async function addPasskey(h: ReturnType<typeof harness>, headers: Record<string, string>) {
  const { challengeId, publicKey } = (await (await h.app.request('/v1/passkeys/creation-options', json({}, headers))).json()) as Loose;
  return h.app.request('/v1/passkeys', json({ challengeId, response: new SoftAuthenticator().create(publicKey, PORTAL) }, headers));
}

describe('the "a passkey was added" mail (MUT-414)', () => {
  it('adding a passkey sends exactly one mail to the account address, in its language, naming the passkey', async () => {
    const transport = new MemoryMailTransport(() => NOW);
    const h = harness(transport);
    const p = await signedIn(h, 'ar');
    const res = await addPasskey(h, p.headers);
    expect(res.status).toBe(201);
    const added = (await res.json()) as Loose;

    const mails = passkeyMails(transport, p.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ template: 'passkey-added', locale: 'ar', subject: 'أُضيف مفتاح مرور إلى حسابك في متابعة' });
    expect(mails[0]!.text).toContain(added.name);
    // The portal this API serves: here the test's own origin.
    expect(mails[0]!.text).toContain('http://localhost/');
  });

  it('each passkey is its own mail, in English for an English account', async () => {
    const transport = new MemoryMailTransport(() => NOW);
    const h = harness(transport);
    const p = await signedIn(h, 'en');
    expect((await addPasskey(h, p.headers)).status).toBe(201);
    expect((await addPasskey(h, p.headers)).status).toBe(201);
    expect(passkeyMails(transport, p.email).map((m) => m.subject)).toEqual(['A passkey was added to your MTB3A account', 'A passkey was added to your MTB3A account']);
  });

  it('a suppressed address gets no mail, and the passkey is still added', async () => {
    const transport = new MemoryMailTransport(() => NOW);
    const h = harness(transport);
    const p = await signedIn(h, 'en');
    await h.store.email.suppress({ email: p.email, reason: 'HARD_BOUNCE', eventId: 'msg_1', at: NOW });
    expect((await addPasskey(h, p.headers)).status).toBe(201);
    expect(passkeyMails(transport, p.email)).toHaveLength(0);
    expect(((await (await h.app.request('/v1/passkeys', { headers: p.headers })).json()) as Loose).items).toHaveLength(1);
  });

  it('a failing provider never fails the add', async () => {
    const broken: MailTransport = { kind: 'resend', deliver: async () => { throw new Error('Resend is down'); } };
    const h = harness(broken);
    const p = await signedIn(h, 'en');
    expect((await addPasskey(h, p.headers)).status).toBe(201);
  });
});
