import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { TurnstileVerifier } from '../auth/turnstile.js';
import { webauthnConfigOf } from '../auth/webauthn.js';
import { createMailer } from '../email/mailer.js';
import { createReviewDigest } from '../email/review-digest.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { CURRENT_TERMS } from '../legal.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { OPERATOR_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/operator.js';
import { provisionUser, setupTokenOf } from './helpers/provision.js';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';

/**
 * MUT-459 (ADR-208): the operator console's server half, end to end through the real app, the real @simplewebauthn
 * checks (soft authenticator) and the memory store: the operator mark (CLI only, needs a passkey), the /v1/operator
 * gate (404 for a signed-in non-operator, 401 signed out), the passkey-only step-up on every write, and the signup
 * review actions answering exactly what the admin routes answer, with the operator's identity in the audit.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const PORTAL = 'http://localhost';
const SAME_ORIGIN = { origin: PORTAL };
const PASSWORD = 'a brand new long passphrase';
const COOKIE = 'mut_session';
const OK_ONLY: TurnstileVerifier = { mode: 'test', verify: async (token) => token === 'ok' };
const generous = () => new SlidingWindowRateLimiter(1000);
const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

function harness(options: { billingGate?: boolean; webauthn?: boolean } = {}) {
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
type Harness = ReturnType<typeof harness>;

const minutes = (h: Harness, n: number) => {
  h.clock.now = new Date(h.clock.now.getTime() + n * 60_000);
};
const cookieOf = (res: Response) => new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
const withSession = (token: string, extra: Record<string, string> = SAME_ORIGIN) => ({ cookie: `${COOKIE}=${token}`, ...extra });
const get = (h: Harness, path: string, token?: string) => h.app.request(path, { headers: token ? withSession(token) : {} });
const post = (h: Harness, path: string, token: string | undefined, body: unknown = {}, headers: Record<string, string> = SAME_ORIGIN) =>
  h.app.request(path, json(body, token ? { ...headers, cookie: `${COOKIE}=${token}` } : headers));

async function person(h: Harness) {
  const email = `basel${++seq}@studio.example`;
  const created = await provisionUser(h.app, { email, displayName: 'Basel Sader', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  return { id: created.user.id as string, email, password: created.password as string };
}

async function passwordSignIn(h: Harness, email: string, password: string) {
  const res = await h.app.request('/v1/sessions', json({ email, password }, SAME_ORIGIN));
  expect(res.status).toBe(201);
  return cookieOf(res);
}

async function addPasskey(h: Harness, token: string, auth = new SoftAuthenticator()) {
  const { challengeId, publicKey } = await read(await post(h, '/v1/passkeys/creation-options', token));
  const res = await post(h, '/v1/passkeys', token, { challengeId, response: auth.create(publicKey, PORTAL) });
  expect(res.status).toBe(201);
  return auth;
}

async function passkeySignIn(h: Harness, auth: SoftAuthenticator) {
  const { challengeId, publicKey } = await read(await h.app.request('/v1/passkey-challenges', { method: 'POST' }));
  const res = await h.app.request('/v1/sessions/passkey', json({ challengeId, response: auth.assert(publicKey, PORTAL) }, SAME_ORIGIN));
  expect(res.status).toBe(201);
  return cookieOf(res);
}

const grantOperator = (h: Harness, userId: string) => h.app.request(`/admin/v1/users/${userId}/operator`, { method: 'PUT', headers: ADMIN });
const revokeOperator = (h: Harness, userId: string) => h.app.request(`/admin/v1/users/${userId}/operator`, { method: 'DELETE', headers: ADMIN });

/** An operator with a passkey, freshly signed in with it (the step-up window is open). */
async function operator(h: Harness, authenticator = new SoftAuthenticator()) {
  const p = await person(h);
  const password = await passwordSignIn(h, p.email, p.password);
  const auth = await addPasskey(h, password, authenticator);
  expect((await grantOperator(h, p.id)).status).toBe(200);
  const token = await passkeySignIn(h, auth);
  return { ...p, auth, token, passwordToken: password };
}

/** A self-service signup that waits for review (gmail.com, the fixture domain checker). */
async function pendingSignup(h: Harness) {
  const email = `waiting${++seq}@gmail.com`;
  expect((await h.app.request('/v1/signups', json({ email, locale: 'en', turnstileToken: 'ok' }, SAME_ORIGIN))).status).toBe(202);
  const link = h.outbox.list({ to: email }).at(-1)?.text.match(/http:\/\/localhost\/setup#[A-Za-z0-9_-]{43}/)?.[0];
  const redeem = await h.app.request('/v1/account-setup', json({ token: setupTokenOf(link!), password: PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, SAME_ORIGIN));
  expect(redeem.status).toBe(200);
  const user = (await h.store.users.findByEmail(email))!;
  return { email, userId: user.id };
}

async function stepUp(h: Harness, token: string, auth: SoftAuthenticator) {
  const optionsRes = await post(h, '/v1/operator/step-up/options', token);
  expect(optionsRes.status).toBe(200);
  const { challengeId, publicKey } = await read(optionsRes);
  return post(h, '/v1/operator/step-up', token, { challengeId, response: auth.assert(publicKey, PORTAL) });
}

describe('MUT-459 operator mark (admin token / CLI only)', () => {
  it('grants only to an ACTIVE person with a passkey, audits it, and shows operator on /v1/me', async () => {
    const h = harness();
    const p = await person(h);
    const res = await grantOperator(h, p.id);
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'OPERATOR_NEEDS_PASSKEY' } });

    const token = await passwordSignIn(h, p.email, p.password);
    expect((await read(await get(h, '/v1/me', token))).user.operator).toBeUndefined();
    await addPasskey(h, token);
    const granted = await grantOperator(h, p.id);
    expect(granted.status).toBe(200);
    expect(await read(granted)).toMatchObject({ userId: p.id, operator: true });
    expect((await read(await get(h, '/v1/me', token))).user.operator).toBe(true);

    const personal = (await h.store.memberships.listByUser(p.id))[0]!.organizationId;
    const audit = (await h.store.audit.list(personal, {}, { limit: 50, cursor: null })).items.filter((e) => e.action.startsWith('user.operator_'));
    expect(audit.map((e) => [e.action, e.actorType, e.actorId])).toEqual([['user.operator_granted', 'ADMIN', null]]);
  });

  it('refuses a pending-review person (409 CONFLICT USER_PENDING_REVIEW) and an unknown one (404)', async () => {
    const h = harness();
    const { userId } = await pendingSignup(h);
    expect((await read(await grantOperator(h, userId))).error.details).toMatchObject({ reason: 'USER_PENDING_REVIEW' });
    expect((await grantOperator(h, '00000000-0000-4000-8000-000000000459')).status).toBe(404);
  });

  it('revoking takes effect on the very next operator request', async () => {
    const h = harness();
    const op = await operator(h);
    expect((await get(h, '/v1/operator/signup-reviews', op.token)).status).toBe(200);
    const revoked = await revokeOperator(h, op.id);
    expect(await read(revoked)).toMatchObject({ operator: false });
    expect((await get(h, '/v1/operator/signup-reviews', op.token)).status).toBe(404);
    expect((await read(await get(h, '/v1/me', op.token))).user.operator).toBeUndefined();
  });

  it('refuses a disabled person (409 USER_DISABLED) and leaves no mark', async () => {
    const h = harness();
    const p = await person(h);
    await addPasskey(h, await passwordSignIn(h, p.email, p.password));
    expect((await h.app.request(`/admin/v1/users/${p.id}/disable`, { method: 'POST', headers: ADMIN })).status).toBe(200);
    expect((await read(await grantOperator(h, p.id))).error.details).toMatchObject({ reason: 'USER_DISABLED' });
    expect((await h.store.users.getById(p.id))!.operatorAt).toBeNull();
  });

  it('revoke works on a disabled operator (audited), is a no-op on a pending signup, and 404s an unknown person', async () => {
    const h = harness();
    const op = await operator(h);
    await h.app.request(`/admin/v1/users/${op.id}/disable`, { method: 'POST', headers: ADMIN });
    expect(await read(await revokeOperator(h, op.id))).toMatchObject({ operator: false, changed: true });
    const personal = (await h.store.memberships.listByUser(op.id))[0]!.organizationId;
    expect((await h.store.audit.list(personal, {}, { limit: 50, cursor: null })).items.filter((e) => e.action === 'user.operator_revoked')).toHaveLength(1);

    const { userId } = await pendingSignup(h);
    expect(await read(await revokeOperator(h, userId))).toMatchObject({ operator: false, changed: false });
    expect((await revokeOperator(h, UNKNOWN)).status).toBe(404);
  });

  it('needs the admin token', async () => {
    const h = harness();
    const p = await person(h);
    expect((await h.app.request(`/admin/v1/users/${p.id}/operator`, { method: 'PUT' })).status).toBe(401);
  });
});

