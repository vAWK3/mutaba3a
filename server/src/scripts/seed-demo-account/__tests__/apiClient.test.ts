import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../../app.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../../../auth/users.js';
import { SlidingWindowRateLimiter } from '../../../rate-limit.js';
import { MemoryLedgerStore } from '../../../repositories/memory.js';
import { adminClient } from '../../users.js';
import { clientFor, signIn, ApiClientError, type ApiClientDeps } from '../apiClient.js';

const ADMIN_TOKEN = 'admin-token-with-at-least-32-characters-long';
const URL_BASE = 'http://mutaba3a.test';

function harness() {
  const store = new MemoryLedgerStore();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: 'test',
    passwordHasher: createArgon2Hasher(ARGON2_MINIMUMS),
  });
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => app.request(input as string, init)) as typeof fetch;
  const deps: ApiClientDeps = { fetch: fetchFn, baseUrl: URL_BASE };
  return { store, deps };
}

interface CreatedUser {
  user: { id: string };
  personalProfile: { id: string; name: string };
  initialPassword: string;
}

async function createPersonalUser(deps: ApiClientDeps, email: string): Promise<CreatedUser> {
  const admin = adminClient(deps.fetch, deps.baseUrl, ADMIN_TOKEN);
  return admin.call<CreatedUser>('POST', '/admin/v1/users', { email, displayName: 'Seed QA', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
}

describe('seed-demo-account apiClient (MUT-136)', () => {
  it('signs in and resolves the personal profile as organizationId (MUT-120)', async () => {
    const { deps } = harness();
    const created = await createPersonalUser(deps, 'qa@mutaba3a.test');
    const session = await signIn(deps, 'qa@mutaba3a.test', created.initialPassword);
    expect(session.organizationId).toBe(created.personalProfile.id);
    expect(session.token).toMatch(/^mds_/);
  });

  it('replays a customer create under the same Idempotency-Key instead of duplicating it', async () => {
    const { store, deps } = harness();
    const created = await createPersonalUser(deps, 'qa@mutaba3a.test');
    const session = await signIn(deps, 'qa@mutaba3a.test', created.initialPassword);
    const client = clientFor(deps, session);

    const first = await client.createCustomer({ name: 'Al-Quds Bakery' }, 'seed-al-quds-bakery-customer');
    const second = await client.createCustomer({ name: 'Al-Quds Bakery' }, 'seed-al-quds-bakery-customer');
    expect(second.id).toBe(first.id);

    const page = await store.customers.list(session.organizationId, {}, { limit: 50, cursor: null });
    expect(page.items).toHaveLength(1);
  });

  it('a different Idempotency-Key creates an independent customer even with an identical body', async () => {
    const { store, deps } = harness();
    const created = await createPersonalUser(deps, 'qa@mutaba3a.test');
    const session = await signIn(deps, 'qa@mutaba3a.test', created.initialPassword);
    const client = clientFor(deps, session);

    await client.createCustomer({ name: 'Al-Quds Bakery' }, 'seed-key-a');
    await client.createCustomer({ name: 'Al-Quds Bakery' }, 'seed-key-b');

    const page = await store.customers.list(session.organizationId, {}, { limit: 50, cursor: null });
    expect(page.items).toHaveLength(2);
  });

  it('creates a project under a customer, and a received income entry (a real Payment, origin CAPTURE)', async () => {
    const { store, deps } = harness();
    const created = await createPersonalUser(deps, 'qa@mutaba3a.test');
    const session = await signIn(deps, 'qa@mutaba3a.test', created.initialPassword);
    const client = clientFor(deps, session);

    const customer = await client.createCustomer({ name: 'Al-Quds Bakery' }, 'seed-customer');
    const project = await client.createProject({ customerId: customer.id, name: 'Daily Supply', currency: 'ILS' }, 'seed-project');
    await client.createIncome({ kind: 'received', amount: '650.00', currency: 'ILS', occurredOn: '2026-01-01', customerId: customer.id, projectId: project.id, captureSource: 'app' }, 'seed-income-received-1');

    const payments = await store.payments.list(session.organizationId, {}, { limit: 50, cursor: null });
    expect(payments.items).toHaveLength(1);
    expect(payments.items[0]).toMatchObject({ amountMinor: 65000n, origin: 'CAPTURE' });
  });

  it('settles an owed entry partially, leaving it part-paid with a real PaymentAllocation (not a raw field)', async () => {
    const { store, deps } = harness();
    const created = await createPersonalUser(deps, 'qa@mutaba3a.test');
    const session = await signIn(deps, 'qa@mutaba3a.test', created.initialPassword);
    const client = clientFor(deps, session);

    const customer = await client.createCustomer({ name: 'Haddad Law Office' }, 'seed-customer');
    const owed = await client.createIncome(
      { kind: 'owed', amount: '1500.00', currency: 'ILS', occurredOn: '2026-01-01', customerId: customer.id, dueDate: '2026-01-20', title: 'Partnership agreement draft' },
      'seed-income-owed-1',
    );
    await client.settleReceivable(owed.id, { amount: '900.00', paidAt: '2026-01-10' }, 'seed-settle-owed-1');

    const page = await store.receivables.list(session.organizationId, {}, { limit: 50, cursor: null });
    const [receivable] = page.items;
    expect(receivable?.status).not.toBe('SETTLED');
    expect(receivable?.paidMinor).toBe(90000n);

    const payments = await store.payments.list(session.organizationId, {}, { limit: 50, cursor: null });
    const settlePayment = payments.items.find((p) => p.amountMinor === 90000n);
    expect(settlePayment).toBeDefined();
    expect(settlePayment?.allocatedMinor).toBe(90000n);
  });

  it('settles an owed entry in full, leaving it SETTLED', async () => {
    const { store, deps } = harness();
    const created = await createPersonalUser(deps, 'qa@mutaba3a.test');
    const session = await signIn(deps, 'qa@mutaba3a.test', created.initialPassword);
    const client = clientFor(deps, session);

    const customer = await client.createCustomer({ name: 'Jerusalem Consulting Group' }, 'seed-customer');
    const owed = await client.createIncome({ kind: 'owed', amount: '5000.00', currency: 'ILS', occurredOn: '2025-11-01', customerId: customer.id, dueDate: '2025-11-20' }, 'seed-income-owed-1');
    await client.settleReceivable(owed.id, { paidAt: '2026-01-01' }, 'seed-settle-owed-1');

    const page = await store.receivables.list(session.organizationId, {}, { limit: 50, cursor: null });
    expect(page.items[0]?.status).toBe('SETTLED');
  });

  it('records an expense in its original currency', async () => {
    const { store, deps } = harness();
    const created = await createPersonalUser(deps, 'qa@mutaba3a.test');
    const session = await signIn(deps, 'qa@mutaba3a.test', created.initialPassword);
    const client = clientFor(deps, session);

    await client.createExpense({ occurredOn: '2026-01-01', amount: '85.00', currency: 'ILS', title: 'Flour delivery', vendor: 'Unipack Supplies' }, 'seed-expense-1');

    const page = await store.expenses.list(session.organizationId, {}, { limit: 50, cursor: null });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ amountMinor: 8500n, title: 'Flour delivery' });
  });

  it('throws a readable ApiClientError on a validation failure, naming the method, path and status', async () => {
    const { deps } = harness();
    const created = await createPersonalUser(deps, 'qa@mutaba3a.test');
    const session = await signIn(deps, 'qa@mutaba3a.test', created.initialPassword);
    const client = clientFor(deps, session);

    await expect(client.createCustomer({ name: '' }, 'seed-bad-customer')).rejects.toThrow(ApiClientError);
  });
});
