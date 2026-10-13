import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../app.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../../auth/users.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { runSeedDemoAccount, type SeedDemoAccountDeps } from '../seed-demo-account.js';

const ADMIN_TOKEN = 'admin-token-with-at-least-32-characters-long';
const URL_BASE = 'http://mutaba3a.test';

function harness(initialNow: () => Date = () => new Date('2026-06-15T12:00:00Z')) {
  // The server's own clock and the script's clock are never actually independent — there is
  // only one wall clock. `current` lets a test move both together to simulate a later re-run,
  // instead of freezing the server's "today" while the script thinks time has passed (which
  // would make every seeded date look future-dated and fail ADR-038 for the wrong reason).
  let current = initialNow;
  const store = new MemoryLedgerStore();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: 'test',
    passwordHasher: createArgon2Hasher(ARGON2_MINIMUMS),
    now: () => current(),
  });
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => app.request(input as string, init)) as typeof fetch;
  const out: string[] = [];
  const err: string[] = [];
  const run = (argv: string[] = [], runNow: () => Date = initialNow, adminToken: string | null = ADMIN_TOKEN, seedPassword?: string) => {
    current = runNow;
    return runSeedDemoAccount(argv, { fetch: fetchFn, url: URL_BASE, adminToken: adminToken ?? undefined, seedPassword, now: runNow, out: (l) => out.push(l), err: (l) => err.push(l) } satisfies SeedDemoAccountDeps);
  };
  return { store, run, out, err };
}

async function allOrganizationEntities(store: MemoryLedgerStore, organizationId: string) {
  const [customers, projects, income, expenses] = await Promise.all([
    store.customers.list(organizationId, {}, { limit: 200, cursor: null }),
    store.projects.list(organizationId, {}, { limit: 200, cursor: null }),
    store.receivables.list(organizationId, {}, { limit: 200, cursor: null }),
    store.expenses.list(organizationId, {}, { limit: 200, cursor: null }),
  ]);
  const payments = await store.payments.list(organizationId, {}, { limit: 200, cursor: null });
  return { customers: customers.items, projects: projects.items, receivables: income.items, expenses: expenses.items, payments: payments.items };
}

