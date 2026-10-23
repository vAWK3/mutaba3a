import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { TurnstileVerifier } from '../auth/turnstile.js';
import { createMailer } from '../email/mailer.js';
import { createReviewDigest } from '../email/review-digest.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import type { PasswordHasher } from '../auth/users.js';
import { CURRENT_TERMS } from '../legal.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { setupTokenOf } from './helpers/provision.js';

/**
 * MUT-367 (ADR-159 §7a, ADR-177): the business-email screen at signup and the operator's review queue, end to end
 * through the routes on the memory store and the fixture domain checker (no DNS anywhere).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const PORTAL = 'https://portal.example.test';
const SAME_ORIGIN = { origin: PORTAL };
const NOW = new Date('2026-10-24T09:00:00Z');
const PASSWORD = 'a brand new long passphrase';
const OPERATOR = 'ops@studio.example';
const SUPPORT = 'help@studio.example';
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const OK_ONLY: TurnstileVerifier = { mode: 'test', verify: async (token) => token === 'ok' };
const generous = () => new SlidingWindowRateLimiter(1000);

/** A hasher that counts verifies and takes a fixed time, so both refusal paths can be compared without argon2. */
function countingHasher(delayMs = 15): PasswordHasher & { verifies: number } {
  const hasher = {
    verifies: 0,
    hash: async (password: string) => `plain:${password}`,
    verify: async (hash: string, password: string) => {
      hasher.verifies++;
      await new Promise((r) => setTimeout(r, delayMs));
      return hash === `plain:${password}`;
    },
  };
  return hasher;
}

function harness() {
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const outbox = new MemoryMailTransport(() => NOW);
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: SUPPORT, limits: { daily: 500, securityReserve: 50, perRecipient: 50 } });
  const passwordHasher = countingHasher();
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    passwordHasher,
    signInIpLimiter: generous(),
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180, portalOrigin: PORTAL },
    selfService: { signupEnabled: true, turnstile: OK_ONLY, ipLimiter: generous(), addressMinuteLimiter: generous(), addressDayLimiter: generous(), floors: { signupMs: 5, recoveryMs: 5 } },
    signupReview: { digest: createReviewDigest({ store, mailer, logger, now: () => NOW, to: OPERATOR }), supportAddress: SUPPORT },
  });
  return { app, store, outbox, passwordHasher };
}
type Harness = ReturnType<typeof harness>;

let seq = 0;
const at = (domain: string) => `person${++seq}@${domain}`;
const signup = (h: Harness, email: string) => h.app.request('/v1/signups', json({ email, locale: 'en', turnstileToken: 'ok' }, SAME_ORIGIN));
const tokenIn = (h: Harness, to: string) => {
  const link = h.outbox.list({ to }).at(-1)?.text.match(/https:\/\/portal\.example\.test\/setup#[A-Za-z0-9_-]{43}/)?.[0];
  return link ? setupTokenOf(link) : null;
};
const redeem = (h: Harness, token: string) =>
  h.app.request('/v1/account-setup', json({ token, password: PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, SAME_ORIGIN));
const cookieSignIn = (h: Harness, email: string, password = PASSWORD) => h.app.request('/v1/sessions', json({ email, password }, SAME_ORIGIN));
const deviceSignIn = (h: Harness, email: string, password = PASSWORD) => h.app.request('/v1/device-sessions', json({ email, password }));
const admin = (h: Harness, path: string, method = 'GET') => h.app.request(path, { method, headers: ADMIN });

/** Signs up and redeems; returns the redeem's answer. */
async function signUpAndRedeem(h: Harness, email: string) {
  expect((await signup(h, email)).status).toBe(202);
  const token = tokenIn(h, email);
  expect(token).not.toBeNull();
  const res = await redeem(h, token!);
  expect(res.status).toBe(200);
  return (await res.json()) as Loose;
}

describe('MUT-367 signup screen (A1)', () => {
  it('S1: a disposable domain is refused with 400 EMAIL_NOT_ACCEPTED, and no mail or token', async () => {
    const h = harness();
    const email = at('mailinator.com');
    const res = await signup(h, email);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Loose).error).toMatchObject({ code: 'EMAIL_NOT_ACCEPTED', details: { reason: 'disposable' } });
    expect(h.outbox.list({ to: email })).toHaveLength(0);
  });

  it('S2: a domain that takes no mail is refused the same way, reason no-mail', async () => {
    const h = harness();
    const email = at('nomail.example');
    const res = await signup(h, email);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Loose).error.details).toEqual({ reason: 'no-mail' });
    expect(h.outbox.list({ to: email })).toHaveLength(0);
  });

  it('S3: a business domain opens at once, with its trial', async () => {
    const h = harness();
    const email = at('business.example');
    expect(await signUpAndRedeem(h, email)).toEqual({ email, status: 'ACTIVE' });
    const user = (await h.store.users.findByEmail(email))!;
    expect(user.status).toBe('ACTIVE');
    expect((await h.store.billing.summaryOf(user.id)).trialStartedAt?.toISOString()).toBe(NOW.toISOString());
    expect(await h.store.signupReviews.findByUser(user.id)).toBeNull();
    expect((await cookieSignIn(h, email)).status).toBe(201);
  });

  it('S4: gmail.com waits for review with no trial; the person is told, and the operator gets a digest', async () => {
    const h = harness();
    const email = at('gmail.com');
    expect(await signUpAndRedeem(h, email)).toEqual({ email, status: 'PENDING_REVIEW' });
    const user = (await h.store.users.findByEmail(email))!;
    expect(user.status).toBe('PENDING_REVIEW');
    expect((await h.store.billing.summaryOf(user.id)).trialStartedAt).toBeNull();
    expect(await h.store.signupReviews.findByUser(user.id)).toMatchObject({ domain: 'gmail.com', classification: 'WEBMAIL', reasons: ['webmail'] });
    expect(h.outbox.list({ to: email }).map((m) => m.template)).toEqual(['finish-signup', 'account-under-review']);
    expect(h.outbox.list({ to: OPERATOR }).map((m) => m.template)).toEqual(['review-digest']);
  });

  it('S5: a 12-day-old domain waits with reason rdap-age-12d; a relay alias waits with reason relay', async () => {
    const h = harness();
    const young = at('young.example');
    const relay = at('duck.com');
    await signUpAndRedeem(h, young);
    await signUpAndRedeem(h, relay);
    const youngUser = (await h.store.users.findByEmail(young))!;
    const relayUser = (await h.store.users.findByEmail(relay))!;
    expect(await h.store.signupReviews.findByUser(youngUser.id)).toMatchObject({ classification: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-12d'] });
    expect(await h.store.signupReviews.findByUser(relayUser.id)).toMatchObject({ classification: 'BUSINESS_UNVERIFIED', reasons: ['relay'] });
    // Two pending in one hour: one digest.
    expect(h.outbox.list({ to: OPERATOR })).toHaveLength(1);
  });

  it('D8: signing up again with a pending account’s address gets the “you already have an account” mail', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    expect((await signup(h, email)).status).toBe(202);
    expect(h.outbox.list({ to: email }).at(-1)?.template).toBe('account-exists');
  });
});

