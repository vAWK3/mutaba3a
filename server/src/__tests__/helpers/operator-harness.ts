import pino from 'pino';
import { expect } from 'vitest';
import { createApp } from '../../app.js';
import type { TurnstileVerifier } from '../../auth/turnstile.js';
import { webauthnConfigOf } from '../../auth/webauthn.js';
import { createMailer } from '../../email/mailer.js';
import { createReviewDigest } from '../../email/review-digest.js';
import { MemoryMailTransport } from '../../email/transports/memory.js';
import { CURRENT_TERMS } from '../../legal.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { provisionUser, setupTokenOf } from './provision.js';
import { SoftAuthenticator } from './soft-authenticator.js';

/**
 * MUT-459/461 (ADR-212): the operator console's test harness — the real app on the memory store, a memory outbox, and
 * the real @simplewebauthn checks through a soft authenticator. People, operators (with a passkey, signed in with it),
 * waiting signups and step-ups, as the route tests need them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;
export const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
export const PORTAL = 'http://localhost';
export const SAME_ORIGIN = { origin: PORTAL };
export const PASSWORD = 'a brand new long passphrase';
export const COOKIE = 'mut_session';
export const OK_ONLY: TurnstileVerifier = { mode: 'test', verify: async (token) => token === 'ok' };
export const generous = () => new SlidingWindowRateLimiter(1000);
export const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
export const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

export function harness(options: { billingGate?: boolean; webauthn?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const clock = { now: new Date('2026-10-27T09:00:00Z') };
  const now = () => clock.now;
  const outbox = new MemoryMailTransport(now);
  const mailer = createMailer({ transport: outbox, store, logger, now, fromAddress: 'no-reply@mail.example.test', replyTo: 'help@studio.example', limits: { daily: 500, securityReserve: 50, perRecipient: 50 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now,
    mailer,
    signInIpLimiter: generous(),
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1 },
    ...(options.webauthn === false ? {} : { webauthn: webauthnConfigOf({ rpId: 'localhost', origins: PORTAL }) }),
    selfService: { signupEnabled: true, turnstile: OK_ONLY, ipLimiter: generous(), addressMinuteLimiter: generous(), addressDayLimiter: generous(), floors: { signupMs: 1, recoveryMs: 1 } },
    signupReview: { digest: createReviewDigest({ store, mailer, logger, now, to: 'ops@studio.example' }), supportAddress: 'help@studio.example' },
    billingGate: options.billingGate ?? false,
  });
  return { app, store, clock, outbox };
}
export type Harness = ReturnType<typeof harness>;

export const minutes = (h: Harness, n: number) => {
  h.clock.now = new Date(h.clock.now.getTime() + n * 60_000);
};
export const cookieOf = (res: Response) => new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
export const withSession = (token: string, extra: Record<string, string> = SAME_ORIGIN) => ({ cookie: `${COOKIE}=${token}`, ...extra });
export const get = (h: Harness, path: string, token?: string) => h.app.request(path, { headers: token ? withSession(token) : {} });
export const post = (h: Harness, path: string, token: string | undefined, body: unknown = {}, headers: Record<string, string> = SAME_ORIGIN) =>
  h.app.request(path, json(body, token ? { ...headers, cookie: `${COOKIE}=${token}` } : headers));

export async function person(h: Harness) {
  const email = `basel${++seq}@studio.example`;
  const created = await provisionUser(h.app, { email, displayName: 'Basel Sader', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  return { id: created.user.id as string, email, password: created.password as string };
}

export async function passwordSignIn(h: Harness, email: string, password: string) {
  const res = await h.app.request('/v1/sessions', json({ email, password }, SAME_ORIGIN));
  expect(res.status).toBe(201);
  return cookieOf(res);
}

export async function addPasskey(h: Harness, token: string, auth = new SoftAuthenticator()) {
  const { challengeId, publicKey } = await read(await post(h, '/v1/passkeys/creation-options', token));
  const res = await post(h, '/v1/passkeys', token, { challengeId, response: auth.create(publicKey, PORTAL) });
  expect(res.status).toBe(201);
  return auth;
}

export async function passkeySignIn(h: Harness, auth: SoftAuthenticator) {
  const { challengeId, publicKey } = await read(await h.app.request('/v1/passkey-challenges', { method: 'POST' }));
  const res = await h.app.request('/v1/sessions/passkey', json({ challengeId, response: auth.assert(publicKey, PORTAL) }, SAME_ORIGIN));
  expect(res.status).toBe(201);
  return cookieOf(res);
}

export const grantOperator = (h: Harness, userId: string) => h.app.request(`/admin/v1/users/${userId}/operator`, { method: 'PUT', headers: ADMIN });
export const revokeOperator = (h: Harness, userId: string) => h.app.request(`/admin/v1/users/${userId}/operator`, { method: 'DELETE', headers: ADMIN });

/** An operator with a passkey, freshly signed in with it (the step-up window is open). */
export async function operator(h: Harness, authenticator = new SoftAuthenticator()) {
  const p = await person(h);
  const password = await passwordSignIn(h, p.email, p.password);
  const auth = await addPasskey(h, password, authenticator);
  expect((await grantOperator(h, p.id)).status).toBe(200);
  const token = await passkeySignIn(h, auth);
  return { ...p, auth, token, passwordToken: password };
}

/** A self-service signup that waits for review (gmail.com, the fixture domain checker). */
export async function pendingSignup(h: Harness) {
  const email = `waiting${++seq}@gmail.com`;
  expect((await h.app.request('/v1/signups', json({ email, locale: 'en', turnstileToken: 'ok' }, SAME_ORIGIN))).status).toBe(202);
  const link = h.outbox.list({ to: email }).at(-1)?.text.match(/http:\/\/localhost\/setup#[A-Za-z0-9_-]{43}/)?.[0];
  const redeem = await h.app.request('/v1/account-setup', json({ token: setupTokenOf(link!), password: PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, SAME_ORIGIN));
  expect(redeem.status).toBe(200);
  const user = (await h.store.users.findByEmail(email))!;
  return { email, userId: user.id };
}

export async function stepUp(h: Harness, token: string, auth: SoftAuthenticator) {
  const optionsRes = await post(h, '/v1/operator/step-up/options', token);
  expect(optionsRes.status).toBe(200);
  const { challengeId, publicKey } = await read(optionsRes);
  return post(h, '/v1/operator/step-up', token, { challengeId, response: auth.assert(publicKey, PORTAL) });
}
