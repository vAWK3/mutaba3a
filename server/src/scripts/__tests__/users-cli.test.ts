import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../app.js';
import { sessionDigest } from '../../auth/sessions.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../../auth/users.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { CURRENT_TERMS } from '../../legal.js';
import { runUsersCommand } from '../users.js';

const TOKEN = 'cli-admin-token-with-at-least-32-characters';
const URL_BASE = 'http://mutaba3a.test';
const PEPPER = 'cli-session-pepper-with-at-least-32-chars';

/** MUT-235: the printed setup links — https even though the CLI called the API over http (only loopback keeps http). */
const links = (out: string[]) => out.filter((l) => /^https:\/\/mutaba3a\.test\/setup#[A-Za-z0-9_-]{43}$/.test(l));

function harness() {
  const store = new MemoryLedgerStore();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: TOKEN,
    keyEnvironment: 'test',
    version: 'test',
    passwordHasher: createArgon2Hasher(ARGON2_MINIMUMS),
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: false, trustedProxyHops: 1 },
  });
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => app.request(input as string, init)) as typeof fetch;
  const out: string[] = [];
  const err: string[] = [];
  // null = no token at all (undefined would fall back to the default).
  const run = (argv: string[], token: string | null = TOKEN) =>
    runUsersCommand(argv, { fetch: fetchFn, url: URL_BASE, token: token ?? undefined, out: (l: string) => out.push(l), err: (l: string) => err.push(l) });
  return { store, run, out, err };
}

