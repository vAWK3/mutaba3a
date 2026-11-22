import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { sessionDigest } from '../auth/sessions.js';
import * as signInModule from '../auth/sign-in.js';
import { stepOf, totpAt, generateTotpSecret } from '../auth/totp.js';
import { generateRecoveryCodes, TwoFactorKeys } from '../auth/two-factor.js';
import type { TurnstileVerifier } from '../auth/turnstile.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { CURRENT_TERMS } from '../legal.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { TwoFactorMethod } from '../repositories/ports.js';
import { SETUP_TEST_PASSWORD, setupTokenOf } from './helpers/provision.js';

/**
 * MUT-710 (ADR-275 D1–D3, D6, D11, D14): the second step at every sign-in entry point (password, emailed code, cookie
 * and device), its single use and counting under parallel requests, and every person setup link, SETUP included.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const PORTAL = 'https://portal.example.test';
const SAME_ORIGIN = { origin: PORTAL };
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const KEYS = new TwoFactorKeys('two-factor-seal-key-for-tests-at-least-32');
const START = new Date('2026-11-24T09:00:00Z');
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const OK_ONLY: TurnstileVerifier = { mode: 'test', verify: async (token) => token === 'ok' };
const generous = () => new SlidingWindowRateLimiter(100_000);

function harness() {
  const clock = { now: START };
  const now = () => clock.now;
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const outbox = new MemoryMailTransport(now);
  const mailer = createMailer({ transport: outbox, store, logger, now, fromAddress: 'no-reply@mail.example.test', replyTo: 'help@example.test', limits: { daily: 500, securityReserve: 50, perRecipient: 50 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: generous(),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now,
    mailer,
    twoFactorKeys: KEYS,
    signInIpLimiter: generous(),
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180, portalOrigin: PORTAL },
    selfService: { signupEnabled: true, mailsLinks: true, turnstile: OK_ONLY, ipLimiter: generous(), addressMinuteLimiter: generous(), addressDayLimiter: generous(), floors: { signupMs: 0, recoveryMs: 0 } },
  });
  const advance = (seconds: number) => {
    clock.now = new Date(clock.now.getTime() + seconds * 1000);
  };
  return { app, store, outbox, advance, now };
}
type Harness = ReturnType<typeof harness>;

let seq = 0;
const read = async (res: Response) => (await res.json()) as Loose;

interface Person {
  email: string;
  id: string;
  secret: string;
  recoveryCodes: string[];
}

async function provision(h: Harness, method: TwoFactorMethod | null = 'totp'): Promise<Person> {
  const email = `two-step${++seq}@studio.example`;
  const res = await h.app.request('/admin/v1/users', json({ email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' }, ADMIN));
  const created = (await res.json()) as Loose;
  const set = await h.app.request('/v1/account-setup', json({ token: setupTokenOf(created.setupLink.url), password: SETUP_TEST_PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version }, SAME_ORIGIN));
  expect(set.status).toBe(200);
  const id = created.user.id as string;
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  if (method) {
    await h.store.twoFactor.enable({
      userId: id,
      method,
      totpSecretSealed: method === 'totp' ? KEYS.sealSecret(secret) : null,
      lastUsedStep: null,
      recoveryDigests: recoveryCodes.map((code) => KEYS.recoveryDigest(id, code)),
      at: h.now(),
      keepSessionId: null,
      audit: [],
    });
  }
  h.outbox.clear();
  return { email, id, secret, recoveryCodes };
}

const totpNow = (h: Harness, p: Person) => totpAt(p.secret, stepOf(h.now()));
const wrongFor = (code: string) => (code === '000000' ? '111111' : '000000');
const passwordPortal = (h: Harness, p: Person, password = SETUP_TEST_PASSWORD) => h.app.request('/v1/sessions', json({ email: p.email, password }, SAME_ORIGIN));
const passwordApp = (h: Harness, p: Person) => h.app.request('/v1/device-sessions', json({ email: p.email, password: SETUP_TEST_PASSWORD }));
const finishPortal = (h: Harness, body: Record<string, unknown>) => h.app.request('/v1/sessions/two-factor', json(body, SAME_ORIGIN));
const finishApp = (h: Harness, body: Record<string, unknown>) => h.app.request('/v1/device-sessions/two-factor', json(body));

async function challengeOf(res: Response): Promise<Loose> {
  expect(res.status).toBe(403);
  const body = await read(res);
  expect(body.error.code).toBe('TWO_FACTOR_REQUIRED');
  return body.error.details;
}

function lastCode(h: Harness, to: string): string {
  const mails = h.outbox.list({ to });
  const code = mails[mails.length - 1]?.text.match(/^\d{6}$/m)?.[0];
  if (!code) throw new Error(`no code mailed to ${to}`);
  return code;
}

async function signedInEvents(h: Harness, p: Person) {
  const [membership] = await h.store.memberships.listByUser(p.id);
  return (await h.store.audit.list(membership!.organizationId, {}, { limit: 100, cursor: null })).items;
}

describe('the second step at sign-in (MUT-710 AC2, D1, D2)', () => {
  it('a password sign-in gets a challenge and no session; the right code finishes it with the cookie, stamped twoFactorAt', async () => {
    const h = harness();
    const p = await provision(h);
    const first = await passwordPortal(h, p);
    expect(first.headers.get('set-cookie')).toBeNull();
    const details = await challengeOf(first);
    expect(details).toMatchObject({ method: 'totp', challengeToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: expect.any(String) });
    expect(details.emailHint).toBeUndefined();

    const done = await finishPortal(h, { challengeToken: details.challengeToken, code: totpNow(h, p) });
    expect(done.status).toBe(201);
    const token = done.headers.get('set-cookie')?.match(/mut_session=([^;]+)/)?.[1];
    expect((await read(done)).user.email).toBe(p.email);
    expect((await h.store.sessions.findByDigest(sessionDigest(PEPPER, token!)))?.twoFactorAt).toEqual(h.now());
    expect((await signedInEvents(h, p)).filter((e) => e.action === 'user.signed_in').map((e) => e.metadata)).toEqual([{ sessionKind: 'cookie', method: 'password', twoFactor: 'totp' }]);
  });

  it('the phone gets a challenge too and a token at finish; a device challenge can’t finish as a cookie', async () => {
    const h = harness();
    const p = await provision(h);
    const details = await challengeOf(await passwordApp(h, p));
    expect((await read(await finishPortal(h, { challengeToken: details.challengeToken, code: totpNow(h, p) }))).error.code).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');
    const done = await finishApp(h, { challengeToken: details.challengeToken, code: totpNow(h, p) });
    expect(done.status).toBe(201);
    expect((await read(done)).token).toEqual(expect.any(String));
  });

  it('a person without it signs in as before', async () => {
    const h = harness();
    const p = await provision(h, null);
    expect((await passwordPortal(h, p)).status).toBe(201);
  });

  it('a wrong code says how many tries are left; a challenge works once', async () => {
    const h = harness();
    const p = await provision(h);
    const { challengeToken } = await challengeOf(await passwordPortal(h, p));
    const wrong = await read(await finishPortal(h, { challengeToken, code: wrongFor(totpNow(h, p)) }));
    expect(wrong.error).toMatchObject({ code: 'TWO_FACTOR_CODE_WRONG', details: { triesLeft: 4 } });
    expect((await finishPortal(h, { challengeToken, code: totpNow(h, p) })).status).toBe(201);
    h.advance(60);
    expect((await read(await finishPortal(h, { challengeToken, code: totpNow(h, p) }))).error.code).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');
  });

  it('a TOTP code used once is refused on the next challenge (D4 replay)', async () => {
    const h = harness();
    const p = await provision(h);
    const code = totpNow(h, p);
    const one = await challengeOf(await passwordPortal(h, p));
    expect((await finishPortal(h, { challengeToken: one.challengeToken, code })).status).toBe(201);
    const two = await challengeOf(await passwordPortal(h, p));
    expect((await read(await finishPortal(h, { challengeToken: two.challengeToken, code }))).error.code).toBe('TWO_FACTOR_CODE_WRONG');
  });

  it('expires after ten minutes', async () => {
    const h = harness();
    const p = await provision(h);
    const { challengeToken } = await challengeOf(await passwordPortal(h, p));
    h.advance(10 * 60 + 1);
    expect((await read(await finishPortal(h, { challengeToken, code: totpNow(h, p) }))).error.code).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');
  });

  it('only issueSession’s callers in sign-in.ts mint a session (D14)', () => {
    expect('issueSession' in signInModule).toBe(false);
    expect(typeof signInModule.beginOrIssue).toBe('function');
    expect(typeof signInModule.finishTwoFactor).toBe('function');
  });
});

describe('parallel requests can’t race the second step (MUT-710 D3, review 2)', () => {
  it('eight parallel wrong codes: at most four are judged wrong, the rest meet the lock, and it is audited once', async () => {
    const h = harness();
    const p = await provision(h);
    const { challengeToken } = await challengeOf(await passwordPortal(h, p));
    const wrong = wrongFor(totpNow(h, p));
    const answers = await Promise.all(Array.from({ length: 8 }, async () => (await read(await finishPortal(h, { challengeToken, code: wrong }))).error.code));
    expect(answers.filter((code) => code === 'TWO_FACTOR_CODE_WRONG').length).toBeLessThanOrEqual(4);
    expect(answers.filter((code) => code === 'RATE_LIMITED').length).toBeGreaterThanOrEqual(4);
    expect(answers).not.toContain(undefined);

    // Locked across challenges: the right code on a fresh one waits.
    const fresh = await challengeOf(await passwordPortal(h, p));
    const locked = await finishPortal(h, { challengeToken: fresh.challengeToken, code: totpNow(h, p) });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    const events = await signedInEvents(h, p);
    expect(events.filter((e) => e.action === 'user.locked_out' && (e.metadata as Loose).method === 'two_factor')).toHaveLength(1);

    h.advance(15 * 60 + 1);
    const after = await challengeOf(await passwordPortal(h, p));
    expect((await finishPortal(h, { challengeToken: after.challengeToken, code: totpNow(h, p) })).status).toBe(201);
  });

  it('five wrong codes across challenges lock the second step (the person’s own count, not the challenge’s)', async () => {
    const h = harness();
    const p = await provision(h);
    for (let i = 0; i < 4; i += 1) {
      const { challengeToken } = await challengeOf(await passwordPortal(h, p));
      expect((await read(await finishPortal(h, { challengeToken, code: wrongFor(totpNow(h, p)) }))).error.code).toBe('TWO_FACTOR_CODE_WRONG');
    }
    const { challengeToken } = await challengeOf(await passwordPortal(h, p));
    expect((await finishPortal(h, { challengeToken, code: wrongFor(totpNow(h, p)) })).status).toBe(429);
  });

  it('the same right code sent five times at once signs in exactly once', async () => {
    const h = harness();
    const p = await provision(h);
    const { challengeToken } = await challengeOf(await passwordPortal(h, p));
    const code = totpNow(h, p);
    const statuses = await Promise.all(Array.from({ length: 5 }, async () => (await finishPortal(h, { challengeToken, code })).status));
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
  });

  it('one recovery code on two challenges at once signs in once', async () => {
    const h = harness();
    const p = await provision(h);
    const a = await challengeOf(await passwordPortal(h, p));
    const b = await challengeOf(await passwordApp(h, p));
    const [one, two] = await Promise.all([
      finishPortal(h, { challengeToken: a.challengeToken, recoveryCode: p.recoveryCodes[0] }),
      finishApp(h, { challengeToken: b.challengeToken, recoveryCode: p.recoveryCodes[0] }),
    ]);
    expect([one.status, two.status].filter((s) => s === 201)).toHaveLength(1);
  });
});

describe('recovery codes (MUT-710 D9)', () => {
  it('a recovery code works once in place of the code, typed loosely, and is audited with the codes left', async () => {
    const h = harness();
    const p = await provision(h);
    const typed = p.recoveryCodes[2]!.toUpperCase().replace('-', ' ');
    const one = await challengeOf(await passwordPortal(h, p));
    expect((await finishPortal(h, { challengeToken: one.challengeToken, recoveryCode: typed })).status).toBe(201);
    expect(await h.store.twoFactor.recoveryCodesLeft(p.id)).toBe(9);
    const events = await signedInEvents(h, p);
    expect(events.find((e) => e.action === 'user.two_factor_recovery_code_used')?.metadata).toMatchObject({ codesLeft: 9 });
    expect(events.find((e) => e.action === 'user.signed_in')?.metadata).toMatchObject({ twoFactor: 'recovery_code' });

    const two = await challengeOf(await passwordPortal(h, p));
    expect((await read(await finishPortal(h, { challengeToken: two.challengeToken, recoveryCode: typed }))).error.code).toBe('TWO_FACTOR_CODE_WRONG');
  });
});

describe('the email method (MUT-710 D5, D6)', () => {
  it('mails a code with the challenge, finishes with it; a resend waits 30 seconds and replaces the code', async () => {
    const h = harness();
    const p = await provision(h, 'email');
    const details = await challengeOf(await passwordPortal(h, p));
    expect(details).toMatchObject({ method: 'email', emailHint: expect.stringMatching(/^t•••@studio\.example$/) });
    const first = lastCode(h, p.email);
    expect(h.outbox.list({ to: p.email })[0]?.template).toBe('two-factor-code');

    const tooSoon = await h.app.request('/v1/two-factor/email-code', json({ challengeToken: details.challengeToken }, SAME_ORIGIN));
    expect(tooSoon.status).toBe(429);
    h.advance(31);
    expect((await h.app.request('/v1/two-factor/email-code', json({ challengeToken: details.challengeToken }))).status).toBe(202);
    const second = lastCode(h, p.email);
    if (second !== first) expect((await read(await finishPortal(h, { challengeToken: details.challengeToken, code: first }))).error.code).toBe('TWO_FACTOR_CODE_WRONG');
    expect((await finishPortal(h, { challengeToken: details.challengeToken, code: second })).status).toBe(201);
  });

  it('an emailed sign-in code is refused as a first step with the email method, and asks for the app’s code with the TOTP one', async () => {
    const h = harness();
    const byEmail = await provision(h, 'email');
    await h.app.request('/v1/device-sign-in-codes', json({ email: byEmail.email, locale: 'en' }));
    const refused = await h.app.request('/v1/device-sessions/code', json({ email: byEmail.email, code: lastCode(h, byEmail.email) }));
    expect((await read(refused)).error.code).toBe('TWO_FACTOR_USE_PASSWORD');

    const byApp = await provision(h, 'totp');
    await h.app.request('/v1/device-sign-in-codes', json({ email: byApp.email, locale: 'en' }));
    const asked = await challengeOf(await h.app.request('/v1/device-sessions/code', json({ email: byApp.email, code: lastCode(h, byApp.email) })));
    expect((await finishApp(h, { challengeToken: asked.challengeToken, code: totpNow(h, byApp) })).status).toBe(201);
    expect((await signedInEvents(h, byApp)).find((e) => e.action === 'user.signed_in')?.metadata).toMatchObject({ method: 'email-code', twoFactor: 'totp' });
  });
});

describe('the first step no longer clears the lockout with two-step on (MUT-710 D3, review 1)', () => {
  it('password, wrong passwords, password again: the count keeps going', async () => {
    const h = harness();
    const p = await provision(h);
    for (let i = 0; i < 4; i += 1) expect((await passwordPortal(h, p, 'wrong-password-123')).status).toBe(401);
    await challengeOf(await passwordPortal(h, p));
    expect((await passwordPortal(h, p, 'wrong-password-123')).status).toBe(401);
    expect((await passwordPortal(h, p)).status).toBe(401);
  });
});

describe('every person setup link asks for the second step (MUT-710 D11, review 4)', () => {
  const operatorLink = async (h: Harness, p: Person, lock: boolean) => {
    const res = await h.app.request(`/admin/v1/users/${p.id}/setup-link`, json({ lock }, ADMIN));
    expect(res.status).toBe(200);
    return setupTokenOf(((await res.json()) as Loose).setupLink.url);
  };
  const redeem = (h: Harness, token: string, extra: Record<string, unknown> = {}) =>
    h.app.request('/v1/account-setup', json({ token, password: 'a-brand-new-password-1', acceptedTermsVersion: CURRENT_TERMS.version, ...extra }, SAME_ORIGIN));

  for (const lock of [false, true]) {
    it(`an operator link${lock ? ' after --lock (a SETUP link)' : ''} can't set the password without the second step`, async () => {
      const h = harness();
      const p = await provision(h);
      // After --lock nulls the password, the operator's next link is a SETUP link (review 4).
      const token = lock ? (await operatorLink(h, p, true), await operatorLink(h, p, false)) : await operatorLink(h, p, false);
      const check = await read(await h.app.request('/v1/account-setup/check', json({ token }, SAME_ORIGIN)));
      expect(check).toMatchObject({ state: 'valid', twoFactor: { method: 'totp' } });
      if (lock) expect(check.purpose).toBe('SETUP');

      // Without it: refused with a challenge for this link, and the link still works.
      const asked = await challengeOf(await redeem(h, token));
      expect((await read(await redeem(h, token, { challengeToken: asked.challengeToken, code: wrongFor(totpNow(h, p)) }))).error.code).toBe('TWO_FACTOR_CODE_WRONG');
      expect((await redeem(h, token, { challengeToken: asked.challengeToken, code: totpNow(h, p) })).status).toBe(200);
      expect((await h.app.request('/v1/sessions', json({ email: p.email, password: 'a-brand-new-password-1' }, SAME_ORIGIN))).status).toBe(403);
    });
  }

  it('a sign-in challenge, or one for another link, can’t redeem a link', async () => {
    const h = harness();
    const p = await provision(h);
    const signIn = await challengeOf(await passwordPortal(h, p));
    const token = await operatorLink(h, p, false);
    expect((await read(await redeem(h, token, { challengeToken: signIn.challengeToken, code: totpNow(h, p) }))).error.code).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');

    const started = await h.app.request('/v1/account-setup/two-factor', json({ token }, SAME_ORIGIN));
    expect(started.status).toBe(201);
    const forOld = (await read(started)).challengeToken;
    const newer = await operatorLink(h, p, false);
    expect((await read(await redeem(h, newer, { challengeToken: forOld, code: totpNow(h, p) }))).error.code).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');
  });

  it('a person without it redeems as before, and /check says so', async () => {
    const h = harness();
    const p = await provision(h, null);
    const token = await operatorLink(h, p, true);
    expect((await read(await h.app.request('/v1/account-setup/check', json({ token }, SAME_ORIGIN)))).twoFactor).toBeNull();
    expect((await redeem(h, token)).status).toBe(200);
    expect((await read(await h.app.request('/v1/account-setup/two-factor', json({ token: await operatorLink(h, p, false) }, SAME_ORIGIN)))).error.details.reason).toBe('TWO_FACTOR_OFF');
  });

  it('the email method mails its code only on the explicit start, never on /check', async () => {
    const h = harness();
    const p = await provision(h, 'email');
    const token = await operatorLink(h, p, false);
    h.outbox.clear();
    await h.app.request('/v1/account-setup/check', json({ token }, SAME_ORIGIN));
    expect(h.outbox.list({ to: p.email })).toHaveLength(0);
    const started = await read(await h.app.request('/v1/account-setup/two-factor', json({ token }, SAME_ORIGIN)));
    expect(started.method).toBe('email');
    expect((await redeem(h, token, { challengeToken: started.challengeToken, code: lastCode(h, p.email) })).status).toBe(200);
  });
});
