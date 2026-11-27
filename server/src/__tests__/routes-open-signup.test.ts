import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { TurnstileVerifier } from '../auth/turnstile.js';
import type { PasswordHasher } from '../auth/users.js';
import { createMailer } from '../email/mailer.js';
import { createReviewDigest } from '../email/review-digest.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { CURRENT_TERMS } from '../legal.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { setupTokenOf } from './helpers/provision.js';

/**
 * MUT-737 (ADR-289): open sign-up. With OPEN_SIGNUP on every verified sign-up the screen lets through opens ACTIVE on
 * Starter; the domain class is kept on `user.signed_up` as a signal; the review's decisions are retired, and pending
 * accounts are released on Starter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const PORTAL = 'https://portal.example.test';
const SAME_ORIGIN = { origin: PORTAL };
const NOW = new Date('2026-11-27T09:00:00Z');
const PASSWORD = 'a brand new long passphrase';
const SUPPORT = 'help@studio.example';
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const OK_ONLY: TurnstileVerifier = { mode: 'test', verify: async (token) => token === 'ok' };
const generous = () => new SlidingWindowRateLimiter(1000);
const plainHasher: PasswordHasher = { hash: async (p) => `plain:${p}`, verify: async (h, p) => h === `plain:${p}` };

function harness(options: { openSignup: boolean; starterPlan?: boolean }) {
  const store = new MemoryLedgerStore({ starterPlan: options.starterPlan ?? true });
  const logger = pino({ level: 'silent' });
  const outbox = new MemoryMailTransport(() => NOW);
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: SUPPORT, limits: { daily: 500, securityReserve: 50, perRecipient: 50 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    passwordHasher: plainHasher,
    signInIpLimiter: generous(),
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180, portalOrigin: PORTAL },
    selfService: { signupEnabled: true, openSignup: options.openSignup, mailsLinks: true, turnstile: OK_ONLY, ipLimiter: generous(), addressMinuteLimiter: generous(), addressDayLimiter: generous(), floors: { signupMs: 5, recoveryMs: 5 } },
    signupReview: { digest: createReviewDigest({ store, mailer, logger, now: () => NOW, to: 'ops@studio.example' }), supportAddress: SUPPORT },
  });
  return { app, store, outbox };
}
type Harness = ReturnType<typeof harness>;

let seq = 0;
const at = (domain: string) => `open${++seq}@${domain}`;
const signup = (h: Harness, email: string) => h.app.request('/v1/signups', json({ email, locale: 'en', turnstileToken: 'ok' }, SAME_ORIGIN));
const tokenIn = (h: Harness, to: string) => {
  const link = h.outbox.list({ to }).at(-1)?.text.match(/https:\/\/portal\.example\.test\/setup#[A-Za-z0-9_-]{43}/)?.[0];
  return link ? setupTokenOf(link) : null;
};
const redeem = (h: Harness, token: string) =>
  h.app.request('/v1/account-setup', json({ token, password: PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, SAME_ORIGIN));
const admin = (h: Harness, path: string, method = 'GET') => h.app.request(path, { method, headers: ADMIN });

async function signUpAndRedeem(h: Harness, email: string) {
  expect((await signup(h, email)).status).toBe(202);
  const token = tokenIn(h, email);
  expect(token).not.toBeNull();
  const res = await redeem(h, token!);
  expect(res.status).toBe(200);
  return (await res.json()) as Loose;
}

async function signedUpAudit(h: Harness, userId: string) {
  const [membership] = await h.store.memberships.listByUser(userId);
  const page = await h.store.audit.list(membership!.organizationId, { action: 'user.signed_up' }, { limit: 10, cursor: null });
  return page.items[0];
}

describe('MUT-737 open sign-up (OPEN_SIGNUP on)', () => {
  it('AC1/AC3: a gmail.com sign-up opens ACTIVE on Starter, signs in at once, and keeps its class on the audit', async () => {
    const h = harness({ openSignup: true });
    const email = at('gmail.com');
    expect(await signUpAndRedeem(h, email)).toEqual({ email, status: 'ACTIVE' });
    const user = (await h.store.users.findByEmail(email))!;
    expect(user.status).toBe('ACTIVE');
    expect((await h.store.billing.summaryOf(user.id)).trialStartedAt).toBeNull();
    expect(await h.store.signupReviews.findByUser(user.id)).toBeNull();
    expect((await h.app.request('/v1/sessions', json({ email, password: PASSWORD }, SAME_ORIGIN))).status).toBe(201);
    expect((await signedUpAudit(h, user.id))?.metadata).toMatchObject({ status: 'ACTIVE', domainClass: 'WEBMAIL', reasons: expect.arrayContaining(['webmail']) });
    // No "we're reviewing" mail, and no digest.
    expect(h.outbox.list({ to: email }).some((m) => /review/i.test(m.subject))).toBe(false);
    expect(h.outbox.list({ to: 'ops@studio.example' })).toHaveLength(0);
  });

  it('AC2: the screen still refuses disposable addresses', async () => {
    const h = harness({ openSignup: true });
    const res = await signup(h, at('mailinator.com'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as Loose).error.code).toBe('EMAIL_NOT_ACCEPTED');
  });

  it('AC4: approve and decline answer 409 SIGNUP_REVIEW_RETIRED; the list still works', async () => {
    const h = harness({ openSignup: false });
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    const user = (await h.store.users.findByEmail(email))!;
    expect(user.status).toBe('PENDING_REVIEW');
    // The same store, now served with the flag on (a server restarted with OPEN_SIGNUP).
    const open = { ...h, app: harnessOn(h.store).app };
    for (const verb of ['approve', 'decline']) {
      const res = await admin(open, `/admin/v1/signup-reviews/${user.id}/${verb}`, 'POST');
      expect(res.status).toBe(409);
      expect(((await res.json()) as Loose).error.code).toBe('SIGNUP_REVIEW_RETIRED');
    }
    const list = await admin(open, '/admin/v1/signup-reviews?state=pending');
    expect(list.status).toBe(200);
    expect(((await list.json()) as Loose).data).toHaveLength(1);
    expect(((await (await open.app.request('/v1/self-service')).json()) as Loose).openSignup).toBe(true);
  });

  it('AC5: release opens a pending account on Starter, audited and mailed once; a second release is ALREADY_DECIDED', async () => {
    const h = harness({ openSignup: false });
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    const user = (await h.store.users.findByEmail(email))!;
    const open = { ...h, app: harnessOn(h.store, h.outbox).app };
    const res = await admin(open, `/admin/v1/signup-reviews/${user.id}/release`, 'POST');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Loose).review.decision).toBe('APPROVED');
    expect((await h.store.users.getById(user.id))?.status).toBe('ACTIVE');
    expect((await h.store.billing.summaryOf(user.id)).trialStartedAt).toBeNull();
    const [membership] = await h.store.memberships.listByUser(user.id);
    const released = await h.store.audit.list(membership!.organizationId, { action: 'user.signup_released' }, { limit: 10, cursor: null });
    expect(released.items).toHaveLength(1);
    expect(h.outbox.list({ to: email }).filter((m) => /ready/i.test(m.subject))).toHaveLength(1);
    const again = await admin(open, `/admin/v1/signup-reviews/${user.id}/release`, 'POST');
    expect(again.status).toBe(409);
    expect(((await again.json()) as Loose).error.details.reason).toBe('ALREADY_DECIDED');
  });

  it('AC5: release is refused while STARTER_PLAN is off (it would start a trial)', async () => {
    const h = harness({ openSignup: false, starterPlan: false });
    const email = at('gmail.com');
    await signUpAndRedeem(h, email);
    const user = (await h.store.users.findByEmail(email))!;
    const res = await admin(h, `/admin/v1/signup-reviews/${user.id}/release`, 'POST');
    expect(res.status).toBe(409);
    expect(((await res.json()) as Loose).error.details.reason).toBe('STARTER_PLAN_OFF');
    expect((await h.store.users.getById(user.id))?.status).toBe('PENDING_REVIEW');
  });

  it('off: a gmail.com sign-up still waits for review, with no class change', async () => {
    const h = harness({ openSignup: false });
    const email = at('gmail.com');
    expect((await signUpAndRedeem(h, email)).status).toBe('PENDING_REVIEW');
  });
});

/** A second app on the same store (and outbox) with OPEN_SIGNUP on, as after a restart with the flag. */
function harnessOn(store: MemoryLedgerStore, outbox = new MemoryMailTransport(() => NOW)) {
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: SUPPORT, limits: { daily: 500, securityReserve: 50, perRecipient: 50 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    passwordHasher: plainHasher,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1, portalOrigin: PORTAL },
    selfService: { signupEnabled: true, openSignup: true, mailsLinks: true, turnstile: OK_ONLY, ipLimiter: generous(), addressMinuteLimiter: generous(), addressDayLimiter: generous(), floors: { signupMs: 5, recoveryMs: 5 } },
  });
  return { app };
}