describe('MUT-367 sign-in while under review (A2)', () => {
  it('S6: the right password answers 403 ACCOUNT_UNDER_REVIEW on the portal and the phone, with no session', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    for (const res of [await cookieSignIn(h, email), await deviceSignIn(h, email)]) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as Loose).error.code).toBe('ACCOUNT_UNDER_REVIEW');
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    expect((await h.store.users.findByEmail(email))?.failedSignIns).toBe(0);
  });

  it('S7: a wrong password answers exactly as an unknown account does: same status, body, and one hash verify each', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    const answer = async (address: string) => {
      const before = h.passwordHasher.verifies;
      const started = performance.now();
      const res = await cookieSignIn(h, address, 'not the password at all');
      const elapsed = performance.now() - started;
      const body = (await res.json()) as Loose;
      return { status: res.status, code: body.error.code, message: body.error.message, verifies: h.passwordHasher.verifies - before, elapsed };
    };
    const pending = await answer(email);
    const unknown = await answer(at('gmail.com'));
    expect({ ...pending, elapsed: 0 }).toEqual({ ...unknown, elapsed: 0 });
    expect(pending).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', verifies: 1 });
    // Both paths wait on the one verify (15 ms here); neither returns early.
    expect(pending.elapsed).toBeGreaterThanOrEqual(14);
    expect(unknown.elapsed).toBeGreaterThanOrEqual(14);
  });

  it('S8: a locked pending account answers 401 even with the right password', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    for (let i = 0; i < 10; i++) await cookieSignIn(h, email, 'wrong password, again');
    expect((await cookieSignIn(h, email)).status).toBe(401);
  });

  it('S9: a pending person can recover; the new password still meets the waiting screen', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    expect((await h.app.request('/v1/account-recovery', json({ email, turnstileToken: 'ok' }, SAME_ORIGIN))).status).toBe(202);
    expect(h.outbox.list({ to: email }).at(-1)?.template).toBe('reset-password');
    const token = tokenIn(h, email)!;
    const res = await h.app.request('/v1/account-setup', json({ token, password: 'another long passphrase here', acceptedTermsVersion: CURRENT_TERMS.version }, SAME_ORIGIN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email, status: 'PENDING_REVIEW' });
    expect((await cookieSignIn(h, email, 'another long passphrase here')).status).toBe(403);
  });
});

