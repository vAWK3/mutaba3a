import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { createMailer } from '../email/mailer.js';
import type { MailTransport } from '../email/ports.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { CURRENT_TERMS } from '../legal.js';
import { setupTokenOf, SETUP_TEST_PASSWORD } from './helpers/provision.js';
import { signInLinkOf } from '../routes/account-setup.js';

/**
 * MUT-359 A5 (D8): "your password was set / changed" goes out after a setup-link redeem and after
 * POST /v1/me/password, in the person's language, through a request (so the store guard lets it through), and a
 * mail problem never changes either answer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const NOW = new Date('2026-10-23T09:00:00Z');
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

function harness(transport: MailTransport = new MemoryMailTransport(() => NOW), extra: Partial<AppDependencies> = {}) {
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
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180, portalOrigin: 'https://portal.example.test' },
    ...extra,
  });
  return { app, store };
}

let seq = 0;
async function provision(h: ReturnType<typeof harness>, locale: 'ar' | 'en') {
  const email = `notice${++seq}@studio.example`;
  const res = await h.app.request('/admin/v1/users', json({ email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale }, ADMIN));
  expect(res.status).toBe(201);
  const created = (await res.json()) as Loose;
  return { email, id: created.user.id as string, token: setupTokenOf(created.setupLink.url) };
}
const redeem = (h: ReturnType<typeof harness>, token: string) =>
  h.app.request('/v1/account-setup', json({ token, password: SETUP_TEST_PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version }, { origin: 'https://portal.example.test' }));

describe('password notices (MUT-359)', () => {
  it('a first setup mails "your password is set" in the person’s language, with a sign-in link to the portal', async () => {
    const transport = new MemoryMailTransport(() => NOW);
    const h = harness(transport);
    const p = await provision(h, 'ar');
    expect((await redeem(h, p.token)).status).toBe(200);

    const mails = transport.list({ to: p.email });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ template: 'password-changed', locale: 'ar', subject: 'تم تعيين كلمة مرور حسابك في متابعة' });
    expect(mails[0]!.text).toContain('https://portal.example.test/');
  });

  it('a reset link and POST /v1/me/password each mail "your password was changed"', async () => {
    const transport = new MemoryMailTransport(() => NOW);
    const h = harness(transport);
    const p = await provision(h, 'en');
    await redeem(h, p.token);

    const link = (await (await h.app.request(`/admin/v1/users/${p.id}/setup-link`, json({}, ADMIN))).json()) as Loose;
    expect((await redeem(h, setupTokenOf(link.setupLink.url))).status).toBe(200);

    const { token } = (await (await h.app.request('/v1/device-sessions', json({ email: p.email, password: SETUP_TEST_PASSWORD }))).json()) as Loose;
    const res = await h.app.request('/v1/me/password', json({ currentPassword: SETUP_TEST_PASSWORD, newPassword: 'another long enough passphrase' }, { authorization: `Bearer ${token}` }));
    expect(res.status).toBe(204);

    const subjects = transport.list({ to: p.email }).map((m) => m.subject);
    expect(subjects).toEqual(['Your MTB3A password is set', 'Your MTB3A password was changed', 'Your MTB3A password was changed']);
  });

  it('a failing provider changes neither answer', async () => {
    const broken: MailTransport = { kind: 'resend', deliver: async () => { throw new Error('Resend is down'); } };
    const h = harness(broken);
    const p = await provision(h, 'en');
    expect((await redeem(h, p.token)).status).toBe(200);
    const { token } = (await (await h.app.request('/v1/device-sessions', json({ email: p.email, password: SETUP_TEST_PASSWORD }))).json()) as Loose;
    const res = await h.app.request('/v1/me/password', json({ currentPassword: SETUP_TEST_PASSWORD, newPassword: 'another long enough passphrase' }, { authorization: `Bearer ${token}` }));
    expect(res.status).toBe(204);
  });

  it('with no mailer configured, both routes answer exactly as before', async () => {
    const store = new MemoryLedgerStore();
    const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN['x-admin-token'], keyEnvironment: 'test', version: '0.1.0-test', now: () => NOW });
    const res = await app.request('/admin/v1/users', json({ email: 'plain@studio.example', displayName: 'Rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' }, ADMIN));
    const created = (await res.json()) as Loose;
    const redeemed = await app.request('/v1/account-setup', json({ token: setupTokenOf(created.setupLink.url), password: SETUP_TEST_PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version }, { origin: 'http://localhost' }));
    expect(redeemed.status).toBe(200);
    const { token } = (await (await app.request('/v1/device-sessions', json({ email: 'plain@studio.example', password: SETUP_TEST_PASSWORD }))).json()) as Loose;
    const changed = await app.request('/v1/me/password', json({ currentPassword: SETUP_TEST_PASSWORD, newPassword: 'another long enough passphrase' }, { authorization: `Bearer ${token}` }));
    expect(changed.status).toBe(204);
  });

  it('a send log that is down changes neither answer', async () => {
    const h = harness();
    h.store.email.isSuppressed = async () => { throw new Error('database is down'); };
    const p = await provision(h, 'en');
    expect((await redeem(h, p.token)).status).toBe(200);
    const { token } = (await (await h.app.request('/v1/device-sessions', json({ email: p.email, password: SETUP_TEST_PASSWORD }))).json()) as Loose;
    const res = await h.app.request('/v1/me/password', json({ currentPassword: SETUP_TEST_PASSWORD, newPassword: 'another long enough passphrase' }, { authorization: `Bearer ${token}` }));
    expect(res.status).toBe(204);
  });

  it('links to the portal over https when no portal origin is configured, never the plain-http request URL', () => {
    expect(signInLinkOf({}, 'http://mutaba3a-api.example.test/v1/me/password')).toBe('https://mutaba3a-api.example.test/');
    expect(signInLinkOf({}, 'http://localhost:8787/v1/me/password')).toBe('http://localhost:8787/');
    expect(signInLinkOf({ portalOrigin: 'https://portal.example.test/' }, 'http://x.example.test/')).toBe('https://portal.example.test/');
  });
});