async function org(store: MemoryLedgerStore, name: string) {
  return store.organizations.create({ name, slug: name.toLowerCase().replace(/\s+/g, '-'), defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
}

describe('users CLI (npm run provision:user and friends)', () => {
  it('create prints the user id and the one-time setup link exactly once, and no password (MUT-235)', async () => {
    const h = harness();
    const o = await org(h.store, 'Sader Law');
    const code = await h.run(['create', '--email', 'Nour@Firm.ps', '--name', 'Nour Haddad', '--organization-id', o.id, '--locale', 'ar']);
    expect(code).toBe(0);
    const user = await h.store.users.findByEmail('nour@firm.ps');
    expect(user?.locale).toBe('ar');
    expect(user?.passwordHash).toBeNull();
    const text = h.out.join('\n');
    expect(text).toContain(user!.id);
    expect(text).toMatch(/setup link.*shown once/i);
    expect(text).toMatch(/valid until/i);
    expect(links(h.out)).toHaveLength(1);
    expect(h.out.filter((l) => /^[A-Za-z0-9_-]{24}$/.test(l))).toHaveLength(0);
  });

  it('create forwards --valid-hours (MUT-235)', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    expect(await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id, '--valid-hours', '24'])).toBe(0);
    const [link] = links(h.out);
    const token = new URL(link!).hash.slice(1);
    const stored = await h.store.accountSetup.findByDigest(sessionDigest(PEPPER, token));
    expect(stored!.expiresAt.getTime() - stored!.createdAt.getTime()).toBe(24 * 3_600_000);
    expect(await h.run(['create', '--email', 'two@firm.ps', '--name', 'Two', '--organization-id', o.id, '--valid-hours', 'soon'])).not.toBe(0);
  });

  it('create works with no firm, from --currency and --timezone, and prints the personal profile (MUT-120)', async () => {
    const h = harness();
    const code = await h.run(['create', '--email', 'solo@firm.ps', '--name', 'Solo', '--currency', 'USD', '--timezone', 'Asia/Hebron']);
    expect(code).toBe(0);
    const user = (await h.store.users.findByEmail('solo@firm.ps'))!;
    const memberships = await h.store.memberships.listByUser(user.id);
    expect(memberships).toHaveLength(1);
    const [membership] = memberships;
    const personal = (await h.store.organizations.getById(membership!.organizationId))!;
    expect(personal).toMatchObject({ personalOwnerUserId: user.id, defaultCurrency: 'USD', timezone: 'Asia/Hebron' });
    expect(h.out).toContain(`personal ${personal.id} شخصي`);
  });

  it('grant and revoke resolve the user by email', async () => {
    const h = harness();
    const a = await org(h.store, 'Firm A');
    const b = await org(h.store, 'Firm B');
    await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', a.id]);
    const user = (await h.store.users.findByEmail('nour@firm.ps'))!;

    expect(await h.run(['grant', '--email', 'NOUR@firm.ps', '--organization-id', b.id])).toBe(0);
    expect(await h.store.memberships.find(user.id, b.id)).not.toBeNull();

    expect(await h.run(['revoke', '--email', 'nour@firm.ps', '--organization-id', b.id])).toBe(0);
    expect(await h.store.memberships.find(user.id, b.id)).toBeNull();
  });

  it('rotate prints a new setup link once and says the current password keeps working (MUT-235)', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id]);
    h.out.length = 0;
    expect(await h.run(['rotate', '--email', 'nour@firm.ps'])).toBe(0);
    expect(links(h.out)).toHaveLength(1);
    expect(h.out.join('\n')).toMatch(/current password keeps working until they use this link/i);
    expect(h.out.filter((l) => /^[A-Za-z0-9_-]{24}$/.test(l))).toHaveLength(0);
  });

  it('rotate --lock clears the password and signs every session out now (MUT-235 D2)', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id]);
    const user = (await h.store.users.findByEmail('nour@firm.ps'))!;
    await h.store.users.setPassword(user.id, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', new Date());
    h.out.length = 0;
    expect(await h.run(['rotate', '--email', 'nour@firm.ps', '--lock'])).toBe(0);
    expect(links(h.out)).toHaveLength(1);
    expect(h.out.join('\n')).toMatch(/password no longer works and every session is signed out/i);
    expect((await h.store.users.getById(user.id))?.passwordHash).toBeNull();
  });

  it('disable and enable print the resulting status', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id]);
    expect(await h.run(['disable', '--email', 'nour@firm.ps'])).toBe(0);
    expect(h.out.join('\n')).toContain('DISABLED');
    expect((await h.store.users.findByEmail('nour@firm.ps'))?.status).toBe('DISABLED');
    expect(await h.run(['enable', '--email', 'nour@firm.ps'])).toBe(0);
    expect((await h.store.users.findByEmail('nour@firm.ps'))?.status).toBe('ACTIVE');
  });

  it('revoke-sessions prints how many sessions were ended', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id]);
    h.out.length = 0;
    expect(await h.run(['revoke-sessions', '--email', 'nour@firm.ps'])).toBe(0);
    expect(h.out.join('\n')).toMatch(/0 sessions? revoked/);
  });

  it('fails without a token, prints no secret', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    expect(await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id], null)).not.toBe(0);
    expect(h.err.join('\n')).toContain('MUTABA3A_ADMIN_TOKEN');
    expect(h.out.filter((l) => /^[A-Za-z0-9_-]{24}$/.test(l))).toHaveLength(0);
  });

  it('fails for an unknown email with a readable message', async () => {
    const h = harness();
    expect(await h.run(['rotate', '--email', 'nobody@firm.ps'])).not.toBe(0);
    expect(h.err.join('\n')).toMatch(/no user/i);
  });

  it('surfaces the server error code', async () => {
    const h = harness();
    expect(await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', '00000000-0000-4000-8000-000000000000'])).not.toBe(0);
    expect(h.err.join('\n')).toContain('NOT_FOUND');
  });

  describe('firm switch (MUT-300)', () => {
    const AUDIT = { requestId: null };
    async function ownedBusiness(h: ReturnType<typeof harness>, email: string) {
      const { user } = await h.store.users.create({
        email,
        displayName: 'Rana',
        passwordHash: null,
        locale: 'en',
        personal: { name: 'Personal', slug: `personal-${email}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
        at: new Date('2026-10-20T09:00:00Z'),
      });
      const created = await h.store.organizations.createOwned(user.id, { name: 'Studio', slug: `studio-${email}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: new Date('2026-10-20T09:00:00Z') }, 6, { actorId: user.id, requestId: null });
      if (created.kind !== 'created') throw new Error('expected a profile');
      return { user, profile: created.organization };
    }

    it('firm-requests lists every pending request with the requester, or says there are none', async () => {
      const h = harness();
      expect(await h.run(['firm-requests'])).toBe(0);
      expect(h.out).toEqual(['no pending firm requests']);
      const { user, profile } = await ownedBusiness(h, 'rana@studio.ps');
      await h.store.organizations.requestFirm(profile.id, user.id, new Date('2026-10-20T10:00:00Z'), { actorId: user.id, ...AUDIT });
      h.out.length = 0;
      expect(await h.run(['firm-requests'])).toBe(0);
      expect(h.out).toEqual([`${profile.id} Studio — requested 2026-10-20T10:00:00.000Z by rana@studio.ps (owned)`]);
    });

    it('firm-enable turns firm features on in place for an owned profile, with no owner needed', async () => {
      const h = harness();
      const { user, profile } = await ownedBusiness(h, 'rana@studio.ps');
      expect(await h.run(['firm-enable', '--organization-id', profile.id])).toBe(0);
      expect(h.out).toEqual([`${profile.id} Studio: firm features on`]);
      expect(await h.store.organizations.getById(profile.id)).toMatchObject({ ownerUserId: user.id, firmEnabledAt: expect.any(Date) });
    });

    it('firm-enable names an operator firm’s owners by email; firm-disable turns it off', async () => {
      const h = harness();
      const o = await org(h.store, 'Sader Law');
      expect(await h.run(['create', '--email', 'nour@firm.ps', '--name', 'Nour', '--organization-id', o.id])).toBe(0);
      expect(await h.run(['create', '--email', 'omar@firm.ps', '--name', 'Omar', '--organization-id', o.id])).toBe(0);
      h.out.length = 0;
      expect(await h.run(['firm-enable', '--organization-id', o.id])).not.toBe(0);
      expect(h.err.join('\n')).toContain('VALIDATION_FAILED');
      expect(await h.run(['firm-enable', '--organization-id', o.id, '--owner', 'Nour@Firm.ps'])).toBe(0);
      const nour = (await h.store.users.findByEmail('nour@firm.ps'))!;
      const omar = (await h.store.users.findByEmail('omar@firm.ps'))!;
      expect(await h.store.memberships.find(nour.id, o.id)).toMatchObject({ role: 'OWNER' });
      expect(await h.store.memberships.find(omar.id, o.id)).toMatchObject({ role: 'BOOKKEEPER' });
      expect(await h.run(['firm-disable', '--organization-id', o.id])).toBe(0);
      expect(h.out).toEqual([`${o.id} Sader Law: firm features on`, `${o.id} Sader Law: firm features off`]);
    });

    it('firm-decline clears a pending request, and fails readably when none is pending', async () => {
      const h = harness();
      const { user, profile } = await ownedBusiness(h, 'rana@studio.ps');
      await h.store.organizations.requestFirm(profile.id, user.id, new Date('2026-10-20T10:00:00Z'), { actorId: user.id, ...AUDIT });
      expect(await h.run(['firm-decline', '--organization-id', profile.id])).toBe(0);
      expect(h.out).toEqual([`${profile.id} Studio: firm request declined`]);
      expect(await h.run(['firm-decline', '--organization-id', profile.id])).not.toBe(0);
      expect(h.err.join('\n')).toContain('NOT_FOUND');
    });
  });

  it('rejects an unknown subcommand with usage', async () => {
    const h = harness();
    expect(await h.run(['delete', '--email', 'x@y.z'])).not.toBe(0);
    expect(h.err.join('\n')).toMatch(/usage/i);
  });
});

