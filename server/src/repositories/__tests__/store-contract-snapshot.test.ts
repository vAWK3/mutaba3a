import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../app.js';
import { SCOPES } from '../../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/** A freshly minted API key for an existing organization, over the given store. Keys are ephemeral (never part of a snapshot), so each store this test reads through needs its own. */
async function apiKeyFor(store: MemoryLedgerStore, organizationId: string): Promise<string> {
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
  });
  const key = (await read(await app.request(`/admin/v1/organizations/${organizationId}/api-keys`, json({ name: 'reader', scopes: SCOPES }, admin)))) as { secret: string };
  return key.secret;
}

/** GET /v1/customers, GET /v1/receivables/{id} and GET /v1/summaries/organization, over the given store, authenticated with a key minted on the spot. */
async function readsFor(store: MemoryLedgerStore, organizationId: string, receivableId: string) {
  const secret = await apiKeyFor(store, organizationId);
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(100_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
  });
  const auth = { authorization: `Bearer ${secret}` };
  const customers = await read(await app.request('/v1/customers', { headers: auth }));
  const receivable = await read(await app.request(`/v1/receivables/${receivableId}`, { headers: auth }));
  const summary = await read(await app.request('/v1/summaries/organization', { headers: auth }));
  return { customers, receivable, summary };
}

/**
 * MUT-286 Phase A item 6: a representative mutation sequence — customer,
 * project, Owed income, a partial settle, an expense, a profile — snapshotted
 * and restored into a fresh store, then read back through the real routes
 * (not the repository directly, so the actual summary computation and
 * serializers are exercised) and compared to the pre-snapshot store.
 */
describe('MemoryLedgerStore snapshot/restore (MUT-286)', () => {
  it('a restored store answers identically to the store it was snapshotted from', async () => {
    const unique = () => Math.random().toString(36).slice(2, 10);
    const at = (ms: number) => new Date(Date.UTC(2026, 9, 18, 9, 0, 0, ms));

    const source = new MemoryLedgerStore();
    const org = await source.organizations.create({ name: 'Studio', slug: `studio-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

    // a profile: the user who makes every capture below, and a second organization they own
    const { user } = await source.users.create({
      email: `owner-${unique()}@studio.ps`,
      displayName: 'Rana Saleh',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
      locale: 'en',
      organizationId: org.id,
      personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: at(6),
    });
    const ownedResult = await source.organizations.createOwned(
      user.id,
      { name: 'My Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: at(7) },
      6,
      { actorId: user.id, requestId: 'req-profile' },
    );
    expect(ownedResult.kind).toBe('created');

    // customer, project
    const customer = await source.customers.create({ organizationId: org.id, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at(0));
    const project = await source.projects.create({ organizationId: org.id, customerId: customer.id, name: 'Sale', currency: 'ILS' }, at(1));

    // Owed income (an adjustment receivable)
    const owed = await source.receivables.createAdjustment(
      {
        organizationId: org.id,
        customerId: customer.id,
        projectId: project.id,
        currency: 'ILS',
        netMinor: 100_000n,
        vatMinor: 0n,
        grossMinor: 100_000n,
        vatTreatment: 'EXEMPT',
        vatRateBasisPoints: 0,
        title: 'Consulting',
        dueDate: '2026-11-15',
        postingDate: '2026-10-18',
        postedAt: at(2),
        createdByUserId: user.id,
        requestId: null,
      },
      at(2),
    );

    // a partial settle: a payment allocated for less than the receivable's gross
    await source.payments.create(
      {
        organizationId: org.id,
        customerId: customer.id,
        projectId: null,
        currency: 'ILS',
        amountMinor: 40_000n,
        receivedOn: '2026-10-19',
        method: 'BANK',
        reference: 'TRX-1',
        receiptNumber: null,
        notes: null,
        replacesPaymentId: null,
        requestId: 'req-settle',
        createdByUserId: null,
        origin: 'INTEGRATION',
        captureSource: null,
        allocations: [{ receivableId: owed.id, amountMinor: 40_000n }],
      },
      at(3),
    );

    // an expense
    const category = await source.expenseCategories.create(org.id, { name: 'Travel', color: '#0ea5e9' }, at(4));
    await source.expenses.create(
      { organizationId: org.id, occurredOn: '2026-10-18', amountMinor: 5_000n, currency: 'ILS', title: 'Taxi', vendor: 'Taxi co', categoryId: category.id, customerId: null, projectId: null, notes: null, createdByUserId: user.id },
      at(5),
    );

    const before = await readsFor(source, org.id, owed.id);

    const snapshot = source.snapshot();
    const restored = new MemoryLedgerStore();
    restored.restore(snapshot);

    const after = await readsFor(restored, org.id, owed.id);

    expect(after.customers).toEqual(before.customers);
    expect(after.receivable).toEqual(before.receivable);
    expect(after.summary).toEqual(before.summary);

    // Sanity: the reads actually reflect the mutation sequence, not two empty stores agreeing by vacuity.
    expect(before.customers.items).toHaveLength(1);
    expect(before.receivable).toMatchObject({ id: owed.id, gross: '1000.00', paid: '400.00', outstanding: '600.00', status: 'PARTIALLY_PAID' });
  });
});
