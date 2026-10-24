import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import type { TurnstileVerifier } from '../auth/turnstile.js';
import { createMailer } from '../email/mailer.js';
import type { MailTransport } from '../email/ports.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { CURRENT_TERMS } from '../legal.js';
import { SlidingWindowRateLimiter, type RateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { SETUP_TEST_PASSWORD, setupTokenOf } from './helpers/provision.js';

/**
 * MUT-366 (ADR-159, ADR-175): POST /v1/signups and POST /v1/account-recovery mail links that end on the ADR-088
 * redeem. Every address gets the same answer no earlier than the floor; only the outbox differs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const PORTAL = 'https://portal.example.test';
const SAME_ORIGIN = { origin: PORTAL };
const NOW = new Date('2026-10-23T09:00:00Z');
const FLOORS = { signupMs: 60, recoveryMs: 40 };
const NEW_PASSWORD = 'a brand new long passphrase';
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

/** Passes the token "ok" and nothing else, for any action. */
const OK_ONLY: TurnstileVerifier = { mode: 'test', verify: async (token) => token === 'ok' };
const generous = () => new SlidingWindowRateLimiter(1000);

interface HarnessOptions {
  signupEnabled?: boolean;
  /** MUT-368: whether this server really mails links (a mailer and a Turnstile secret); absent = the default, off. */
  mailsLinks?: boolean;
  turnstile?: TurnstileVerifier;
  transport?: MailTransport;
  ipLimiter?: RateLimiter;
  addressMinuteLimiter?: RateLimiter;
  addressDayLimiter?: RateLimiter;
  extra?: Partial<AppDependencies>;
}

function harness(options: HarnessOptions = {}) {
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const transport = options.transport ?? new MemoryMailTransport(() => NOW);
  const mailer = createMailer({ transport, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: 'help@example.test', limits: { daily: 500, securityReserve: 50, perRecipient: 50 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    signInIpLimiter: generous(),
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180, portalOrigin: PORTAL },
    selfService: {
      signupEnabled: options.signupEnabled ?? true,
      ...(options.mailsLinks === undefined ? {} : { mailsLinks: options.mailsLinks }),
      turnstile: options.turnstile ?? OK_ONLY,
      ipLimiter: options.ipLimiter ?? generous(),
      addressMinuteLimiter: options.addressMinuteLimiter ?? generous(),
      addressDayLimiter: options.addressDayLimiter ?? generous(),
      floors: FLOORS,
    },
    ...options.extra,
  });
  const outbox = transport instanceof MemoryMailTransport ? transport : new MemoryMailTransport();
  return { app, store, outbox };
}
type Harness = ReturnType<typeof harness>;

let seq = 0;
const address = (domain = 'studio.example') => `person${++seq}@${domain}`;

const signup = (h: Harness, email: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = SAME_ORIGIN) =>
  h.app.request('/v1/signups', json({ email, locale: 'ar', turnstileToken: 'ok', ...extra }, headers));
const recover = (h: Harness, email: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = SAME_ORIGIN) =>
  h.app.request('/v1/account-recovery', json({ email, turnstileToken: 'ok', ...extra }, headers));
const check = (h: Harness, token: string) => h.app.request('/v1/account-setup/check', json({ token }, SAME_ORIGIN));
const redeem = (h: Harness, token: string, extra: Record<string, unknown> = {}) =>
  h.app.request('/v1/account-setup', json({ token, password: NEW_PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version, ...extra }, SAME_ORIGIN));
const SIGNUP_PROFILE = { defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' };
const deviceSignIn = (h: Harness, email: string, password: string) => h.app.request('/v1/device-sessions', json({ email, password }));

/** The token in the last mail to `to`, and that mail. */
function lastMail(h: Harness, to: string) {
  const mails = h.outbox.list({ to });
  const mail = mails[mails.length - 1];
  const link = mail?.text.match(/https:\/\/portal\.example\.test\/setup#[A-Za-z0-9_-]{43}/)?.[0];
  return { mail, token: link ? setupTokenOf(link) : null, count: mails.length };
}

/** An operator-provisioned person; `withPassword` redeems their first link the way they would. */
async function provision(h: Harness, options: { withPassword?: boolean; locale?: 'en' | 'ar' } = {}) {
  const email = address();
  const res = await h.app.request('/admin/v1/users', json({ email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: options.locale ?? 'en' }, ADMIN));
  const created = (await res.json()) as Loose;
  if (options.withPassword ?? true) {
    const set = await h.app.request('/v1/account-setup', json({ token: setupTokenOf(created.setupLink.url), password: SETUP_TEST_PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version }, SAME_ORIGIN));
    expect(set.status).toBe(200);
  }
  h.outbox.clear();
  return { email, id: created.user.id as string };
}

async function timed(request: () => Response | Promise<Response>) {
  const started = performance.now();
  const res = await request();
  return { res, elapsed: performance.now() - started, body: (await res.json()) as Loose };
}

describe('POST /v1/signups (MUT-366)', () => {
  it('A1: a new, an existing and a suppressed address get the same status, body and floor; only the outbox differs', async () => {
    const h = harness();
    const existing = await provision(h);
    const fresh = address();
    const suppressed = address();
    await h.store.email.suppress({ email: suppressed, reason: 'HARD_BOUNCE', eventId: 'evt_1', at: NOW });

    const answers = [];
    for (const email of [fresh, existing.email, suppressed]) answers.push(await timed(() => signup(h, email)));
    for (const a of answers) {
      expect(a.res.status).toBe(202);
      expect(a.body).toEqual({ status: 'sent' });
      // The floor, measured from outside (a timer may land a hair early on a coarse clock).
      expect(a.elapsed).toBeGreaterThanOrEqual(FLOORS.signupMs - 2);
    }

    const newMail = lastMail(h, fresh);
    expect(newMail.mail).toMatchObject({ template: 'finish-signup', locale: 'ar' });
    expect(newMail.token).not.toBeNull();
    expect(lastMail(h, existing.email).mail).toMatchObject({ template: 'account-exists', locale: 'ar' });
    expect(lastMail(h, existing.email).mail!.text).toContain(`${PORTAL}/recover`);
    expect(lastMail(h, existing.email).token).toBeNull();
    expect(h.outbox.list({ to: suppressed })).toHaveLength(0);
  });

  it('A2: the SIGNUP link creates exactly one user and personal profile, starts the trial, and works once', async () => {
    const h = harness();
    const email = address();
    await signup(h, email);
    const { token } = lastMail(h, email);

    const checked = (await (await check(h, token!)).json()) as Loose;
    expect(checked).toMatchObject({ state: 'valid', purpose: 'SIGNUP', email, locale: 'ar', termsVersion: CURRENT_TERMS.version });

    const res = await redeem(h, token!, { ...SIGNUP_PROFILE, clientRelease: 'web-v0.1.21' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email, status: 'ACTIVE' });
    // No session: the portal signs in through POST /v1/sessions (ADR-088 §5).
    expect(res.headers.get('set-cookie')).toBeNull();

    const user = (await h.store.users.findByEmail(email))!;
    expect(user).toMatchObject({ status: 'ACTIVE', locale: 'ar', displayName: email.split('@')[0] });
    expect(user.emailVerifiedAt?.toISOString()).toBe(NOW.toISOString());
    const memberships = await h.store.memberships.listByUser(user.id);
    expect(memberships).toHaveLength(1);
    const profile = await h.store.organizations.getById(memberships[0]!.organizationId);
    expect(profile).toMatchObject({ name: 'شخصي', personalOwnerUserId: user.id, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    expect((await h.store.billing.summaryOf(user.id)).trialStartedAt?.toISOString()).toBe(NOW.toISOString());
    expect(await h.store.users.latestTermsAcceptance(user.id)).toMatchObject({ version: CURRENT_TERMS.version, clientRelease: 'web-v0.1.21' });
    const actions = (await h.store.audit.listByOrganization(profile!.id, 20)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['organization.created', 'user.signed_up', 'user.terms_accepted']));
    // D11: no "password set" mail for an account the redeem just created.
    expect(h.outbox.list({ to: email }).map((m) => m.template)).toEqual(['finish-signup']);

    expect((await deviceSignIn(h, email, NEW_PASSWORD)).status).toBe(201);

    const again = await redeem(h, token!, SIGNUP_PROFILE);
    expect(again.status).toBe(410);
    expect(((await again.json()) as Loose).error.details).toEqual({ state: 'used' });
    expect(((await (await check(h, token!)).json()) as Loose).state).toBe('used');
  });

  it('A2: the redeem takes the name the page sends, and refuses a SIGNUP without a currency or a timezone', async () => {
    const h = harness();
    const email = address();
    await signup(h, email);
    const { token } = lastMail(h, email);
    const missing = await redeem(h, token!, { timezone: 'Asia/Jerusalem' });
    expect(missing.status).toBe(422);
    expect(((await (await check(h, token!)).json()) as Loose).state).toBe('valid');
    expect((await redeem(h, token!, { ...SIGNUP_PROFILE, displayName: 'Rana Saleh' })).status).toBe(200);
    expect((await h.store.users.findByEmail(email))?.displayName).toBe('Rana Saleh');
  });

  it('A2: a stale terms version is refused before anything is created', async () => {
    const h = harness();
    const email = address();
    await signup(h, email);
    const res = await redeem(h, lastMail(h, email).token!, { ...SIGNUP_PROFILE, acceptedTermsVersion: '2020-01-01' });
    expect(res.status).toBe(409);
    expect(await h.store.users.findByEmail(email)).toBeNull();
  });

  it('A2: one link redeemed twice at once makes one account; a newer link supersedes an older one', async () => {
    const h = harness();
    const email = address();
    await signup(h, email);
    const first = lastMail(h, email).token!;
    await signup(h, email);
    const second = lastMail(h, email).token!;
    expect(((await (await check(h, first)).json()) as Loose).state).toBe('superseded');

    const [a, b] = await Promise.all([redeem(h, second, SIGNUP_PROFILE), redeem(h, second, SIGNUP_PROFILE)]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
    expect((await redeem(h, first, SIGNUP_PROFILE)).status).toBe(410);
    const users = (await h.app.request(`/admin/v1/users?email=${encodeURIComponent(email)}`, { headers: ADMIN })).json() as Promise<Loose>;
    expect((await users).users).toHaveLength(1);
  });

  it('A2: an account created by the operator meanwhile turns the link into used', async () => {
    const h = harness();
    const email = address();
    await signup(h, email);
    const { token } = lastMail(h, email);
    await h.app.request('/admin/v1/users', json({ email, displayName: 'Operator made', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN));
    const res = await redeem(h, token!, SIGNUP_PROFILE);
    expect(res.status).toBe(410);
    expect(((await res.json()) as Loose).error.details).toEqual({ state: 'used' });
  });

  it('D16: a disabled account’s address gets no mail, and the same answer', async () => {
    const h = harness();
    const p = await provision(h);
    await h.app.request(`/admin/v1/users/${p.id}/disable`, json({}, ADMIN));
    const res = await signup(h, p.email);
    expect(res.status).toBe(202);
    expect(h.outbox.list({ to: p.email })).toHaveLength(0);
  });

  it('A5: with the switch off it is 404, and sends nothing', async () => {
    const h = harness({ signupEnabled: false });
    const email = address();
    const res = await signup(h, email);
    expect(res.status).toBe(404);
    expect(((await res.json()) as Loose).error.code).toBe('NOT_FOUND');
    expect(h.outbox.list({ to: email })).toHaveLength(0);
  });

  it('refuses a cross-site request and a malformed address, at once', async () => {
    const h = harness();
    expect((await signup(h, address(), {}, { origin: 'https://evil.example' })).status).toBe(403);
    const bad = await timed(() => signup(h, 'not-an-address'));
    expect(bad.res.status).toBe(422);
    expect(bad.elapsed).toBeLessThan(FLOORS.signupMs);
  });

  it('a mail provider that fails changes nothing about the answer', async () => {
    const broken: MailTransport = {
      kind: 'resend',
      deliver: async () => {
        throw new Error('Resend is down');
      },
    };
    const h = harness({ transport: broken });
    const res = await signup(h, address());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'sent' });
  });
});

describe('Turnstile and limits (MUT-366, A4)', () => {
  it('a missing, empty or failed check sends nothing', async () => {
    const h = harness();
    const email = address();
    expect((await h.app.request('/v1/signups', json({ email, locale: 'ar' }, SAME_ORIGIN))).status).toBe(422);
    for (const turnstileToken of ['', 'bad']) {
      const s = await signup(h, email, { turnstileToken });
      expect(s.status).toBe(403);
      expect(((await s.json()) as Loose).error.code).toBe('CHECK_FAILED');
      const r = await recover(h, email, { turnstileToken });
      expect(r.status).toBe(403);
    }
    expect(h.outbox.list({ to: email })).toHaveLength(0);
  });

  it('the per-IP budget answers 429, shared by both routes', async () => {
    const h = harness({ ipLimiter: new SlidingWindowRateLimiter(2, 3_600_000) });
    expect((await signup(h, address())).status).toBe(202);
    expect((await recover(h, address())).status).toBe(202);
    const refused = await signup(h, address());
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as Loose).error.code).toBe('RATE_LIMITED');
    expect(refused.headers.get('retry-after')).not.toBeNull();
  });

  it('the per-address budget answers 429 whether or not an account exists, and only after the check passed', async () => {
    const h = harness({ addressMinuteLimiter: new SlidingWindowRateLimiter(1) });
    const existing = await provision(h);
    for (const email of [address(), existing.email]) {
      expect((await signup(h, email, { turnstileToken: 'bad' })).status).toBe(403);
      expect((await signup(h, email)).status).toBe(202);
      const again = await recover(h, email);
      expect(again.status).toBe(429);
      expect(((await again.json()) as Loose).error.details).toMatchObject({ retryAfterSeconds: expect.any(Number) });
    }
    // Another address still goes through.
    expect((await signup(h, address())).status).toBe(202);
  });

  it('the daily per-address budget answers 429 too', async () => {
    const h = harness({ addressDayLimiter: new SlidingWindowRateLimiter(1, 24 * 3_600_000) });
    const email = address();
    expect((await recover(h, email)).status).toBe(202);
    expect((await recover(h, email)).status).toBe(429);
  });
});

describe('POST /v1/account-recovery (MUT-366)', () => {
  it('A3: an active account gets a 1-hour RESET link that changes nothing until it is used', async () => {
    const h = harness();
    const p = await provision(h);
    const before = await deviceSignIn(h, p.email, SETUP_TEST_PASSWORD);
    expect(before.status).toBe(201);
    const { token: session } = (await before.json()) as Loose;

    const asked = await timed(() => recover(h, p.email, { locale: 'ar' }));
    expect(asked.res.status).toBe(202);
    expect(asked.body).toEqual({ status: 'sent' });
    expect(asked.elapsed).toBeGreaterThanOrEqual(FLOORS.recoveryMs - 2);
    const { mail, token } = lastMail(h, p.email);
    expect(mail).toMatchObject({ template: 'reset-password', locale: 'ar' });

    // Nothing changed yet: the old password and the session still work.
    expect((await deviceSignIn(h, p.email, SETUP_TEST_PASSWORD)).status).toBe(201);
    expect((await h.app.request('/v1/me', { headers: { authorization: `Bearer ${session}` } })).status).toBe(200);

    const checked = (await (await check(h, token!)).json()) as Loose;
    expect(checked).toMatchObject({ state: 'valid', purpose: 'RESET', expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
  });

  it('A3: redeeming it revokes every session, clears the lockout, verifies the address and sends the notice', async () => {
    const h = harness();
    const p = await provision(h);
    const { token: session } = (await (await deviceSignIn(h, p.email, SETUP_TEST_PASSWORD)).json()) as Loose;
    for (let i = 0; i < 6; i++) await deviceSignIn(h, p.email, 'wrong password, again and again');
    expect((await deviceSignIn(h, p.email, SETUP_TEST_PASSWORD)).status).not.toBe(201);

    await recover(h, p.email);
    const { token } = lastMail(h, p.email);
    expect((await redeem(h, token!)).status).toBe(200);

    expect((await h.app.request('/v1/me', { headers: { authorization: `Bearer ${session}` } })).status).toBe(401);
    expect((await deviceSignIn(h, p.email, NEW_PASSWORD)).status).toBe(201);
    expect((await h.store.users.getById(p.id))?.emailVerifiedAt?.toISOString()).toBe(NOW.toISOString());
    expect(h.outbox.list({ to: p.email }).map((m) => m.template)).toEqual(['reset-password', 'password-changed']);
  });

  it('A3: an operator-created account that never set a password gets a SETUP link', async () => {
    const h = harness();
    const p = await provision(h, { withPassword: false, locale: 'ar' });
    await recover(h, p.email);
    const { mail, token } = lastMail(h, p.email);
    expect(mail).toMatchObject({ template: 'finish-setup', locale: 'ar' });
    expect(((await (await check(h, token!)).json()) as Loose).purpose).toBe('SETUP');
    expect((await redeem(h, token!)).status).toBe(200);
  });

  it('a disabled, unknown or suppressed address gets the same answer and no mail', async () => {
    const h = harness();
    const disabled = await provision(h);
    await h.app.request(`/admin/v1/users/${disabled.id}/disable`, json({}, ADMIN));
    const suppressed = await provision(h);
    await h.store.email.suppress({ email: suppressed.email, reason: 'COMPLAINT', eventId: 'evt_2', at: NOW });
    const unknown = address();
    for (const email of [disabled.email, suppressed.email, unknown]) {
      const a = await timed(() => recover(h, email));
      expect(a.res.status).toBe(202);
      expect(a.body).toEqual({ status: 'sent' });
      expect(a.elapsed).toBeGreaterThanOrEqual(FLOORS.recoveryMs - 2);
      expect(h.outbox.list({ to: email })).toHaveLength(0);
    }
  });

  it('A5: recovery works with the signup switch off', async () => {
    const h = harness({ signupEnabled: false });
    const p = await provision(h);
    expect((await recover(h, p.email)).status).toBe(202);
    expect(lastMail(h, p.email).mail?.template).toBe('reset-password');
  });
});

describe('code review fixes (MUT-366)', () => {
  it('#1: the Turnstile idempotency key is the server’s own, never the client’s X-Request-Id', async () => {
    const keys: string[] = [];
    const recording: TurnstileVerifier = {
      mode: 'live',
      verify: async (token, context) => {
        keys.push(context.idempotencyKey);
        return token === 'ok';
      },
    };
    const h = harness({ turnstile: recording });
    const fixed = { ...SAME_ORIGIN, 'x-request-id': '11111111-1111-4111-8111-111111111111' };
    await signup(h, address(), {}, fixed);
    await recover(h, address(), {}, fixed);
    expect(keys).toHaveLength(2);
    expect(keys).not.toContain(fixed['x-request-id']);
    expect(new Set(keys).size).toBe(2);
  });

  it('#2: a recovery request leaves the operator’s open link working; redeeming either closes the other', async () => {
    const h = harness();
    const p = await provision(h);
    const issued = (await (await h.app.request(`/admin/v1/users/${p.id}/setup-link`, json({}, ADMIN))).json()) as Loose;
    const operatorToken = setupTokenOf(issued.setupLink.url);
    await recover(h, p.email);
    const mailedToken = lastMail(h, p.email).token!;
    expect(((await (await check(h, operatorToken)).json()) as Loose).state).toBe('valid');
    expect(((await (await check(h, mailedToken)).json()) as Loose).state).toBe('valid');
    expect((await redeem(h, mailedToken)).status).toBe(200);
    expect(((await (await check(h, operatorToken)).json()) as Loose).state).toBe('superseded');
  });

  it('#3: a slow mail provider never holds the answer past the floor', async () => {
    const slow: MailTransport = { kind: 'resend', deliver: () => new Promise((resolve) => setTimeout(() => resolve({ id: 'late' }), 600)) };
    const h = harness({ transport: slow });
    const p = await provision(h);
    for (const request of [() => recover(h, p.email), () => signup(h, address())]) {
      const a = await timed(request);
      expect(a.res.status).toBe(202);
      expect(a.elapsed).toBeLessThan(400);
    }
  });

  it('#4: a store failure on one branch still answers the same 202 after the floor', async () => {
    const h = harness();
    const p = await provision(h);
    const accountSetup = h.store.accountSetup as unknown as Record<string, unknown>;
    accountSetup.issue = async () => {
      throw new Error('database went away');
    };
    accountSetup.issueSignup = async () => {
      throw new Error('database went away');
    };
    const r = await timed(() => recover(h, p.email));
    expect(r.res.status).toBe(202);
    expect(r.body).toEqual({ status: 'sent' });
    expect(r.elapsed).toBeGreaterThanOrEqual(FLOORS.recoveryMs - 2);
    const s = await timed(() => signup(h, address()));
    expect(s.res.status).toBe(202);
    expect(s.elapsed).toBeGreaterThanOrEqual(FLOORS.signupMs - 2);
  });
});

describe('GET /v1/self-service (MUT-368, D1)', () => {
  const doors = async (h: Harness) => {
    const res = await h.app.request('/v1/self-service');
    return { status: res.status, body: (await res.json()) as Loose };
  };

  it('names which doors this server really opens: signup by its switch, recovery only when it mails links', async () => {
    expect(await doors(harness({ signupEnabled: true, mailsLinks: true }))).toEqual({ status: 200, body: { signup: true, recovery: true } });
    expect(await doors(harness({ signupEnabled: false, mailsLinks: true }))).toEqual({ status: 200, body: { signup: false, recovery: true } });
    expect(await doors(harness({ signupEnabled: false, mailsLinks: false }))).toEqual({ status: 200, body: { signup: false, recovery: false } });
  });

  it('a server that mails no links offers neither door, whatever the switch says', async () => {
    expect(await doors(harness({ signupEnabled: true, mailsLinks: false }))).toEqual({ status: 200, body: { signup: false, recovery: false } });
  });

  it('defaults to both doors closed (absent options are a server with mail off)', async () => {
    const h = harness({ signupEnabled: false });
    expect((await doors(h)).body).toEqual({ signup: false, recovery: false });
  });

  it('needs no credential and no origin, and is never cached', async () => {
    const res = await harness({ mailsLinks: true }).app.request('/v1/self-service');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('a dead link names its purpose to its holder (MUT-368, D2)', () => {
  it('a used and a superseded SIGNUP link say SIGNUP; an expired RESET link says RESET; an unknown one says nothing', async () => {
    let clock = NOW;
    const h = harness({ extra: { now: () => clock } });
    const email = address();
    await signup(h, email);
    const first = lastMail(h, email).token!;
    clock = new Date(NOW.getTime() + 120_000);
    await signup(h, email);
    const second = lastMail(h, email).token!;
    expect(await (await check(h, first)).json()).toEqual({ state: 'superseded', purpose: 'SIGNUP' });
    expect((await redeem(h, second, SIGNUP_PROFILE)).status).toBe(200);
    expect(await (await check(h, second)).json()).toEqual({ state: 'used', purpose: 'SIGNUP' });

    const p = await provision(h);
    await recover(h, p.email);
    const reset = lastMail(h, p.email).token!;
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    expect(await (await check(h, reset)).json()).toEqual({ state: 'expired', purpose: 'RESET' });

    expect(await (await check(h, 'x'.repeat(43))).json()).toEqual({ state: 'invalid' });
  });
});