const UNKNOWN = '00000000-0000-4000-8000-000000000001';
/** Every operator route, from the inventory the app mounts (a new route joins every sweep below on its own). */
const ROUTES: Array<[string, string]> = [...OPERATOR_ORGANIZATION_INDEPENDENT_ROUTES].map((key) => {
  const [method, path] = key.split(' ') as [string, string];
  return [method, path.replace(':userId', UNKNOWN)];
});
const requestOn = (h: Harness, [method, path]: [string, string], headers: Record<string, string>) =>
  h.app.request(path, method === 'GET' ? { headers } : json({}, headers));

describe('MUT-459 the /v1/operator gate', () => {

  it('answers 404 to a signed-in non-operator on every operator route, and 401 signed out', async () => {
    const h = harness();
    const p = await person(h);
    const token = await passwordSignIn(h, p.email, p.password);
    for (const [method, path] of ROUTES) {
      const signedIn = await h.app.request(path, method === 'GET' ? { headers: withSession(token) } : json({}, withSession(token)));
      expect([method, path, signedIn.status]).toEqual([method, path, 404]);
      const signedOut = await h.app.request(path, method === 'GET' ? {} : json({}, SAME_ORIGIN));
      expect([method, path, signedOut.status]).toEqual([method, path, 401]);
    }
  });

  it('lets a lapsed operator in (the lapse gate is open here, D2) while their own inbox stays locked', async () => {
    const h = harness({ billingGate: true });
    const op = await operator(h);
    await h.store.billing.setTrialStart(op.id, new Date(h.clock.now.getTime() - 31 * 24 * 60 * 60_000));
    expect((await read(await get(h, '/v1/inbox', op.token))).error.code).toBe('SUBSCRIPTION_LAPSED');
    expect((await get(h, '/v1/operator/signup-reviews', op.token)).status).toBe(200);
  });

  it('answers 404 to the operator\'s own phone token on every route: the console is the portal cookie only', async () => {
    const h = harness();
    const op = await operator(h);
    const device = await read(await h.app.request('/v1/device-sessions', json({ email: op.email, password: op.password })));
    for (const route of ROUTES) {
      const res = await requestOn(h, route, { authorization: `Bearer ${device.token}` });
      expect([...route, res.status]).toEqual([...route, 404]);
    }
    const { challengeId, publicKey } = await read(await h.app.request('/v1/passkey-challenges', { method: 'POST' }));
    const passkeyDevice = await read(await h.app.request('/v1/device-sessions/passkey', json({ challengeId, response: op.auth.assert(publicKey, PORTAL) })));
    expect((await get(h, '/v1/operator/signup-reviews')).status).toBe(401);
    expect((await h.app.request('/v1/operator/signup-reviews', { headers: { authorization: `Bearer ${passkeyDevice.token}` } })).status).toBe(404);
  });

  it('answers 404 on both step-up routes where the server offers no passkeys', async () => {
    const h = harness({ webauthn: false });
    const p = await person(h);
    await h.store.users.setOperator({ userId: p.id, operator: true, at: h.clock.now, audit: [] });
    const token = await passwordSignIn(h, p.email, p.password);
    expect((await post(h, '/v1/operator/step-up/options', token)).status).toBe(404);
    expect((await post(h, '/v1/operator/step-up', token, { challengeId: UNKNOWN, response: { id: 'x', rawId: 'x', type: 'public-key', response: { clientDataJSON: 'x', authenticatorData: 'x', signature: 'x' }, clientExtensionResults: {} } })).status).toBe(404);
  });

  it('refuses a cross-site write from an operator (403), as every session write', async () => {
    const h = harness();
    const op = await operator(h);
    const { userId } = await pendingSignup(h);
    const res = await post(h, `/v1/operator/signup-reviews/${userId}/approve`, op.token, {}, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('CROSS_SITE_REQUEST');
  });
});

describe('MUT-459 passkey-only step-up (D7)', () => {
  it('a password change does not reopen the window of a session opened with a passkey (review finding 1)', async () => {
    const h = harness();
    const op = await operator(h);
    minutes(h, 11);
    const changed = await post(h, '/v1/me/password', op.token, { currentPassword: op.password, newPassword: 'another long passphrase entirely' });
    expect(changed.status).toBe(204);
    const rotated = cookieOf(changed) || op.token;
    const { userId } = await pendingSignup(h);
    const res = await post(h, `/v1/operator/signup-reviews/${userId}/approve`, rotated);
    expect(res.status).toBe(403);
    expect((await read(res)).error).toMatchObject({ code: 'RECENT_SIGN_IN_REQUIRED', details: { method: 'passkey' } });
  });

  it('an operator adds a passkey only after a passkey step-up, never on a fresh password alone (review finding 2)', async () => {
    const h = harness();
    const op = await operator(h);
    const passwordOnly = await passwordSignIn(h, op.email, op.password);
    const refused = await post(h, '/v1/passkeys/creation-options', passwordOnly);
    expect(refused.status).toBe(403);
    expect((await read(refused)).error).toMatchObject({ code: 'RECENT_SIGN_IN_REQUIRED', details: { method: 'passkey' } });
    expect((await post(h, '/v1/passkeys/creation-options', passwordOnly, { currentPassword: op.password })).status).toBe(403);

    expect((await stepUp(h, passwordOnly, op.auth)).status).toBe(200);
    expect((await post(h, '/v1/passkeys/creation-options', passwordOnly)).status).toBe(200);
  });

  it('an operator removes or renames a passkey only after a passkey step-up, and never the last one (re-review A)', async () => {
    const h = harness();
    const op = await operator(h);
    const passwordOnly = await passwordSignIn(h, op.email, op.password);
    const [first] = await h.store.passkeys.listByUser(op.id);
    const del = (token: string, id: string) => h.app.request(`/v1/passkeys/${id}`, { method: 'DELETE', headers: withSession(token) });
    const refused = await del(passwordOnly, first!.id);
    expect(refused.status).toBe(403);
    expect((await read(refused)).error).toMatchObject({ code: 'RECENT_SIGN_IN_REQUIRED', details: { method: 'passkey' } });
    const rename = await h.app.request(`/v1/passkeys/${first!.id}`, json({ name: 'Renamed' }, withSession(passwordOnly), 'PATCH'));
    expect(rename.status).toBe(403);
    expect(await h.store.passkeys.listByUser(op.id)).toHaveLength(1);

    const last = await del(op.token, first!.id);
    expect(last.status).toBe(409);
    expect((await read(last)).error.details).toMatchObject({ reason: 'OPERATOR_NEEDS_PASSKEY' });

    await addPasskey(h, op.token);
    expect((await del(op.token, first!.id)).status).toBe(204);
    expect(await h.store.passkeys.listByUser(op.id)).toHaveLength(1);
  });

  it('two removals at once never leave an operator with no passkey (re-review cycle 3)', async () => {
    const h = harness();
    const op = await operator(h);
    await addPasskey(h, op.token);
    const [a, b] = await h.store.passkeys.listByUser(op.id);
    const del = (id: string) => h.app.request(`/v1/passkeys/${id}`, { method: 'DELETE', headers: withSession(op.token) });
    const statuses = (await Promise.all([del(a!.id), del(b!.id)])).map((r) => r.status).sort();
    expect(statuses).toEqual([204, 409]);
    expect(await h.store.passkeys.listByUser(op.id)).toHaveLength(1);
  });

  it('an operator cannot start closing their account, even with the password (re-review cycle 3)', async () => {
    const h = harness();
    const op = await operator(h);
    const res = await post(h, '/v1/me/closure', op.token, { password: op.password });
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'OPERATOR_ACCOUNT' });
    expect((await h.store.users.getById(op.id))!.closure).toBeNull();
  });

  it('a non-operator still adds a passkey on a fresh password sign-in, as before', async () => {
    const h = harness();
    const p = await person(h);
    await addPasskey(h, await passwordSignIn(h, p.email, p.password));
  });

  it('the window closes at exactly 10 minutes', async () => {
    const h = harness();
    const op = await operator(h);
    const first = await pendingSignup(h);
    const second = await pendingSignup(h);
    h.clock.now = new Date(h.clock.now.getTime() + 10 * 60_000 - 1_000);
    expect((await post(h, `/v1/operator/signup-reviews/${first.userId}/approve`, op.token)).status).toBe(200);
    h.clock.now = new Date(h.clock.now.getTime() + 1_000);
    expect((await post(h, `/v1/operator/signup-reviews/${second.userId}/approve`, op.token)).status).toBe(403);
  });

  it('a step-up goes stale 10 minutes after it, and the list then says null', async () => {
    const h = harness();
    const op = await operator(h);
    const passwordOnly = await passwordSignIn(h, op.email, op.password);
    expect((await stepUp(h, passwordOnly, op.auth)).status).toBe(200);
    minutes(h, 11);
    expect((await read(await get(h, '/v1/operator/signup-reviews', passwordOnly))).stepUpUntil).toBeNull();
    const { userId } = await pendingSignup(h);
    expect((await post(h, `/v1/operator/signup-reviews/${userId}/approve`, passwordOnly)).status).toBe(403);
  });

  it('options answer 409 OPERATOR_NEEDS_PASSKEY once the last passkey is gone', async () => {
    const h = harness();
    const op = await operator(h);
    const [passkey] = await h.store.passkeys.listByUser(op.id);
    // An operator can't drop their last passkey (re-review A): the CLI takes the mark off first, as recovery does.
    await revokeOperator(h, op.id);
    expect((await h.app.request(`/v1/passkeys/${passkey!.id}`, { method: 'DELETE', headers: withSession(op.token) })).status).toBe(204);
    await h.store.users.setOperator({ userId: op.id, operator: true, at: h.clock.now, audit: [] });
    const res = await post(h, '/v1/operator/step-up/options', op.token);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'OPERATOR_NEEDS_PASSKEY' });
  });

  it('an expired step-up challenge is refused', async () => {
    const h = harness();
    const op = await operator(h);
    const { challengeId, publicKey } = await read(await post(h, '/v1/operator/step-up/options', op.token));
    minutes(h, 6);
    const res = await post(h, '/v1/operator/step-up', op.token, { challengeId, response: op.auth.assert(publicKey, PORTAL) });
    expect((await read(res)).error.code).toBe('PASSKEY_NOT_ACCEPTED');
  });

  it('audits a step-up, and a cloned passkey (counter back) on the step-up as at sign-in (review finding 5)', async () => {
    const h = harness();
    const op = await operator(h, new SoftAuthenticator({ counts: true }));
    const personal = (await h.store.memberships.listByUser(op.id))[0]!.organizationId;
    const actions = async () => (await h.store.audit.list(personal, {}, { limit: 100, cursor: null })).items.map((e) => e.action);
    expect((await stepUp(h, op.token, op.auth)).status).toBe(200);
    expect(await actions()).toContain('user.operator_stepped_up');
    const stepped = (await h.store.audit.list(personal, {}, { limit: 100, cursor: null })).items.find((e) => e.action === 'user.operator_stepped_up');
    expect(stepped).toMatchObject({ actorType: 'USER', actorId: op.id });

    const { challengeId, publicKey } = await read(await post(h, '/v1/operator/step-up/options', op.token));
    const cloned = await post(h, '/v1/operator/step-up', op.token, { challengeId, response: op.auth.assert(publicKey, PORTAL, { counter: 1 }) });
    expect((await read(cloned)).error.code).toBe('PASSKEY_NOT_ACCEPTED');
    expect(await actions()).toContain('user.passkey_counter_regressed');
  });

  it('a fresh passkey sign-in acts at once; the list says until when', async () => {
    const h = harness();
    const op = await operator(h);
    const list = await read(await get(h, '/v1/operator/signup-reviews', op.token));
    expect(list.stepUpUntil).toBe(new Date(h.clock.now.getTime() + 10 * 60_000).toISOString());
    const { userId } = await pendingSignup(h);
    expect((await post(h, `/v1/operator/signup-reviews/${userId}/approve`, op.token)).status).toBe(200);
  });

  it('a fresh PASSWORD sign-in never passes: the write asks for a passkey', async () => {
    const h = harness();
    const op = await operator(h);
    const passwordOnly = await passwordSignIn(h, op.email, op.password);
    expect((await read(await get(h, '/v1/operator/signup-reviews', passwordOnly))).stepUpUntil).toBeNull();
    const { userId } = await pendingSignup(h);
    const res = await post(h, `/v1/operator/signup-reviews/${userId}/approve`, passwordOnly);
    expect(res.status).toBe(403);
    expect((await read(res)).error).toMatchObject({ code: 'RECENT_SIGN_IN_REQUIRED', details: { method: 'passkey', windowMinutes: 10 } });
  });

  it('after 10 minutes a passkey session asks again; a passkey step-up reopens the window without moving credentialsVerifiedAt', async () => {
    const h = harness();
    const op = await operator(h);
    const { userId } = await pendingSignup(h);
    minutes(h, 11);
    expect((await post(h, `/v1/operator/signup-reviews/${userId}/approve`, op.token)).status).toBe(403);

    const stepped = await stepUp(h, op.token, op.auth);
    expect(stepped.status).toBe(200);
    expect(await read(stepped)).toEqual({ stepUpUntil: new Date(h.clock.now.getTime() + 10 * 60_000).toISOString() });
    const session = [...(h.store as Loose).sessionsById.values()].find((s: Loose) => s.stepUpAt);
    expect(session.credentialsVerifiedAt.getTime()).toBeLessThan(session.stepUpAt.getTime());
    expect((await post(h, `/v1/operator/signup-reviews/${userId}/approve`, op.token)).status).toBe(200);
  });

  it('a password session can step up with the operator passkey', async () => {
    const h = harness();
    const op = await operator(h);
    const passwordOnly = await passwordSignIn(h, op.email, op.password);
    expect((await stepUp(h, passwordOnly, op.auth)).status).toBe(200);
    const { userId } = await pendingSignup(h);
    expect((await post(h, `/v1/operator/signup-reviews/${userId}/approve`, passwordOnly)).status).toBe(200);
  });

  it('refuses a stranger passkey, a sign-in challenge and a reused challenge (403 PASSKEY_NOT_ACCEPTED)', async () => {
    const h = harness();
    const op = await operator(h);
    const other = await person(h);
    const stranger = await addPasskey(h, await passwordSignIn(h, other.email, other.password));
    minutes(h, 11);
    const { challengeId, publicKey } = await read(await post(h, '/v1/operator/step-up/options', op.token));
    expect(publicKey.allowCredentials).toHaveLength(1);
    const foreign = await post(h, '/v1/operator/step-up', op.token, { challengeId, response: stranger.assert(publicKey, PORTAL) });
    expect(foreign.status).toBe(403);
    expect((await read(foreign)).error.code).toBe('PASSKEY_NOT_ACCEPTED');

    const signIn = await read(await h.app.request('/v1/passkey-challenges', { method: 'POST' }));
    expect((await post(h, '/v1/operator/step-up', op.token, { challengeId: signIn.challengeId, response: op.auth.assert(signIn.publicKey, PORTAL) })).status).toBe(403);

    const fresh = await read(await post(h, '/v1/operator/step-up/options', op.token));
    const response = op.auth.assert(fresh.publicKey, PORTAL);
    expect((await post(h, '/v1/operator/step-up', op.token, { challengeId: fresh.challengeId, response })).status).toBe(200);
    expect((await post(h, '/v1/operator/step-up', op.token, { challengeId: fresh.challengeId, response })).status).toBe(403);
  });
});

