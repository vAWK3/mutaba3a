import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { sessionDigest } from '../auth/sessions.js';
import { operatorStepUpUntil } from '../auth/step-up.js';
import type { TurnstileVerifier } from '../auth/turnstile.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { CURRENT_TERMS } from '../legal.js';
import { SlidingWindowRateLimiter, type RateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { SETUP_TEST_PASSWORD, setupTokenOf } from './helpers/provision.js';

/**
 * MUT-618 (ADR-256): "Email me a sign-in code". POST /v1/sign-in-codes (portal) and /v1/device-sign-in-codes (phone)
 * answer every address alike and mail only an account that could sign in; POST /v1/sessions/code and
 * /v1/device-sessions/code sign in through the shared checks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const PORTAL = 'https://portal.example.test';
const SAME_ORIGIN = { origin: PORTAL };
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const START = new Date('2026-11-14T09:00:00Z');
const FLOORS = { signupMs: 60, recoveryMs: 40 };
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const OK_ONLY: TurnstileVerifier = { mode: 'test', verify: async (token) => token === 'ok' };
const generous = () => new SlidingWindowRateLimiter(1000);

interface HarnessOptions {
  ipLimiter?: RateLimiter;
  addressMinuteLimiter?: RateLimiter;
  addressDayLimiter?: RateLimiter;
  signInIpLimiter?: RateLimiter;
}

function harness(options: HarnessOptions = {}) {
  const clock = { now: START };
  const now = () => clock.now;
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const outbox = new MemoryMailTransport(now);
  const mailer = createMailer({ transport: outbox, store, logger, now, fromAddress: 'no-reply@mail.example.test', replyTo: 'help@example.test', limits: { daily: 500, securityReserve: 50, perRecipient: 50 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now,
    mailer,
    signInIpLimiter: options.signInIpLimiter ?? generous(),
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180, portalOrigin: PORTAL },
    selfService: {
      signupEnabled: true,
      mailsLinks: true,
      turnstile: OK_ONLY,
      ipLimiter: options.ipLimiter ?? generous(),
      addressMinuteLimiter: options.addressMinuteLimiter ?? generous(),
      addressDayLimiter: options.addressDayLimiter ?? generous(),
      floors: FLOORS,
    },
  });
  const advance = (minutes: number) => {
    clock.now = new Date(clock.now.getTime() + minutes * 60_000);
  };
  return { app, store, outbox, advance };
}
type Harness = ReturnType<typeof harness>;

let seq = 0;
const address = () => `coder${++seq}@studio.example`;

const askPortal = (h: Harness, email: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = SAME_ORIGIN) =>
  h.app.request('/v1/sign-in-codes', json({ email, locale: 'en', turnstileToken: 'ok', ...extra }, headers));
const askApp = (h: Harness, email: string, extra: Record<string, unknown> = {}) => h.app.request('/v1/device-sign-in-codes', json({ email, locale: 'ar', ...extra }));
const signInPortal = (h: Harness, email: string, code: string) => h.app.request('/v1/sessions/code', json({ email, code }, SAME_ORIGIN));
const signInApp = (h: Harness, email: string, code: string) => h.app.request('/v1/device-sessions/code', json({ email, code }));
const read = async (res: Response) => (await res.json()) as Loose;

/** The code in the newest mail to `to`. */
function codeFor(h: Harness, to: string): string {
  const mails = h.outbox.list({ to });
  const code = mails[mails.length - 1]?.text.match(/^\d{6}$/m)?.[0];
  if (!code) throw new Error(`no code mailed to ${to}`);
  return code;
}

/** Any six digits other than `code`. */
const wrongFor = (code: string) => (code === '000000' ? '111111' : '000000');

async function provision(h: Harness, options: { withPassword?: boolean } = {}) {
  const email = address();
  const res = await h.app.request('/admin/v1/users', json({ email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' }, ADMIN));
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
  return { status: res.status, elapsed: performance.now() - started, body: (await res.json()) as Loose };
}

describe('asking for a code (MUT-618 AC2)', () => {
  it('a real, an unknown, a disabled and a password-less address get the same answer and floor; only the real one is mailed', async () => {
    const h = harness();
    const real = await provision(h);
    const disabled = await provision(h);
    expect((await h.app.request(`/admin/v1/users/${disabled.id}/disable`, { method: 'POST', headers: ADMIN })).status).toBe(200);
    const noPassword = await provision(h, { withPassword: false });
    const unknown = address();

    for (const email of [real.email, unknown, disabled.email, noPassword.email]) {
      for (const ask of [askPortal, askApp]) {
        const answer = await timed(() => ask(h, email));
        expect(answer.status).toBe(202);
        expect(answer.body).toEqual({ status: 'sent' });
        expect(answer.elapsed).toBeGreaterThanOrEqual(FLOORS.recoveryMs - 2);
      }
    }
    expect(h.outbox.list({ to: real.email })).toHaveLength(2);
    for (const email of [unknown, disabled.email, noPassword.email]) expect(h.outbox.list({ to: email })).toHaveLength(0);
  });

  it('mails the code in the asked language, in the subject and on its own line, with no link', async () => {
    const h = harness();
    const real = await provision(h);
    await askApp(h, real.email);
    const [mail] = h.outbox.list({ to: real.email });
    expect(mail).toMatchObject({ template: 'sign-in-code', locale: 'ar' });
    const code = codeFor(h, real.email);
    expect(mail!.subject).toContain(code);
    expect(mail!.text).not.toMatch(/https?:\/\//);
    expect(mail!.html).toContain('data-code');
  });

  it('does not mail an account Sign in with Malafat created (a password nobody chose)', async () => {
    const h = harness();
    const email = address();
    await h.store.users.create({
      email,
      displayName: 'Malafat Partner',
      passwordHash: 'a-random-hash-nobody-holds',
      passwordChosen: false,
      locale: 'ar',
      personal: { name: 'Personal', slug: `personal-${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: START,
    });
    expect((await askApp(h, email)).status).toBe(202);
    expect(h.outbox.list({ to: email })).toHaveLength(0);
  });

  it('the portal ask is same-origin and Turnstile-checked; the phone ask needs neither', async () => {
    const h = harness();
    const real = await provision(h);
    expect((await read(await askPortal(h, real.email, {}, { origin: 'https://evil.example' }))).error.code).toBe('CROSS_SITE_REQUEST');
    expect((await read(await askPortal(h, real.email, { turnstileToken: 'bad' }))).error.code).toBe('CHECK_FAILED');
    expect(h.outbox.list({ to: real.email })).toHaveLength(0);
    expect((await askApp(h, real.email)).status).toBe(202);
  });

  it('says the door is open on a server that mails', async () => {
    const h = harness();
    expect((await read(await h.app.request('/v1/self-service'))).signInCode).toBe(true);
  });
});

describe('budgets (MUT-618 AC4)', () => {
  it('per address: one a minute, shared by the portal and the phone, and not with /recover', async () => {
    const h = harness({ addressMinuteLimiter: new SlidingWindowRateLimiter(1) });
    const real = await provision(h);
    expect((await askApp(h, real.email)).status).toBe(202);
    const second = await askPortal(h, real.email);
    expect(second.status).toBe(429);
    expect((await read(second)).error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect((await h.app.request('/v1/account-recovery', json({ email: real.email, turnstileToken: 'ok' }, SAME_ORIGIN))).status).toBe(202);
  });

  it('per client address, for both asks', async () => {
    const h = harness({ ipLimiter: new SlidingWindowRateLimiter(1, 3_600_000) });
    expect((await askApp(h, address())).status).toBe(202);
    expect((await askApp(h, address())).status).toBe(429);
    expect((await askPortal(h, address())).status).toBe(429);
  });

  it('signing in with a code spends the sign-in IP budget', async () => {
    const h = harness({ signInIpLimiter: new SlidingWindowRateLimiter(1) });
    const real = await provision(h);
    await askApp(h, real.email);
    expect((await signInApp(h, real.email, '123456')).status).not.toBe(429);
    expect((await signInApp(h, real.email, '123456')).status).toBe(429);
  });
});

describe('signing in with the code (MUT-618 AC1, AC3)', () => {
  it('the portal gets the cookie session and the phone a token, audited as email-code', async () => {
    const h = harness();
    const real = await provision(h);
    await askPortal(h, real.email);
    const cookie = await signInPortal(h, real.email, codeFor(h, real.email));
    expect(cookie.status).toBe(201);
    expect(cookie.headers.get('set-cookie')).toMatch(/mut_session=/);
    expect((await read(cookie)).user.email).toBe(real.email);

    await askApp(h, real.email);
    const device = await signInApp(h, real.email, codeFor(h, real.email));
    expect(device.status).toBe(201);
    const body = await read(device);
    expect(body.token).toEqual(expect.any(String));

    const [membership] = await h.store.memberships.listByUser(real.id);
    const events = (await h.store.audit.list(membership!.organizationId, { action: 'user.signed_in' }, { limit: 10, cursor: null })).items;
    expect(events.map((e) => e.metadata)).toEqual(expect.arrayContaining([
      { sessionKind: 'cookie', method: 'email-code' },
      { sessionKind: 'device', method: 'email-code' },
    ]));
  });

  it('works once', async () => {
    const h = harness();
    const real = await provision(h);
    await askApp(h, real.email);
    const code = codeFor(h, real.email);
    expect((await signInApp(h, real.email, code)).status).toBe(201);
    expect((await read(await signInApp(h, real.email, code))).error.code).toBe('SIGN_IN_CODE_EXPIRED');
  });

  it('expires after ten minutes', async () => {
    const h = harness();
    const real = await provision(h);
    await askApp(h, real.email);
    const code = codeFor(h, real.email);
    h.advance(10);
    expect((await read(await signInApp(h, real.email, code))).error.code).toBe('SIGN_IN_CODE_EXPIRED');
  });

  it('a resend cancels the older code', async () => {
    const h = harness();
    const real = await provision(h);
    await askApp(h, real.email);
    const older = codeFor(h, real.email);
    h.advance(1);
    await askApp(h, real.email);
    const newer = codeFor(h, real.email);
    if (older !== newer) expect((await read(await signInApp(h, real.email, older))).error.code).toBe('SIGN_IN_CODE_WRONG');
    expect((await signInApp(h, real.email, newer)).status).toBe(201);
  });

  it('counts wrong tries down; the fifth kills the code', async () => {
    const h = harness();
    const real = await provision(h);
    await askApp(h, real.email);
    const code = codeFor(h, real.email);
    const left = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await read(await signInApp(h, real.email, wrongFor(code)));
      expect(res.error.code).toBe('SIGN_IN_CODE_WRONG');
      left.push(res.error.details.triesLeft);
    }
    expect(left).toEqual([4, 3, 2, 1]);
    expect((await read(await signInApp(h, real.email, wrongFor(code)))).error.code).toBe('SIGN_IN_CODE_TOO_MANY_TRIES');
    // Five wrong tries are also the email key's lockout: the right code waits, and spends nothing.
    expect((await signInApp(h, real.email, code)).status).toBe(429);
  });

  it('an unknown address answers exactly like a real one', async () => {
    const h = harness();
    const real = await provision(h);
    const unknown = address();
    for (const email of [real.email, unknown]) await askApp(h, email);
    const realCode = codeFor(h, real.email);
    const answers = [];
    for (const email of [real.email, unknown]) {
      const res = await signInApp(h, email, wrongFor(realCode));
      const { code, message, details } = (await read(res)).error;
      answers.push({ status: res.status, code, message, details });
    }
    expect(answers[0]).toEqual(answers[1]);
    const never = await read(await signInApp(h, address(), '123456'));
    expect(never.error.code).toBe('SIGN_IN_CODE_EXPIRED');
  });

  it('refuses a malformed code before anything is spent', async () => {
    const h = harness();
    const real = await provision(h);
    expect((await signInApp(h, real.email, '12345')).status).toBe(422);
    expect((await signInApp(h, real.email, '12a456')).status).toBe(422);
  });

  it('a code mailed before the account was disabled no longer signs in', async () => {
    const h = harness();
    const real = await provision(h);
    await askApp(h, real.email);
    await h.app.request(`/admin/v1/users/${real.id}/disable`, { method: 'POST', headers: ADMIN });
    expect((await read(await signInApp(h, real.email, codeFor(h, real.email)))).error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('an account under review (MUT-618 AC4)', () => {
  it('the right code gets the under-review answer and no session', async () => {
    const h = harness();
    const real = await provision(h);
    await h.store.users.setStatus(real.id, 'PENDING_REVIEW', START);
    await askApp(h, real.email);
    const res = await signInApp(h, real.email, codeFor(h, real.email));
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('ACCOUNT_UNDER_REVIEW');
  });
});

describe('what a code session can do (MUT-618 AC5)', () => {
  async function codeSession(h: Harness) {
    const real = await provision(h);
    await askApp(h, real.email);
    const body = await read(await signInApp(h, real.email, codeFor(h, real.email)));
    return { ...real, token: body.token as string, auth: { authorization: `Bearer ${body.token}` } };
  }

  it('is not step-up stamped', async () => {
    const h = harness();
    const s = await codeSession(h);
    const session = await h.store.sessions.findByDigest(sessionDigest(PEPPER, s.token));
    expect(session?.stepUpAt ?? null).toBeNull();
    expect(operatorStepUpUntil(session!, START)).toBeNull();
  });

  it('cannot change the password or close the account without the current password', async () => {
    const h = harness();
    const s = await codeSession(h);
    const change = await h.app.request('/v1/me/password', json({ currentPassword: 'not the password at all', newPassword: 'another long passphrase here' }, s.auth));
    expect((await read(change)).error.code).toBe('CURRENT_PASSWORD_WRONG');
    const missing = await h.app.request('/v1/me/password', json({ newPassword: 'another long passphrase here' }, s.auth));
    expect(missing.status).toBeGreaterThanOrEqual(400);
    const close = await h.app.request('/v1/me/closure', json({ password: 'not the password at all' }, s.auth));
    expect((await read(close)).error.code).toBe('CURRENT_PASSWORD_WRONG');
  });
});
