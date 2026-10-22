import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../../app.js';
import { FakeCheckoutGateway, FakeStripeGateway, stripeObjects } from '../../billing/stripe/__tests__/fake.js';
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

function harness(extra: Partial<AppDependencies> = {}) {
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
    ...extra,
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

  it('grant --role owner makes a co-owner and prints the note for both partners (MUT-373, DR8)', async () => {
    const h = harness();
    const { user: creator } = await h.store.users.create({ email: 'basel@studio.ps', displayName: 'Basel', passwordHash: null, locale: 'en', personal: { name: 'Personal', slug: 'personal-basel', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: new Date('2026-10-21T09:00:00Z') });
    const created = await h.store.organizations.createOwned(creator.id, { name: 'Sader & Haddad', slug: 'p-sh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: new Date('2026-10-21T09:00:00Z') }, 6, { actorId: creator.id, requestId: null });
    if (created.kind !== 'created') throw new Error('cap');
    await h.run(['create', '--email', 'lina@studio.ps', '--name', 'Lina', '--currency', 'ILS', '--timezone', 'Asia/Jerusalem']);
    const lina = (await h.store.users.findByEmail('lina@studio.ps'))!;
    h.out.length = 0;

    expect(await h.run(['grant', '--email', 'lina@studio.ps', '--organization-id', created.organization.id, '--role', 'owner'])).toBe(0);
    expect(await h.store.memberships.find(lina.id, created.organization.id)).toMatchObject({ role: 'OWNER' });
    expect(h.out[0]).toBe(`lina@studio.ps → ${created.organization.id}: co-owner added`);
    expect(h.out.join('\n')).toContain('Sader & Haddad is now shared');
    expect(h.out.join('\n')).toContain('Sader & Haddad أصبح مشتركًا');

    h.out.length = 0;
    expect(await h.run(['grant', '--email', 'lina@studio.ps', '--organization-id', created.organization.id, '--role', 'owner'])).toBe(0);
    expect(h.out).toEqual([`lina@studio.ps → ${created.organization.id}: already a co-owner`]);
  });

  it('grant refuses a --role other than owner', async () => {
    const h = harness();
    const o = await org(h.store, 'Firm');
    expect(await h.run(['grant', '--email', 'x@firm.ps', '--organization-id', o.id, '--role', 'bookkeeper'])).not.toBe(0);
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

describe('billing verbs (MUT-358)', () => {
  async function person(h: ReturnType<typeof harness>, email: string) {
    expect(await h.run(['create', '--email', email, '--name', 'Rana', '--currency', 'ILS', '--timezone', 'Asia/Jerusalem'])).toBe(0);
    h.out.length = 0;
    return (await h.store.users.findByEmail(email))!;
  }

  it('billing-grant covers a person by email; billing-grants lists it; billing-revoke revokes it once', async () => {
    const h = harness();
    const user = await person(h, 'rana@studio.ps');
    expect(await h.run(['billing-grant', '--email', 'rana@studio.ps', '--tier', 'FREELANCER', '--reason', 'pilot P01'])).toBe(0);
    const [grant] = await h.store.billing.listGrants({ userId: user.id });
    expect(h.out).toEqual([`granted: ${grant!.id} FREELANCER for person ${user.id} (no expiry): pilot P01`]);
    h.out.length = 0;
    expect(await h.run(['billing-grants', '--email', 'rana@studio.ps', '--active'])).toBe(0);
    expect(h.out).toHaveLength(1);
    h.out.length = 0;
    expect(await h.run(['billing-revoke', '--grant-id', grant!.id])).toBe(0);
    expect(h.out[0]).toMatch(/^revoked: /);
    h.out.length = 0;
    expect(await h.run(['billing-revoke', '--grant-id', grant!.id])).toBe(0);
    expect(h.out[0]).toMatch(/^already revoked: /);
  });

  it('billing-grant needs exactly one target', async () => {
    const h = harness();
    expect(await h.run(['billing-grant', '--tier', 'FIRM', '--reason', 'x'])).toBe(1);
    expect(h.err).toEqual(['give exactly one of --email and --organization-id']);
  });

  it('billing-link ties a customer to a person; billing-unlinked lists those still unmatched', async () => {
    const h = harness();
    await person(h, 'rana@studio.ps');
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_LEFT', userId: null, country: null, currency: 'USD', at: new Date(), linkAudit: [] });
    expect(await h.run(['billing-link', '--customer', 'cus_P01', '--email', 'rana@studio.ps', '--currency', 'ILS'])).toBe(0);
    expect(h.out).toEqual(['cus_P01 linked to rana@studio.ps (ILS)']);
    h.out.length = 0;
    expect(await h.run(['billing-unlinked'])).toBe(0);
    expect(h.out).toEqual([expect.stringMatching(/^cus_LEFT USD: seen /)]);
  });

  it('billing-reconcile runs the Stripe reconcile now and prints what needs the operator (MUT-360)', async () => {
    const off = harness();
    expect(await off.run(['billing-reconcile'])).toBe(1);
    expect(off.err.join('\n')).toContain('BILLING_NOT_CONFIGURED');

    const stripe = new FakeStripeGateway(() => new Date());
    stripe.products.set('prod_F', stripeObjects.product('prod_F', 'freelancer'));
    stripe.products.set('prod_X', stripeObjects.product('prod_X', null));
    stripe.customers.set('cus_1', stripeObjects.customer('cus_1'));
    stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product: 'prod_F' }));
    stripe.subscriptions.set('sub_2', stripeObjects.subscription({ id: 'sub_2', customer: 'cus_1', product: 'prod_X' }));
    const h = harness({ stripe: { webhookGateway: stripe, reconcileGateway: stripe } });
    expect(await h.run(['billing-reconcile'])).toBe(0);
    expect(h.out).toEqual(['checked 2, changed 1, unlinked 1, pruned 0', '  sub_2: UNKNOWN_TIER']);
  });

  it('billing-status prints the person’s Stripe mirror and each profile with and without grants (MUT-360 review)', async () => {
    const h = harness();
    await person(h, 'nour@studio.ps');
    expect(await h.run(['billing-status', '--email', 'nour@studio.ps'])).toBe(0);
    expect(h.out[0]).toMatch(/^nour@studio\.ps \(/);
    expect(h.out).toContain('  no Stripe customer linked');
    expect(h.out).toContain('  no subscription');
    expect(h.out.some((l) => /^ {2}profile .+: now READ_ONLY NONE · without grants READ_ONLY NONE$/.test(l))).toBe(true);
  });

  it('billing-status asks to confirm a payer billed outside the consumer countries with no tax ID (MUT-362 D9)', async () => {
    const checkout = new FakeCheckoutGateway();
    const stripe = new FakeStripeGateway(() => new Date());
    const h = harness({ stripe: { webhookGateway: stripe, reconcileGateway: stripe, checkoutGateway: checkout } });
    const user = await person(h, 'rana@studio.ps');
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_jo', userId: user.id, country: 'JO', currency: 'USD', at: new Date(), linkAudit: [] });
    expect(await h.run(['billing-status', '--email', 'rana@studio.ps'])).toBe(0);
    expect(h.out).toContain('  CHECK cus_jo: billed in JO, not open to consumers, and no tax ID — confirm it is a business');
  });
});

