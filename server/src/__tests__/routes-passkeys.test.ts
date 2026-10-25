import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { closureDeadline } from '../accounts/closure.js';
import { isDeviceSessionToken, sessionDigest, SIGN_IN_POLICY } from '../auth/sessions.js';
import { webauthnConfigOf } from '../auth/webauthn.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';

/**
 * MUT-115 (ADR-190): passkeys end to end through the real app and the real @simplewebauthn checks, with a soft
 * authenticator. The portal's origin in these tests is http://localhost (app.request's own), the app's is
 * https://localhost: one RP ID, two origins, as production's app.placeholder.example and placeholder.example.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const PORTAL = 'http://localhost';
const APP = 'https://localhost';
const SAME_ORIGIN = { origin: PORTAL };
const COOKIE = '__Host-mut_session';
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const WEBAUTHN = webauthnConfigOf({ rpId: 'localhost', origins: `${PORTAL},${APP}` });

function harness(overrides: Partial<AppDependencies> = {}) {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-25T09:00:00Z') };
  const added: string[] = [];
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
    webauthn: WEBAUTHN,
    passkeyEvents: { added: async ({ passkey }) => void added.push(passkey.id) },
    ...overrides,
  });
  return { app, store, clock, added };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const minutes = (h: Harness, n: number) => {
  h.clock.now = new Date(h.clock.now.getTime() + n * 60_000);
};
const cookieOf = (res: Response) => new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
const withSession = (token: string, extra: Record<string, string> = SAME_ORIGIN) => ({ cookie: `${COOKIE}=${token}`, ...extra });
const withDevice = (token: string) => ({ authorization: `Bearer ${token}` });

async function person(h: Harness) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const email = `nour${++seq}@firm.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: org.id });
  return { id: created.user.id as string, email, password: created.password as string, orgId: org.id as string };
}

async function passwordSignIn(h: Harness, email: string, password: string) {
  const res = await h.app.request('/v1/sessions', json({ email, password }, SAME_ORIGIN));
  expect(res.status).toBe(201);
  return cookieOf(res);
}

/** Adds a passkey from a cookie session, the portal's way. */
async function addPasskey(h: Harness, token: string, auth = new SoftAuthenticator(), body: Record<string, unknown> = {}, origin = PORTAL) {
  const optionsRes = await h.app.request('/v1/passkeys/creation-options', json(body, withSession(token)));
  if (optionsRes.status !== 200) return { res: optionsRes, auth };
  const { challengeId, publicKey } = await read(optionsRes);
  const res = await h.app.request('/v1/passkeys', json({ challengeId, response: auth.create(publicKey, origin), ...body }, withSession(token)));
  return { res, auth };
}

async function challenge(h: Harness, headers: Record<string, string> = {}) {
  const res = await h.app.request('/v1/passkey-challenges', { method: 'POST', headers });
  expect(res.status).toBe(201);
  return (await read(res)) as { challengeId: string; publicKey: Loose };
}

async function passkeySignIn(h: Harness, auth: SoftAuthenticator, knobs: Parameters<SoftAuthenticator['assert']>[2] = {}, origin = PORTAL) {
  const { challengeId, publicKey } = await challenge(h);
  return h.app.request('/v1/sessions/passkey', json({ challengeId, response: auth.assert(publicKey, origin, knobs) }, SAME_ORIGIN));
}

async function devicePasskeySignIn(h: Harness, auth: SoftAuthenticator, origin = APP) {
  const { challengeId, publicKey } = await challenge(h);
  return h.app.request('/v1/device-sessions/passkey', json({ challengeId, response: auth.assert(publicKey, origin) }));
}

async function signedInWithPasskey(h: Harness) {
  const p = await person(h);
  const token = await passwordSignIn(h, p.email, p.password);
  const { res, auth } = await addPasskey(h, token);
  expect(res.status).toBe(201);
  return { ...p, token, auth, passkey: await read(res) };
}

