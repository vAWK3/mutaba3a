import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { ARGON2_MINIMUMS, createArgon2Hasher, type PasswordHasher } from '../auth/users.js';
import { CURRENT_TERMS, termsAccepted, type CurrentTerms } from '../legal.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { buildMe } from '../routes/me.js';
import { MeSchema } from '../schemas.js';
import { setupTokenOf } from './helpers/provision.js';

/**
 * MUT-324 (ADR-102): a person accepts the terms at their setup link, and a
 * signed-in person whose latest acceptance is older than the current version
 * accepts again through POST /v1/me/terms-acceptance. The acceptance records
 * the version, the language read, that text's sha256 and where it happened.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const SAME_ORIGIN = { origin: 'http://localhost' };
const COOKIE = '__Host-mut_session';
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const PASSWORD = 'a-long-enough-passphrase';
const realHasher = createArgon2Hasher(ARGON2_MINIMUMS);

/** A later version than the one shipped, as a release that bumps the terms would carry. */
const BUMPED: CurrentTerms = { version: '2099-01-01', sha256: { en: 'e'.repeat(64), ar: 'a'.repeat(64) } };

function harness(store = new MemoryLedgerStore(), terms?: CurrentTerms) {
  const clock = { now: new Date('2026-10-20T09:00:00Z') };
  const hasher: PasswordHasher & { hash: ReturnType<typeof vi.fn> } = {
    hash: vi.fn((p: string) => realHasher.hash(p)),
    verify: (h: string, p: string) => realHasher.verify(h, p),
  };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    passwordHasher: hasher,
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
    ...(terms ? { terms } : {}),
  });
  return { app, store, clock, hasher };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