describe('seed-demo-account CLI (MUT-136)', () => {
  it('seeds 8 clients with realistic, populated data and prints sign-in credentials', async () => {
    const h = harness();
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.out.join('\n')).toContain('seeded 8 customers');
    expect(h.out.some((l) => l.startsWith('  email:'))).toBe(true);
    expect(h.out.some((l) => l.startsWith('  password:'))).toBe(true);

    const organizationId = (await h.store.users.findByEmail('qa@mutaba3a.test'))!.id;
    const memberships = await h.store.memberships.listByUser(organizationId);
    const entities = await allOrganizationEntities(h.store, memberships[0]!.organizationId);
    expect(entities.customers).toHaveLength(8);
    expect(entities.projects).toHaveLength(8);
    expect(entities.receivables.length).toBeGreaterThan(0);
    expect(entities.payments.length).toBeGreaterThan(0);
    expect(entities.expenses.length).toBeGreaterThan(0);
  });

  it('includes at least one part-paid and one fully-settled receivable (TD-063 guard: real PaymentAllocations, not a raw field)', async () => {
    const h = harness();
    await h.run();
    const organizationId = (await h.store.users.findByEmail('qa@mutaba3a.test'))!.id;
    const memberships = await h.store.memberships.listByUser(organizationId);
    const { receivables, payments } = await allOrganizationEntities(h.store, memberships[0]!.organizationId);

    const settled = receivables.filter((r) => r.status === 'SETTLED');
    const partPaid = receivables.filter((r) => r.status !== 'SETTLED' && r.paidMinor > 0n);
    expect(settled.length).toBeGreaterThan(0);
    expect(partPaid.length).toBeGreaterThan(0);

    for (const r of partPaid) {
      const allocatedToThis = payments.filter((p) => p.amountMinor === r.paidMinor);
      expect(allocatedToThis.length).toBeGreaterThan(0);
    }
  });

  it('never dates a receivable or payment later than the day the script ran (ADR-038)', async () => {
    const today = '2026-06-15';
    const h = harness(() => new Date(`${today}T12:00:00Z`));
    await h.run();
    const organizationId = (await h.store.users.findByEmail('qa@mutaba3a.test'))!.id;
    const memberships = await h.store.memberships.listByUser(organizationId);
    const { payments } = await allOrganizationEntities(h.store, memberships[0]!.organizationId);
    for (const payment of payments) {
      expect(payment.receivedOn <= today).toBe(true);
    }
  });

  it('re-running the same day replays every write instead of duplicating it', async () => {
    const h = harness();
    await h.run();
    const organizationId = (await h.store.users.findByEmail('qa@mutaba3a.test'))!.id;
    const membershipsBefore = await h.store.memberships.listByUser(organizationId);
    const before = await allOrganizationEntities(h.store, membershipsBefore[0]!.organizationId);

    const code = await h.run();
    expect(code).toBe(0);
    const membershipsAfter = await h.store.memberships.listByUser(organizationId);
    const after = await allOrganizationEntities(h.store, membershipsAfter[0]!.organizationId);

    expect(after.customers).toHaveLength(before.customers.length);
    expect(after.projects).toHaveLength(before.projects.length);
    expect(after.receivables).toHaveLength(before.receivables.length);
    expect(after.payments).toHaveLength(before.payments.length);
    expect(after.expenses).toHaveLength(before.expenses.length);

    // Still exactly one account — the admin get-or-create path didn't fork a second user.
    const allUsers = await h.store.organizations.list();
    expect(allUsers.filter((o) => o.personalOwnerUserId)).toHaveLength(1);
  });

  it('re-running on a later day reuses the same customers and projects, adding only fresh transactions', async () => {
    const h = harness(() => new Date('2026-06-15T12:00:00Z'));
    await h.run();
    const organizationId = (await h.store.users.findByEmail('qa@mutaba3a.test'))!.id;
    const memberships = await h.store.memberships.listByUser(organizationId);
    const before = await allOrganizationEntities(h.store, memberships[0]!.organizationId);

    const code = await h.run([], () => new Date('2026-07-20T12:00:00Z'));
    expect(code).toBe(0);
    const after = await allOrganizationEntities(h.store, memberships[0]!.organizationId);

    expect(after.customers).toHaveLength(before.customers.length);
    expect(after.projects).toHaveLength(before.projects.length);
    expect(after.payments.length).toBeGreaterThan(before.payments.length);
  });

  it('rotates the account password every run, and the printed password always signs in', async () => {
    const h = harness();
    await h.run();
    const firstPassword = h.out.find((l) => l.startsWith('  password:'))!.split(': ')[1]!;
    h.out.length = 0;
    const code = await h.run();
    expect(code).toBe(0);
    const secondPassword = h.out.find((l) => l.startsWith('  password:'))!.split(': ')[1]!;
    expect(secondPassword).not.toBe(firstPassword);
  });

  it('with MUTABA3A_SEED_PASSWORD set, re-seeds without changing the password or printing it', async () => {
    const h = harness();
    await h.run();
    const issued = h.out.find((l) => l.startsWith('  password:'))!.split(': ')[1]!;
    h.out.length = 0;

    const code = await h.run([], undefined, ADMIN_TOKEN, issued);
    expect(code).toBe(0);
    expect(h.out.join('\n')).toContain('seeded 8 customers');
    expect(h.out.join('\n')).not.toContain(issued);
    expect(h.out.some((l) => l.includes('password unchanged'))).toBe(true);
  });

  it('with a wrong MUTABA3A_SEED_PASSWORD, fails with a clear message instead of rotating', async () => {
    const h = harness();
    await h.run();
    const issued = h.out.find((l) => l.startsWith('  password:'))!.split(': ')[1]!;

    const code = await h.run([], undefined, ADMIN_TOKEN, 'not-the-issued-password');
    expect(code).not.toBe(0);
    expect(h.err.join('\n')).toContain('MUTABA3A_SEED_PASSWORD');
    // The issued password is untouched, so whoever holds it can still sign in.
    h.out.length = 0;
    expect(await h.run([], undefined, ADMIN_TOKEN, issued)).toBe(0);
  });

  it('rejects an empty or malformed --url (an unset shell variable) before calling anything', async () => {
    const h = harness();
    for (const url of ['', 'not a url']) {
      h.err.length = 0;
      const code = await h.run(['--url', url]);
      expect(code).toBe(2);
      expect(h.err.join('\n')).toContain('--url');
    }
    expect(await h.store.users.findByEmail('qa@mutaba3a.test')).toBeNull();
  });

  it('fails without MUTABA3A_ADMIN_TOKEN, printing a clear message and seeding nothing', async () => {
    const h = harness();
    const code = await h.run([], undefined, null);
    expect(code).not.toBe(0);
    expect(h.err.join('\n')).toContain('MUTABA3A_ADMIN_TOKEN');
    expect(await h.store.users.findByEmail('qa@mutaba3a.test')).toBeNull();
  });
});