describe('passkey management (MUT-115)', () => {
  it('needs a session, and answers 404 everywhere when passkeys are not configured', async () => {
    const h = harness();
    expect((await h.app.request('/v1/passkeys')).status).toBe(401);
    const off = harness({ webauthn: null });
    const p = await person(off);
    const token = await passwordSignIn(off, p.email, p.password);
    expect((await off.app.request('/v1/passkeys', { headers: withSession(token) })).status).toBe(404);
    expect((await off.app.request('/v1/passkey-challenges', { method: 'POST' })).status).toBe(404);
    expect((await off.app.request('/v1/sessions/passkey', json({ challengeId: crypto.randomUUID(), response: {} }, SAME_ORIGIN))).status).toBe(422);
  });

  it('adds a passkey right after sign-in with no password prompt, names it from its provider and lists it', async () => {
    const h = harness();
    const { token, passkey, orgId } = await signedInWithPasskey(h);
    expect(passkey).toMatchObject({ name: 'iCloud Keychain', lastUsedAt: null, deviceType: 'multiDevice', backedUp: true });
    expect(h.added).toEqual([passkey.id]);
    const list = await read(await h.app.request('/v1/passkeys', { headers: withSession(token) }));
    expect(list).toEqual({ items: [passkey], limit: 10 });
    const audit = await h.store.audit.listByOrganization(orgId, 50);
    expect(audit.find((e) => e.action === 'user.passkey_added')).toMatchObject({ actorType: 'USER', metadata: { sessionKind: 'cookie' } });
  });

  it('names a second passkey from the same provider "… 2", and an unknown provider from the browser', async () => {
    const h = harness();
    const { token } = await signedInWithPasskey(h);
    expect(await read((await addPasskey(h, token)).res)).toMatchObject({ name: 'iCloud Keychain 2' });
    const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' };
    const optionsRes = await h.app.request('/v1/passkeys/creation-options', json({}, withSession(token, { ...SAME_ORIGIN, ...ua })));
    const { challengeId, publicKey } = await read(optionsRes);
    const response = new SoftAuthenticator({ aaguid: '00000000-0000-0000-0000-000000000000' }).create(publicKey, PORTAL);
    const res = await h.app.request('/v1/passkeys', json({ challengeId, response }, withSession(token, { ...SAME_ORIGIN, ...ua })));
    expect(await read(res)).toMatchObject({ name: 'Chrome on Mac' });
  });

  it('a stale session must type the password (D4); a wrong one counts toward the lockout', async () => {
    const h = harness();
    const p = await person(h);
    const token = await passwordSignIn(h, p.email, p.password);
    minutes(h, 11);
    const stale = await addPasskey(h, token);
    expect(stale.res.status).toBe(403);
    expect((await read(stale.res)).error.code).toBe('RECENT_SIGN_IN_REQUIRED');
    const wrong = await addPasskey(h, token, new SoftAuthenticator(), { currentPassword: 'not-it' });
    expect((await read(wrong.res)).error.code).toBe('CURRENT_PASSWORD_WRONG');
    expect((await h.store.users.getById(p.id))?.failedSignIns).toBe(1);
    const right = await addPasskey(h, token, new SoftAuthenticator(), { currentPassword: p.password });
    expect(right.res.status).toBe(201);
  });

  it('checks the step-up again on add, not only on the options call', async () => {
    const h = harness();
    const p = await person(h);
    const token = await passwordSignIn(h, p.email, p.password);
    const { challengeId, publicKey } = await read(await h.app.request('/v1/passkeys/creation-options', json({}, withSession(token))));
    minutes(h, 11);
    const res = await h.app.request('/v1/passkeys', json({ challengeId, response: new SoftAuthenticator().create(publicKey, PORTAL) }, withSession(token)));
    expect((await read(res)).error.code).toBe('RECENT_SIGN_IN_REQUIRED');
  });

  it('refuses the eleventh passkey (D12)', async () => {
    const h = harness();
    const { token } = await signedInWithPasskey(h);
    for (let i = 0; i < 9; i++) expect((await addPasskey(h, token)).res.status).toBe(201);
    const eleventh = await addPasskey(h, token);
    expect(eleventh.res.status).toBe(409);
    expect((await read(eleventh.res)).error.code).toBe('PASSKEY_LIMIT');
  });

  it('refuses a creation that does not verify: replayed or another person’s challenge, a sign-in challenge, wrong origin, no UV', async () => {
    const h = harness();
    const p = await person(h);
    const token = await passwordSignIn(h, p.email, p.password);
    const q = await person(h);
    const other = await passwordSignIn(h, q.email, q.password);
    const auth = new SoftAuthenticator();
    const notVerified = async (res: Response) => {
      expect(res.status).toBe(422);
      expect((await read(res)).error.details).toEqual({ reason: 'PASSKEY_NOT_VERIFIED' });
    };

    const mine = await read(await h.app.request('/v1/passkeys/creation-options', json({}, withSession(token))));
    await notVerified(await h.app.request('/v1/passkeys', json({ challengeId: mine.challengeId, response: auth.create(mine.publicKey, PORTAL) }, withSession(other))));
    // The other person's attempt didn't consume it.
    expect((await h.app.request('/v1/passkeys', json({ challengeId: mine.challengeId, response: auth.create(mine.publicKey, PORTAL) }, withSession(token)))).status).toBe(201);
    // ...but now it is used.
    await notVerified(await h.app.request('/v1/passkeys', json({ challengeId: mine.challengeId, response: auth.create(mine.publicKey, PORTAL) }, withSession(token))));

    const signInChallenge = await challenge(h);
    const fresh = await read(await h.app.request('/v1/passkeys/creation-options', json({}, withSession(token))));
    await notVerified(await h.app.request('/v1/passkeys', json({ challengeId: signInChallenge.challengeId, response: auth.create(fresh.publicKey, PORTAL) }, withSession(token))));

    const a = await read(await h.app.request('/v1/passkeys/creation-options', json({}, withSession(token))));
    await notVerified(await h.app.request('/v1/passkeys', json({ challengeId: a.challengeId, response: auth.create(a.publicKey, 'https://evil.example') }, withSession(token))));
    const b = await read(await h.app.request('/v1/passkeys/creation-options', json({}, withSession(token))));
    await notVerified(await h.app.request('/v1/passkeys', json({ challengeId: b.challengeId, response: auth.create(b.publicKey, PORTAL, { userVerified: false }) }, withSession(token))));
    const c = await read(await h.app.request('/v1/passkeys/creation-options', json({}, withSession(token))));
    minutes(h, 6);
    await notVerified(await h.app.request('/v1/passkeys', json({ challengeId: c.challengeId, response: auth.create(c.publicKey, PORTAL) }, withSession(token, SAME_ORIGIN))));
  });

  it('renames only your own passkey; 1–64 characters', async () => {
    const h = harness();
    const { passkey, token } = await signedInWithPasskey(h);
    const q = await person(h);
    const other = await passwordSignIn(h, q.email, q.password);
    expect((await h.app.request(`/v1/passkeys/${passkey.id}`, json({ name: 'Mine' }, withSession(other), 'PATCH'))).status).toBe(404);
    expect((await h.app.request(`/v1/passkeys/${passkey.id}`, json({ name: '' }, withSession(token), 'PATCH'))).status).toBe(422);
    expect((await h.app.request(`/v1/passkeys/${passkey.id}`, json({ name: 'x'.repeat(65) }, withSession(token), 'PATCH'))).status).toBe(422);
    const renamed = await h.app.request(`/v1/passkeys/${passkey.id}`, json({ name: '  هاتف العمل ' }, withSession(token), 'PATCH'));
    expect(await read(renamed)).toMatchObject({ id: passkey.id, name: 'هاتف العمل' });
    expect((await h.app.request(`/v1/passkeys/${passkey.id}`, { method: 'DELETE', headers: withSession(other) })).status).toBe(404);
  });

  it('a closing account reaches no passkey route (MUT-333)', async () => {
    const h = harness();
    const { id, token } = await signedInWithPasskey(h);
    const session = await h.store.sessions.findByDigest(sessionDigest(PEPPER, token));
    await h.store.users.requestClosure({ userId: id, at: h.clock.now, deleteAfter: closureDeadline(h.clock.now), endedSubscriptionIds: [], exceptSessionId: session!.id, audit: [] });
    const res = await h.app.request('/v1/passkeys', { headers: withSession(token) });
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('ACCOUNT_CLOSING');
  });
});