async function firmOrg(h: Harness) {
  return (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as {
    id: string;
  };
}

/** An account with an unused setup link, a member of one firm it doesn't own. */
async function provision(h: Harness, organizationId?: string) {
  const email = `partner${++seq}@firm.ps`;
  const res = await h.app.request(
    '/admin/v1/users',
    json({ email, displayName: 'Nour Haddad', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'ar', ...(organizationId ? { organizationId } : {}) }, admin),
  );
  expect(res.status).toBe(201);
  const created = await read(res);
  return { id: created.user.id as string, email, personalId: created.personalProfile.id as string, token: setupTokenOf(created.setupLink.url) };
}

const check = (h: Harness, token: string) => h.app.request('/v1/account-setup/check', json({ token }, SAME_ORIGIN));
const redeem = (h: Harness, token: string, extra: Record<string, unknown> = { acceptedTermsVersion: CURRENT_TERMS.version }) =>
  h.app.request('/v1/account-setup', json({ token, password: PASSWORD, ...extra }, SAME_ORIGIN));

async function signIn(h: Harness, email: string) {
  const res = await h.app.request('/v1/sessions', json({ email, password: PASSWORD }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return { res, cookie: { cookie: `${COOKIE}=${token}` } };
}
async function deviceSignIn(h: Harness, email: string) {
  const { token } = (await read(await h.app.request('/v1/device-sessions', json({ email, password: PASSWORD })))) as { token: string };
  return { authorization: `Bearer ${token}` };
}
const accept = (h: Harness, auth: Record<string, string>, body: unknown) => h.app.request('/v1/me/terms-acceptance', json(body, { ...SAME_ORIGIN, ...auth }));
const me = async (h: Harness, auth: Record<string, string>) => read(await h.app.request('/v1/me', { headers: auth }));
const termsAudit = async (h: Harness, organizationId: string) =>
  (await h.store.audit.list(organizationId, { action: 'user.terms_accepted' }, { limit: 10, cursor: null })).items;

describe('termsAccepted (MUT-324 D10)', () => {
  it('counts the latest acceptance when it is the current version or newer', () => {
    expect(termsAccepted(null, '2026-10-19')).toBe(false);
    expect(termsAccepted('2026-01-01', '2026-10-19')).toBe(false);
    expect(termsAccepted('2026-10-19', '2026-10-19')).toBe(true);
    // A rollback to an older server: a person who accepted the newer text is not asked again.
    expect(termsAccepted('2027-03-01', '2026-10-19')).toBe(true);
  });
});

describe('accepting the terms at the setup link (MUT-324)', () => {
  it('the check names the terms version the page must show', async () => {
    const h = harness();
    const p = await provision(h);
    expect(await read(await check(h, p.token))).toMatchObject({ state: 'valid', termsVersion: CURRENT_TERMS.version });
  });

  it('an invalid link names no terms version', async () => {
    const h = harness();
    expect(await read(await check(h, 'x'.repeat(43)))).toEqual({ state: 'invalid' });
  });

  it('refuses a redeem that accepted no version or an old one, before any hashing, and the link stays usable', async () => {
    const h = harness();
    const p = await provision(h);
    const hashesBefore = h.hasher.hash.mock.calls.length;
    for (const extra of [{}, { acceptedTermsVersion: '2020-01-01' }]) {
      const res = await redeem(h, p.token, extra);
      expect(res.status).toBe(409);
      expect((await read(res)).error).toMatchObject({ code: 'TERMS_VERSION_STALE', details: { current: CURRENT_TERMS.version } });
    }
    expect(h.hasher.hash.mock.calls.length).toBe(hashesBefore);
    expect((await redeem(h, p.token)).status).toBe(200);
  });

  it('a dead link answers why it is dead, not that the terms changed', async () => {
    const h = harness();
    const p = await provision(h);
    expect((await redeem(h, p.token)).status).toBe(200);
    const res = await redeem(h, p.token, { acceptedTermsVersion: '2020-01-01' });
    expect(res.status).toBe(410);
    expect((await read(res)).error.details).toEqual({ state: 'used' });
  });

  it('records the version, language, text fingerprint and surface, audited on owned profiles only', async () => {
    const h = harness();
    const firm = await firmOrg(h);
    const p = await provision(h, firm.id);
    expect((await redeem(h, p.token, { acceptedTermsVersion: CURRENT_TERMS.version, termsLocale: 'en' })).status).toBe(200);
    expect(await h.store.users.latestTermsAcceptance(p.id)).toMatchObject({
      userId: p.id,
      version: CURRENT_TERMS.version,
      locale: 'en',
      textSha256: CURRENT_TERMS.sha256.en,
      surface: 'portal',
    });
    const owned = await termsAudit(h, p.personalId);
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({ actorType: 'USER', actorId: p.id, entityId: p.id, metadata: { version: CURRENT_TERMS.version, locale: 'en', surface: 'portal' } });
    // A firm the person is merely a member of never sees their personal agreement (D2).
    expect(await termsAudit(h, firm.id)).toEqual([]);
  });

  it('records the language of the person’s account when the page says none', async () => {
    const h = harness();
    const p = await provision(h);
    expect((await redeem(h, p.token)).status).toBe(200);
    expect(await h.store.users.latestTermsAcceptance(p.id)).toMatchObject({ locale: 'ar', textSha256: CURRENT_TERMS.sha256.ar });
  });

  it('a reset link after acceptance still sets the password, with one acceptance and one audit row', async () => {
    const h = harness();
    const p = await provision(h);
    expect((await redeem(h, p.token)).status).toBe(200);
    const reset = setupTokenOf((await read(await h.app.request(`/admin/v1/users/${p.id}/setup-link`, json({}, admin)))).setupLink.url);
    expect((await redeem(h, reset)).status).toBe(200);
    expect(await termsAudit(h, p.personalId)).toHaveLength(1);
    const { res } = await signIn(h, p.email);
    expect(res.status).toBe(201);
  });
});

describe('the terms in /v1/me (MUT-324)', () => {
  it('reports the current version accepted after setup, on every sign-in surface', async () => {
    const h = harness();
    const p = await provision(h);
    await redeem(h, p.token);
    const { res, cookie } = await signIn(h, p.email);
    expect((await read(res)).terms).toEqual({ version: CURRENT_TERMS.version, accepted: true });
    expect((await me(h, cookie)).terms).toEqual({ version: CURRENT_TERMS.version, accepted: true });
    expect((await me(h, await deviceSignIn(h, p.email))).terms).toEqual({ version: CURRENT_TERMS.version, accepted: true });
    MeSchema.parse(await me(h, cookie));
  });

  it('asks again once a release bumps the version', async () => {
    const store = new MemoryLedgerStore();
    const before = harness(store);
    const p = await provision(before);
    await redeem(before, p.token);
    const after = harness(store, BUMPED);
    const { cookie } = await signIn(after, p.email);
    expect((await me(after, cookie)).terms).toEqual({ version: BUMPED.version, accepted: false });
  });

  it('is null where no terms apply (the portal’s signed-out mode)', async () => {
    const store = new MemoryLedgerStore();
    const h = harness(store);
    const p = await provision(h);
    const user = await store.users.getById(p.id);
    expect((await buildMe(store, user!, null)).terms).toBeNull();
  });
});

describe('POST /v1/me/terms-acceptance (MUT-324)', () => {
  async function bumped() {
    const store = new MemoryLedgerStore();
    const before = harness(store);
    const p = await provision(before);
    await redeem(before, p.token);
    const h = harness(store, BUMPED);
    return { h, p };
  }

  it('accepts the bumped version with no profile header, once, audited once on the owned profile', async () => {
    const { h, p } = await bumped();
    const { cookie } = await signIn(h, p.email);
    for (let i = 0; i < 2; i++) {
      const res = await accept(h, cookie, { version: BUMPED.version, locale: 'en' });
      expect(res.status).toBe(200);
      expect(await read(res)).toEqual({ version: BUMPED.version, accepted: true });
    }
    expect((await me(h, cookie)).terms).toEqual({ version: BUMPED.version, accepted: true });
    expect(await h.store.users.latestTermsAcceptance(p.id)).toMatchObject({ version: BUMPED.version, locale: 'en', textSha256: BUMPED.sha256.en, surface: 'portal' });
    const rows = (await termsAudit(h, p.personalId)).filter((e: Loose) => e.metadata.version === BUMPED.version);
    expect(rows).toHaveLength(1);
  });

  it('records a phone acceptance as surface phone', async () => {
    const { h, p } = await bumped();
    const device = await deviceSignIn(h, p.email);
    expect((await h.app.request('/v1/me/terms-acceptance', json({ version: BUMPED.version, locale: 'ar' }, device))).status).toBe(200);
    expect(await h.store.users.latestTermsAcceptance(p.id)).toMatchObject({ version: BUMPED.version, surface: 'phone' });
  });

  it('refuses a version that is not the current one', async () => {
    const { h, p } = await bumped();
    const { cookie } = await signIn(h, p.email);
    const res = await accept(h, cookie, { version: CURRENT_TERMS.version, locale: 'en' });
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'TERMS_VERSION_STALE', details: { current: BUMPED.version } });
  });

  it('needs a signed-in person', async () => {
    const { h } = await bumped();
    expect((await accept(h, {}, { version: BUMPED.version, locale: 'en' })).status).toBe(401);
  });
});
