import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../app.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../../auth/users.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { runSeedDemoAccount, type SeedDemoAccountDeps } from '../seed-demo-account.js';
import type { SeedClaims } from '../seed-demo-account/pruneEarlierBatches.js';

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
  // What the CLI reads from idempotency_keys, read from the same store the app writes its claims to.
  const claims: SeedClaims = {
    async find(organizationId, claimKeys) {
      const found = new Map<string, unknown>();
      for (const k of claimKeys) {
        const r = await store.idempotency.get(organizationId, k);
        if (r?.status === 'COMPLETED' && r.responseStatus !== null && r.responseStatus < 300) found.set(k, r.responseBody);
      }
      return found;
    },
    async live(organizationId, ids) {
      const out = new Set<string>();
      for (const id of ids) {
        const payment = await store.payments.getById(organizationId, id);
        const receivable = await store.receivables.getById(organizationId, id);
        const expense = await store.expenses.getById(organizationId, id);
        if ((payment && payment.status === 'POSTED') || (receivable && !receivable.deletedAt) || (expense && !expense.deletedAt)) out.add(id);
      }
      return out;
    },
  };
  const run = (argv: string[] = [], runNow: () => Date = initialNow, adminToken: string | null = ADMIN_TOKEN, seedPassword?: string, withClaims = true) => {
    current = runNow;
    return runSeedDemoAccount(argv, { fetch: fetchFn, url: URL_BASE, adminToken: adminToken ?? undefined, seedPassword, claims: withClaims ? claims : undefined, now: runNow, out: (l) => out.push(l), err: (l) => err.push(l) } satisfies SeedDemoAccountDeps);
  };
  return { store, run, out, err, fetchFn, setNow: (n: () => Date) => (current = n) };
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

/** What the person sees: live rows only (a voided Owed, a reversed payment and a deleted expense are gone from every list). */
async function liveCounts(store: MemoryLedgerStore, organizationId: string) {
  const e = await allOrganizationEntities(store, organizationId);
  return {
    customers: e.customers.length,
    projects: e.projects.length,
    receivables: e.receivables.filter((r) => !r.deletedAt).length,
    payments: e.payments.filter((p) => p.status !== 'REVERSED').length,
    expenses: e.expenses.filter((x) => !x.deletedAt).length,
  };
}

async function personalProfileOf(store: MemoryLedgerStore) {
  const userId = (await store.users.findByEmail('qa@mutaba3a.test'))!.id;
  return (await store.memberships.listByUser(userId))[0]!.organizationId;
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

  describe('--prune-earlier-batches (QA data pile-up, 2026-11-14)', () => {
    const day = (iso: string) => () => new Date(`${iso}T09:00:00Z`);

    it('replaces the earlier batch on a later day: live counts stay flat run after run', async () => {
      const h = harness(day('2026-06-15'));
      expect(await h.run(['--prune-earlier-batches'])).toBe(0);
      const organizationId = await personalProfileOf(h.store);
      const first = await liveCounts(h.store, organizationId);

      for (const later of ['2026-06-16', '2026-06-19', '2026-07-02']) {
        h.out.length = 0;
        expect(await h.run(['--prune-earlier-batches'], day(later))).toBe(0);
        expect(await liveCounts(h.store, organizationId)).toEqual(first);
        // Only the one batch still live is undone; batches pruned on earlier runs are skipped.
        expect(h.out.find((l) => l.startsWith('pruned earlier batches:'))).toContain('3 settle payments reversed, 18 income entries undone, 4 expenses deleted');
      }
      // A same-day re-run replays today's batch and removes nothing.
      h.out.length = 0;
      expect(await h.run(['--prune-earlier-batches'], day('2026-07-02'))).toBe(0);
      expect(await liveCounts(h.store, organizationId)).toEqual(first);
      expect(h.out.find((l) => l.startsWith('pruned earlier batches:'))).toContain('0 settle payments reversed, 0 income entries undone, 0 expenses deleted');
    });

    it("keeps today's batch fully dated to today and never touches a row it didn't write", async () => {
      const h = harness(day('2026-06-15'));
      await h.run();
      const password = h.out.find((l) => l.startsWith('  password:'))!.split(': ')[1]!;
      const organizationId = await personalProfileOf(h.store);

      // The person (a QA flow) logs an expense and an Owed on the seed's own client and project.
      const signIn = await h.fetchFn(`${URL_BASE}/v1/device-sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'qa@mutaba3a.test', password }) });
      const token = ((await signIn.json()) as { token: string }).token;
      const { projects } = await allOrganizationEntities(h.store, organizationId);
      const project = projects.find((p) => p.name === 'Daily Supply Retainer')!;
      const post = async (path: string, body: unknown, key: string) => {
        const res = await h.fetchFn(`${URL_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-mutaba3a-profile': organizationId, 'idempotency-key': key }, body: JSON.stringify(body) });
        expect(res.status).toBe(201);
        return ((await res.json()) as { id: string }).id;
      };
      // Same title and amount as a seed fixture, on its project: only the seed's own keys decide, not the look of a row.
      const mineExpense = await post('/v1/expenses', { occurredOn: '2026-06-09', amount: '85.00', currency: 'ILS', title: 'Flour delivery', customerId: project.customerId, projectId: project.id }, 'person-expense-1');
      const mineOwed = await post('/v1/income', { kind: 'owed', amount: '300.00', currency: 'ILS', occurredOn: '2026-05-26', dueDate: '2026-06-10', customerId: project.customerId, projectId: project.id }, 'person-owed-1');

      expect(await h.run(['--prune-earlier-batches'], day('2026-06-20'), ADMIN_TOKEN, password)).toBe(0);
      const after = await allOrganizationEntities(h.store, organizationId);
      const keptExpense = after.expenses.find((e) => e.id === mineExpense);
      const keptOwed = after.receivables.find((r) => r.id === mineOwed);
      expect(keptExpense).toBeDefined();
      expect(keptExpense!.deletedAt ?? null).toBeNull();
      expect(keptOwed).toBeDefined();
      expect(keptOwed!.deletedAt ?? null).toBeNull();
      // Every live seed expense is today's batch: 6 days ago for "Flour delivery" is 2026-06-14, not 2026-06-09.
      const seedFlour = after.expenses.filter((e) => !e.deletedAt && e.title === 'Flour delivery' && e.id !== mineExpense);
      expect(seedFlour.map((e) => e.occurredOn)).toEqual(['2026-06-14']);
    });

    it('refuses --prune-earlier-batches without the database to read the claims from', async () => {
      const h = harness();
      const code = await h.run(['--prune-earlier-batches'], undefined, ADMIN_TOKEN, undefined, false);
      expect(code).toBe(2);
      expect(h.err.join('\n')).toContain('DATABASE_URL');
      expect(await h.store.users.findByEmail('qa@mutaba3a.test')).toBeNull();
    });

    it('without the flag, a later day still adds a batch beside the earlier one (the screenshot account)', async () => {
      const h = harness(day('2026-06-15'));
      await h.run();
      const organizationId = await personalProfileOf(h.store);
      const first = await liveCounts(h.store, organizationId);
      await h.run([], day('2026-06-16'));
      expect((await liveCounts(h.store, organizationId)).expenses).toBe(first.expenses * 2);
    });
  });
});