describe('passkey sign-in (MUT-115)', () => {
  it('the portal route sets the session cookie and refuses a cross-site request', async () => {
    const h = harness();
    const { auth, email } = await signedInWithPasskey(h);
    const res = await passkeySignIn(h, auth);
    expect(res.status).toBe(201);
    expect(cookieOf(res)).not.toBe('');
    expect((await read(res)).user.email).toBe(email);
    const { challengeId, publicKey } = await challenge(h);
    const cross = await h.app.request('/v1/sessions/passkey', json({ challengeId, response: auth.assert(publicKey, PORTAL) }, { origin: 'https://evil.example' }));
    expect(cross.status).toBe(403);
    expect((await read(cross)).error.code).toBe('CROSS_SITE_REQUEST');
  });

  it('the app route returns a device token; the session records its passkey and the audit says so', async () => {
    const h = harness();
    const { auth, passkey, orgId } = await signedInWithPasskey(h);
    const res = await devicePasskeySignIn(h, auth);
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(isDeviceSessionToken(body.token)).toBe(true);
    const signedIn = (await h.store.audit.listByOrganization(orgId, 50)).filter((e) => e.action === 'user.signed_in');
    expect(signedIn[0]).toMatchObject({ actorType: 'USER', metadata: { sessionKind: 'device', method: 'passkey', passkeyId: passkey.id } });
    const list = await read(await h.app.request('/v1/passkeys', { headers: withDevice(body.token) }));
    expect(list.items[0].lastUsedAt).toBe(h.clock.now.toISOString());
  });

  it('a passkey made on the portal signs in to the app, and one made in the app signs in to the portal (A1)', async () => {
    const h = harness();
    const { auth } = await signedInWithPasskey(h);
    expect((await devicePasskeySignIn(h, auth, APP)).status).toBe(201);
    const p = await person(h);
    const device = await read(await h.app.request('/v1/device-sessions', json({ email: p.email, password: p.password })));
    const appAuth = new SoftAuthenticator();
    const { challengeId, publicKey } = await read(await h.app.request('/v1/passkeys/creation-options', json({}, withDevice(device.token))));
    const added = await h.app.request('/v1/passkeys', json({ challengeId, response: appAuth.create(publicKey, APP) }, withDevice(device.token)));
    expect(await read(added)).toMatchObject({ name: 'iCloud Keychain' });
    expect((await passkeySignIn(h, appAuth, {}, PORTAL)).status).toBe(201);
  });

  it('removing a passkey stops it at once and signs out the sessions it opened, not the caller (A2)', async () => {
    const h = harness();
    const { auth, passkey, token, orgId } = await signedInWithPasskey(h);
    const opened = (await read(await devicePasskeySignIn(h, auth))).token as string;
    const viaPasskeyCookie = cookieOf(await passkeySignIn(h, auth));
    expect((await h.app.request(`/v1/passkeys/${passkey.id}`, { method: 'DELETE', headers: withSession(viaPasskeyCookie) })).status).toBe(204);
    expect((await h.app.request('/v1/me', { headers: withDevice(opened) })).status).toBe(401);
    expect((await h.app.request('/v1/me', { headers: withSession(viaPasskeyCookie) })).status).toBe(200);
    expect((await h.app.request('/v1/me', { headers: withSession(token) })).status).toBe(200);
    const res = await passkeySignIn(h, auth);
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('INVALID_CREDENTIALS');
    expect((await h.store.audit.listByOrganization(orgId, 50)).some((e) => e.action === 'user.passkey_removed')).toBe(true);
  });

  it('failed assertions share the password lockout (A3), and a locked account’s good assertion is refused', async () => {
    const h = harness();
    const { auth, email, id } = await signedInWithPasskey(h);
    for (let i = 0; i < 2; i++) expect((await h.app.request('/v1/sessions', json({ email, password: 'wrong' }, SAME_ORIGIN))).status).toBe(401);
    for (let i = 0; i < SIGN_IN_POLICY.maxFailures - 2; i++) expect((await passkeySignIn(h, auth, { userVerified: false })).status).toBe(401);
    expect((await h.store.users.getById(id))?.lockedUntil).not.toBeNull();
    expect((await passkeySignIn(h, auth)).status).toBe(401);
    minutes(h, 16);
    expect((await passkeySignIn(h, auth)).status).toBe(201);
  });

  it('a lockout from passkeys is audited by the SYSTEM with method passkey', async () => {
    const h = harness();
    const { auth, orgId } = await signedInWithPasskey(h);
    for (let i = 0; i < SIGN_IN_POLICY.maxFailures; i++) await passkeySignIn(h, auth, {}, 'https://evil.example');
    const locked = (await h.store.audit.listByOrganization(orgId, 50)).find((e) => e.action === 'user.locked_out');
    expect(locked).toMatchObject({ actorType: 'SYSTEM', metadata: { method: 'passkey' } });
  });

  it('an operator lock, a disabled person, a pending review and a closed account follow the password path', async () => {
    const h = harness();
    const locked = await signedInWithPasskey(h);
    expect((await h.app.request(`/admin/v1/users/${locked.id}/setup-link`, json({ lock: true }, admin))).status).toBe(200);
    expect((await passkeySignIn(h, locked.auth)).status).toBe(401);

    const disabled = await signedInWithPasskey(h);
    await h.store.users.setStatus(disabled.id, 'DISABLED', h.clock.now);
    expect((await passkeySignIn(h, disabled.auth)).status).toBe(401);

    const pending = await signedInWithPasskey(h);
    await h.store.users.setStatus(pending.id, 'PENDING_REVIEW', h.clock.now);
    const underReview = await passkeySignIn(h, pending.auth);
    expect(underReview.status).toBe(403);
    expect((await read(underReview)).error.code).toBe('ACCOUNT_UNDER_REVIEW');

    const closing = await signedInWithPasskey(h);
    const kept = await h.store.sessions.findByDigest(sessionDigest(PEPPER, closing.token));
    await h.store.users.requestClosure({ userId: closing.id, at: h.clock.now, deleteAfter: closureDeadline(h.clock.now), endedSubscriptionIds: [], exceptSessionId: kept!.id, audit: [] });
    // In its grace, a closing account signs in (to reach Keep my account), as with the password.
    expect((await passkeySignIn(h, closing.auth)).status).toBe(201);
    h.clock.now = new Date(closureDeadline(h.clock.now).getTime() + 1000);
    expect((await passkeySignIn(h, closing.auth)).status).toBe(401);
    expect((await h.store.users.getById(closing.id))?.failedSignIns).toBe(0);
  });

  it('refuses a counter that went backwards and audits it', async () => {
    const h = harness();
    const p = await person(h);
    const token = await passwordSignIn(h, p.email, p.password);
    const { res, auth } = await addPasskey(h, token, new SoftAuthenticator({ counts: true }));
    expect(res.status).toBe(201);
    expect((await passkeySignIn(h, auth)).status).toBe(201);
    expect((await passkeySignIn(h, auth, { counter: 1 })).status).toBe(401);
    expect((await h.store.audit.listByOrganization(p.orgId, 50)).some((e) => e.action === 'user.passkey_counter_regressed')).toBe(true);
  });

  it('an unknown credential, a replayed challenge or a creation challenge is refused; the challenge budget is per address', async () => {
    const h = harness();
    const { auth, token } = await signedInWithPasskey(h);
    const stranger = new SoftAuthenticator();
    stranger.create({ challenge: 'unused', rp: { id: 'localhost', name: 'MTB3A' }, user: { id: 'c3RyYW5nZXI', name: 's', displayName: 's' }, pubKeyCredParams: [] }, PORTAL);
    expect((await passkeySignIn(h, stranger)).status).toBe(401);
    const { challengeId, publicKey } = await challenge(h);
    const first = await h.app.request('/v1/sessions/passkey', json({ challengeId, response: auth.assert(publicKey, PORTAL) }, SAME_ORIGIN));
    expect(first.status).toBe(201);
    const replay = await h.app.request('/v1/sessions/passkey', json({ challengeId, response: auth.assert(publicKey, PORTAL) }, SAME_ORIGIN));
    expect(replay.status).toBe(401);
    const creation = await read(await h.app.request('/v1/passkeys/creation-options', json({}, withSession(token))));
    const asSignIn = await h.app.request('/v1/sessions/passkey', json({ challengeId: creation.challengeId, response: auth.assert({ challenge: creation.publicKey.challenge, rpId: 'localhost' } as Loose, PORTAL) }, SAME_ORIGIN));
    expect(asSignIn.status).toBe(401);
    const ip = { 'x-forwarded-for': '203.0.113.9' };
    let last = 0;
    for (let i = 0; i <= SIGN_IN_POLICY.ipPerMinute; i++) last = (await h.app.request('/v1/passkey-challenges', { method: 'POST', headers: ip })).status;
    expect(last).toBe(429);
  });

  it('a password change keeps passkeys, revokes the passkey sessions it always would, and passkeys still sign in (A4)', async () => {
    const h = harness();
    const { auth, token, password } = await signedInWithPasskey(h);
    const opened = (await read(await devicePasskeySignIn(h, auth))).token as string;
    minutes(h, 3);
    const changed = await h.app.request('/v1/me/password', json({ currentPassword: password, newPassword: 'a-brand-new-password-123' }, withSession(token)));
    expect(changed.status).toBe(204);
    minutes(h, 1);
    expect((await h.app.request('/v1/me', { headers: withDevice(opened) })).status).toBe(401);
    expect((await read(await h.app.request('/v1/passkeys', { headers: withSession(token) }))).items).toHaveLength(1);
    expect((await passkeySignIn(h, auth)).status).toBe(201);
  });
});