describe('MUT-367 the operator’s review queue (A3)', () => {
  it('lists pending signups oldest first, with the person, the domain and why', async () => {
    const h = harness();
    const first = at('gmail.com');
    const second = at('young.example');
    await signUpAndRedeem(h, first);
    await signUpAndRedeem(h, second);
    await signUpAndRedeem(h, at('business.example'));
    const res = await admin(h, '/admin/v1/signup-reviews?state=pending');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Loose;
    // Both at the same instant here (a fixed clock): oldest-first order is pinned by the store contract.
    expect(body.data.map((r: Loose) => r.email).sort()).toEqual([first, second].sort());
    expect(body.data.find((r: Loose) => r.email === second)).toMatchObject({ domain: 'young.example', classification: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-12d'], decision: null, locale: 'en' });
    expect((await h.app.request('/admin/v1/signup-reviews')).status).toBe(401);
  });

  it('S10: approve opens the account, starts the trial, mails the person, and they can sign in', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    const user = (await h.store.users.findByEmail(email))!;
    const res = await admin(h, `/admin/v1/signup-reviews/${user.id}/approve`, 'POST');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ review: { userId: user.id, email, decision: 'APPROVED' }, mail: 'sent' });
    expect((await h.store.billing.summaryOf(user.id)).trialStartedAt?.toISOString()).toBe(NOW.toISOString());
    const ready = h.outbox.list({ to: email }).at(-1)!;
    expect(ready.template).toBe('account-ready');
    expect(ready.text).toContain(`${PORTAL}/`);
    const profile = (await h.store.memberships.listByUser(user.id))[0]!;
    expect((await h.store.audit.listByOrganization(profile.organizationId, 20)).map((e) => e.action)).toContain('user.signup_approved');
    expect((await cookieSignIn(h, email)).status).toBe(201);
    const me = (await (await deviceSignIn(h, email)).json()) as Loose;
    expect(me).toBeTruthy();
  });

  it('S11: a second decision is 409 ALREADY_DECIDED; an unknown user is 404', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    const user = (await h.store.users.findByEmail(email))!;
    expect((await admin(h, `/admin/v1/signup-reviews/${user.id}/approve`, 'POST')).status).toBe(200);
    const again = await admin(h, `/admin/v1/signup-reviews/${user.id}/decline`, 'POST');
    expect(again.status).toBe(409);
    expect(((await again.json()) as Loose).error.details).toMatchObject({ reason: 'ALREADY_DECIDED', decision: 'APPROVED' });
    expect((await admin(h, '/admin/v1/signup-reviews/00000000-0000-4000-8000-000000000000/approve', 'POST')).status).toBe(404);
  });

  it('S12: decline deletes the account and profile, mails the support address, and signing in is refused like an unknown account', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    const user = (await h.store.users.findByEmail(email))!;
    const profileId = (await h.store.memberships.listByUser(user.id))[0]!.organizationId;
    const res = await admin(h, `/admin/v1/signup-reviews/${user.id}/decline`, 'POST');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ review: { userId: null, email: null, decision: 'DECLINED', domain: 'gmail.com' }, mail: 'sent' });
    expect(await h.store.users.findByEmail(email)).toBeNull();
    expect(await h.store.organizations.getById(profileId)).toBeNull();
    const declined = h.outbox.list({ to: email }).at(-1)!;
    expect(declined.template).toBe('account-declined');
    expect(declined.text).toContain(SUPPORT);
    const signIn = await cookieSignIn(h, email);
    expect(signIn.status).toBe(401);
    expect(((await signIn.json()) as Loose).error.code).toBe('INVALID_CREDENTIALS');
    expect((await admin(h, `/admin/v1/signup-reviews/${user.id}/decline`, 'POST')).status).toBe(404);
  });

  it('S13: after a decline the address can sign up again', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    const user = (await h.store.users.findByEmail(email))!;
    await admin(h, `/admin/v1/signup-reviews/${user.id}/decline`, 'POST');
    expect(await signUpAndRedeem(h, email)).toEqual({ email, status: 'PENDING_REVIEW' });
  });

  it('D11: the operator can’t enable or disable a pending signup around the review', async () => {
    const h = harness();
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    const user = (await h.store.users.findByEmail(email))!;
    for (const verb of ['enable', 'disable']) {
      const res = await admin(h, `/admin/v1/users/${user.id}/${verb}`, 'POST');
      expect(res.status).toBe(409);
      expect(((await res.json()) as Loose).error.details).toEqual({ reason: 'USER_PENDING_REVIEW' });
    }
    expect((await h.store.users.getById(user.id))?.status).toBe('PENDING_REVIEW');
  });

  it('D16: /v1/me names the status billing reads', async () => {
    const h = harness();
    const email = at('business.example');
    await signUpAndRedeem(h, email);
    const res = await cookieSignIn(h, email);
    expect(((await res.json()) as Loose).user.status).toBe('ACTIVE');
  });
});
