import { beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { FRONT_DOOR_HEADER } from '../auth/sessions.js';
import type { SessionSettings } from '../auth/middleware.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';
import { webauthnConfigOf } from '../auth/webauthn.js';

/**
 * MUT-112 step 3 outage: the first release with FRONT_DOOR_TOKEN set answered 500 to
 * every portal sign-in, because the origin check read Hono's request with a detached
 * method. The unit tests used plain objects, and the post-deploy smoke test never
 * signs in. This drives the whole app with production's session settings, through
 * the front door and directly on the legacy host, from sign-in to a cookie write.
 */
const TOKEN = 't'.repeat(48);
const PORTAL = 'https://app.placeholder.example';
const OLD = 'https://service.a.run.app';
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const SESSIONS: SessionSettings = {
  pepper: 'p'.repeat(64),
  idleMinutes: 120,
  absoluteHours: 12,
  secureCookie: true,
  trustedProxyHops: 1,
  portalOrigin: PORTAL,
  frontDoorToken: TOKEN,
};

const post = (body: unknown, headers: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const viaDoor = { [FRONT_DOOR_HEADER]: TOKEN, origin: PORTAL };

let app: ReturnType<typeof createApp>;
let password: string;

beforeAll(async () => {
  app = createApp({
    store: new MemoryLedgerStore(),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: 'test',
    sessions: SESSIONS,
  });
  const org = (await (
    await app.request('/admin/v1/organizations', post({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, { 'x-admin-token': ADMIN_TOKEN }))
  ).json()) as { id: string };
  ({ password } = await provisionUser(app, { email: 'nour@firm.ps', displayName: 'Nour', organizationId: org.id }));
});

describe('portal sign-in with the front door configured (MUT-112)', () => {
  it('through the front door: a wrong password is 401, the right one signs in, and a cookie write passes the origin check', async () => {
    const wrong = await app.request(`${OLD}/v1/sessions`, post({ email: 'nour@firm.ps', password: 'not-the-password-123' }, viaDoor));
    expect(wrong.status).toBe(401);

    const signIn = await app.request(`${OLD}/v1/sessions`, post({ email: 'nour@firm.ps', password }, viaDoor));
    expect(signIn.status).toBe(201);
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');

    const signOut = await app.request(`${OLD}/v1/sessions/current`, { method: 'DELETE', headers: { ...viaDoor, cookie } });
    expect(signOut.status).toBeLessThan(300);
  });

  it('directly on the legacy host: its own origin signs in as before', async () => {
    const wrong = await app.request(`${OLD}/v1/sessions`, post({ email: 'nour@firm.ps', password: 'not-the-password-123' }, { origin: OLD }));
    expect(wrong.status).toBe(401);
    const signIn = await app.request(`${OLD}/v1/sessions`, post({ email: 'nour@firm.ps', password }, { origin: OLD }));
    expect(signIn.status).toBe(201);
  });

  it('refuses another origin on either path, without reaching the password check', async () => {
    const foreign = { origin: 'https://elsewhere.example' };
    expect((await app.request(`${OLD}/v1/sessions`, post({ email: 'nour@firm.ps', password }, foreign))).status).toBe(403);
    expect((await app.request(`${OLD}/v1/sessions`, post({ email: 'nour@firm.ps', password }, { ...viaDoor, ...foreign }))).status).toBe(403);
  });
});

describe('passkey sign-in with the front door configured (MUT-115 §11.11, the d4f4231e lesson)', () => {
  it('through the front door a passkey signs in and sets the cookie; another origin is refused before any check', async () => {
    const door = createApp({
      store: new MemoryLedgerStore(),
      logger: pino({ level: 'silent' }),
      rateLimiter: new SlidingWindowRateLimiter(1_000_000),
      adminToken: ADMIN_TOKEN,
      keyEnvironment: 'test',
      version: 'test',
      sessions: SESSIONS,
      webauthn: webauthnConfigOf({ rpId: 'placeholder.example', portalOrigin: PORTAL }),
    });
    const org = (await (await door.request('/admin/v1/organizations', post({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, { 'x-admin-token': ADMIN_TOKEN }))).json()) as { id: string };
    const person = await provisionUser(door, { email: 'rana@firm.ps', displayName: 'Rana', organizationId: org.id });
    const signIn = await door.request(`${OLD}/v1/sessions`, post({ email: 'rana@firm.ps', password: person.password }, viaDoor));
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const auth = new SoftAuthenticator();
    const options = (await (await door.request(`${OLD}/v1/passkeys/creation-options`, post({}, { ...viaDoor, cookie }))).json()) as { challengeId: string; publicKey: never };
    const added = await door.request(`${OLD}/v1/passkeys`, post({ challengeId: options.challengeId, response: auth.create(options.publicKey, PORTAL) }, { ...viaDoor, cookie }));
    expect(added.status).toBe(201);

    const challenge = async () => (await (await door.request(`${OLD}/v1/passkey-challenges`, { method: 'POST', headers: viaDoor })).json()) as { challengeId: string; publicKey: never };
    const first = await challenge();
    const passkeySignIn = await door.request(`${OLD}/v1/sessions/passkey`, post({ challengeId: first.challengeId, response: auth.assert(first.publicKey, PORTAL) }, viaDoor));
    expect(passkeySignIn.status).toBe(201);
    expect(passkeySignIn.headers.get('set-cookie') ?? '').toMatch(/__Host-mut_session=/);

    const second = await challenge();
    const foreign = await door.request(`${OLD}/v1/sessions/passkey`, post({ challengeId: second.challengeId, response: auth.assert(second.publicKey, PORTAL) }, { ...viaDoor, origin: 'https://elsewhere.example' }));
    expect(foreign.status).toBe(403);
  });
});