describe('MUT-459 signup reviews from the operator console', () => {
  it('lists the waiting signups like the admin route, plus the step-up window', async () => {
    const h = harness();
    const op = await operator(h);
    await pendingSignup(h);
    const operatorList = await read(await get(h, '/v1/operator/signup-reviews', op.token));
    const adminList = await read(await h.app.request('/admin/v1/signup-reviews?state=pending', { headers: ADMIN }));
    expect(operatorList.data).toEqual(adminList.data);
    expect(operatorList.nextCursor).toEqual(adminList.nextCursor);
  });

  it('approve opens the account and mails it, recording the operator as decider and audit actor', async () => {
    const h = harness();
    const op = await operator(h);
    const { email, userId } = await pendingSignup(h);
    const res = await post(h, `/v1/operator/signup-reviews/${userId}/approve`, op.token);
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ review: { userId, email, decision: 'APPROVED' }, mail: 'sent' });
    expect((await h.store.users.getById(userId))!.status).toBe('ACTIVE');
    expect((await h.store.signupReviews.findByUser(userId))!.decidedBy).toBe(`operator:${op.id}`);
    expect(h.outbox.list({ to: email }).map((m) => m.template).at(-1)).toBe('account-ready');
    const personal = (await h.store.memberships.listByUser(userId))[0]!.organizationId;
    const audit = (await h.store.audit.list(personal, {}, { limit: 50, cursor: null })).items.find((e) => e.action === 'user.signup_approved');
    expect(audit).toMatchObject({ actorType: 'ADMIN', actorId: op.id });
  });

  it('decline deletes the empty account and mails it; a second decision is 409 ALREADY_DECIDED', async () => {
    const h = harness();
    const op = await operator(h);
    const { email, userId } = await pendingSignup(h);
    const res = await post(h, `/v1/operator/signup-reviews/${userId}/decline`, op.token);
    expect(await read(res)).toMatchObject({ review: { userId: null, decision: 'DECLINED' }, mail: 'sent' });
    expect(await h.store.users.getById(userId)).toBeNull();
    expect(h.outbox.list({ to: email }).map((m) => m.template).at(-1)).toBe('account-declined');

    const other = await pendingSignup(h);
    expect((await post(h, `/v1/operator/signup-reviews/${other.userId}/approve`, op.token)).status).toBe(200);
    const again = await post(h, `/v1/operator/signup-reviews/${other.userId}/decline`, op.token);
    expect(again.status).toBe(409);
    expect((await read(again)).error.details).toMatchObject({ reason: 'ALREADY_DECIDED', decision: 'APPROVED' });
  });

  it('a declined or unknown signup answers 404 to approve, decline and send again, and mails nothing', async () => {
    const h = harness();
    const op = await operator(h);
    const { email, userId } = await pendingSignup(h);
    await post(h, `/v1/operator/signup-reviews/${userId}/decline`, op.token);
    const before = h.outbox.list({ to: email }).length;
    for (const verb of ['approve', 'decline', 'resend']) {
      expect([verb, (await post(h, `/v1/operator/signup-reviews/${userId}/${verb}`, op.token)).status]).toEqual([verb, 404]);
      expect([verb, (await post(h, `/v1/operator/signup-reviews/${UNKNOWN}/${verb}`, op.token)).status]).toEqual([verb, 404]);
    }
    expect(h.outbox.list({ to: email })).toHaveLength(before);
    expect(await h.store.users.findByEmail(email)).toBeNull();
  });

  it('send again is audited, sends once per minute, and refuses an account no longer active (review finding 4)', async () => {
    const h = harness();
    const op = await operator(h);
    const { email, userId } = await pendingSignup(h);
    await post(h, `/v1/operator/signup-reviews/${userId}/approve`, op.token);
    minutes(h, 1);
    await post(h, `/v1/operator/signup-reviews/${userId}/resend`, op.token);
    await post(h, `/v1/operator/signup-reviews/${userId}/resend`, op.token);
    expect(h.outbox.list({ to: email }).filter((m) => m.template === 'account-ready')).toHaveLength(2);
    const personal = (await h.store.memberships.listByUser(userId))[0]!.organizationId;
    const resent = (await h.store.audit.list(personal, {}, { limit: 50, cursor: null })).items.filter((e) => e.action === 'user.signup_approval_mailed_again');
    expect(resent.map((e) => [e.actorType, e.actorId])).toEqual([['ADMIN', op.id], ['ADMIN', op.id]]);

    await h.app.request(`/admin/v1/users/${userId}/disable`, { method: 'POST', headers: ADMIN });
    minutes(h, 1);
    const refused = await post(h, `/v1/operator/signup-reviews/${userId}/resend`, op.token);
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'NOT_ACTIVE' });
  });

  it('send again mails an approved signup once more (a fresh send each time); a pending one is 409 NOT_APPROVED', async () => {
    const h = harness();
    const op = await operator(h);
    const { email, userId } = await pendingSignup(h);
    expect((await read(await post(h, `/v1/operator/signup-reviews/${userId}/resend`, op.token))).error.details).toMatchObject({ reason: 'NOT_APPROVED' });
    await post(h, `/v1/operator/signup-reviews/${userId}/approve`, op.token);
    minutes(h, 1);
    const again = await post(h, `/v1/operator/signup-reviews/${userId}/resend`, op.token);
    expect(again.status).toBe(200);
    expect(await read(again)).toMatchObject({ review: { email, decision: 'APPROVED' }, mail: 'sent' });
    expect(h.outbox.list({ to: email }).filter((m) => m.template === 'account-ready')).toHaveLength(2);
  });
});