describe('users terms (MUT-324 T1)', () => {
  it('lists every user with the terms version they last accepted, and flags who is behind', async () => {
    const h = harness();
    const o = await org(h.store, 'Terms Firm');
    const ahead = await h.store.users.create({
      email: 'accepted@firm.ps',
      displayName: 'Accepted',
      passwordHash: null,
      locale: 'en',
      organizationId: o.id,
      personal: { name: 'A', slug: 'a-personal', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: new Date('2026-10-20T09:00:00Z'),
    });
    await h.store.users.create({
      email: 'never@firm.ps',
      displayName: 'Never',
      passwordHash: null,
      locale: 'ar',
      organizationId: o.id,
      personal: { name: 'B', slug: 'b-personal', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: new Date('2026-10-20T09:00:00Z'),
    });
    await h.store.users.acceptTerms({
      userId: ahead.user.id,
      version: CURRENT_TERMS.version,
      locale: 'en',
      textSha256: CURRENT_TERMS.sha256.en,
      surface: 'portal',
      clientRelease: 'web-v0.1.16',
      at: new Date('2026-10-20T10:00:00Z'),
      audit: [],
    });

    expect(await h.run(['terms'])).toBe(0);
    const text = h.out.join('\n');
    expect(text).toContain(`current terms ${CURRENT_TERMS.version}`);
    // MUT-354: the client release that showed the latest accepted version, or - when none was recorded
    expect(h.out.find((l) => l.startsWith('accepted@firm.ps'))).toMatch(new RegExp(`${CURRENT_TERMS.version}  web-v0\\.1\\.16  ok$`));
    expect(h.out.find((l) => l.startsWith('never@firm.ps'))).toMatch(/never {2}- {2}BEHIND$/);
    expect(text).toContain('1 of 2 active users behind the current terms');
  });
});
