import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { receiptStorageKey } from '../../attachments/rules.js';
import { MemoryAttachmentStorage } from '../../attachments/storage.js';
import { FakeAccountStripeGateway } from '../../billing/stripe/__tests__/fake.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { LedgerStore } from '../../repositories/ports.js';
import { closureDeadline, GRACE_MS } from '../closure.js';
import { MAX_PURGES_PER_RUN, runAccountPurge, type PurgeRunOptions } from '../purge-run.js';

/**
 * MUT-333 (D11, D12/R1): the hourly hard delete over the memory store, a fake Stripe and a memory bucket.
 */
const T0 = new Date(Date.UTC(2026, 9, 24, 10));
const DUE = new Date(T0.getTime() + GRACE_MS + 60_000);
const logger = pino({ level: 'silent' });
let seq = 0;

async function closingPerson(store: LedgerStore, at = T0) {
  const { user, personalOrganization } = await store.users.create({
    email: `purge${++seq}@studio.ps`,
    displayName: 'Rana',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    personal: { name: 'Personal', slug: `personal-${randomUUID()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at,
  });
  const session = await store.sessions.create({ userId: user.id, tokenDigest: randomUUID().replace(/-/g, '').padEnd(64, '0'), kind: 'cookie', at, idleExpiresAt: DUE, absoluteExpiresAt: DUE, userAgent: null });
  await store.users.requestClosure({ userId: user.id, at, deleteAfter: closureDeadline(at), endedSubscriptionIds: [], exceptSessionId: session.id, audit: [] });
  return { user, personalId: personalOrganization.id };
}

function world() {
  const store = new MemoryLedgerStore();
  const stripe = new FakeAccountStripeGateway();
  const storage = new MemoryAttachmentStorage();
  const run = (overrides: Partial<PurgeRunOptions> = {}) => runAccountPurge({ store, stripe, storage, logger, now: DUE, dryRun: false, ...overrides });
  return { store, stripe, storage, run };
}

describe('runAccountPurge (MUT-333)', () => {
  it('a dry run reports what would go and changes nothing', async () => {
    const { store, stripe, storage, run } = world();
    const { user, personalId } = await closingPerson(store);
    stripe.customer('cus_A', { email: user.email, userId: user.id });
    storage.put(receiptStorageKey(personalId, 'r1'), { sizeBytes: 1, contentType: null });

    const { summary, rows } = await run({ dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, due: 1, purged: 1, skipped: 0, failed: 0, storagePrefixesEmptied: 0 });
    expect(rows).toEqual([{ userId: user.id, outcome: 'would-purge', reason: null, deleteProfileIds: [personalId], transfers: [], leaveProfileIds: [], blockedProfileIds: [], stripeCustomers: 0 }]);
    expect(await store.users.getById(user.id)).not.toBeNull();
    expect((await store.users.getById(user.id))?.closure?.purgeStartedAt).toBeNull();
    expect(stripe.calls).toEqual([]);
    expect(storage.objects.size).toBe(1);
  });

  it('deletes a due account: its Stripe customers, its rows and its profiles’ files (AC4)', async () => {
    const { store, stripe, storage, run } = world();
    const { user, personalId } = await closingPerson(store);
    await store.billing.saveAccount({ stripeCustomerId: 'cus_MIRROR', userId: user.id, country: 'IL', currency: 'ILS', at: T0, linkAudit: [] });
    stripe.customer('cus_MIRROR', { email: user.email, userId: user.id }).customer('cus_ABANDONED', { email: user.email, userId: user.id }).customer('cus_SOMEONE', { email: user.email, userId: 'someone' });
    storage.put(receiptStorageKey(personalId, 'r1'), { sizeBytes: 1, contentType: null });
    storage.put('org/someone-else/expense-receipts/r2', { sizeBytes: 1, contentType: null });

    const { summary, rows } = await run();
    expect(summary).toMatchObject({ due: 1, purged: 1, storagePrefixesEmptied: 1, storagePending: 0, incomplete: false });
    expect(rows[0]).toMatchObject({ outcome: 'purged', deleteProfileIds: [personalId], stripeCustomers: 2 });
    expect(await store.users.getById(user.id)).toBeNull();
    expect(stripe.customers.get('cus_MIRROR')?.deleted).toBe(true);
    expect(stripe.customers.get('cus_ABANDONED')?.deleted).toBe(true);
    expect(stripe.customers.get('cus_SOMEONE')?.deleted).toBe(false);
    expect([...storage.objects.keys()]).toEqual(['org/someone-else/expense-receipts/r2']);
  });

  it('leaves an account in its grace alone', async () => {
    const { store, run } = world();
    const { user } = await closingPerson(store, new Date(DUE.getTime() - GRACE_MS + DAY_MS));
    const { summary } = await run();
    expect(summary).toMatchObject({ closing: 1, due: 0, purged: 0 });
    expect(await store.users.getById(user.id)).not.toBeNull();
  });

  it('skips a person when Stripe fails, keeps the claim (no cancel can win), and deletes them on the next run', async () => {
    const { store, stripe, run } = world();
    const { user } = await closingPerson(store);
    stripe.customer('cus_A', { email: user.email, userId: user.id });
    stripe.failOn('deleteCustomer');
    const first = await run();
    expect(first.rows[0]).toMatchObject({ outcome: 'skipped', reason: 'stripe-failed' });
    expect((await store.users.getById(user.id))?.closure?.purgeStartedAt).not.toBeNull();
    expect(await store.users.cancelClosure({ userId: user.id, at: T0, audit: [] })).toBeNull();

    const second = await run({ now: new Date(DUE.getTime() + 3_600_000) });
    expect(second.rows[0]).toMatchObject({ outcome: 'purged' });
    expect(await store.users.getById(user.id)).toBeNull();
  });

  it('skips a person with a Stripe customer while Stripe is not configured; one without is deleted', async () => {
    const { store, run } = world();
    const payer = await closingPerson(store);
    await store.billing.saveAccount({ stripeCustomerId: 'cus_X', userId: payer.user.id, country: 'IL', currency: 'ILS', at: T0, linkAudit: [] });
    const other = await closingPerson(store);
    const { rows } = await run({ stripe: null });
    expect(rows.find((r) => r.userId === payer.user.id)).toMatchObject({ outcome: 'skipped', reason: 'stripe-unavailable' });
    expect(rows.find((r) => r.userId === other.user.id)).toMatchObject({ outcome: 'purged' });
  });

  it('keeps a deleted profile’s prefix queued while the bucket fails or is not configured, and empties it later (R1)', async () => {
    const { store, storage, run } = world();
    const { personalId } = await closingPerson(store);
    storage.put(receiptStorageKey(personalId, 'r1'), { sizeBytes: 1, contentType: null });
    const first = await run({ storage: null });
    expect(first.summary).toMatchObject({ purged: 1, storagePrefixesEmptied: 0, storagePending: 1 });
    const second = await run();
    expect(second.summary).toMatchObject({ purged: 0, storagePrefixesEmptied: 1, storagePending: 0 });
    expect(storage.objects.size).toBe(0);
  });

  it('stops at the per-run cap and at the time budget, saying the run is incomplete (D11, R13)', async () => {
    const { store, run } = world();
    for (let i = 0; i < 3; i++) await closingPerson(store);
    const capped = await run({ maxPeople: 2 });
    expect(capped.summary).toMatchObject({ due: 3, purged: 2, incomplete: true });
    expect(MAX_PURGES_PER_RUN).toBe(25);

    const { store: other, run: runOther } = world();
    for (let i = 0; i < 2; i++) await closingPerson(other);
    let ticks = 0;
    const timed = await runOther({ budgetMs: 1, elapsedMs: () => ticks++ });
    expect(timed.summary).toMatchObject({ purged: 1, incomplete: true });
  });

  it('skips an account whose created profile others belong to, before touching Stripe (R18)', async () => {
    const { store, stripe, run } = world();
    const { user } = await closingPerson(store);
    const { user: bookkeeper } = await store.users.create({ email: `bk${++seq}@studio.ps`, displayName: 'Omar', passwordHash: null, locale: 'en', personal: { name: 'P', slug: `p-${randomUUID()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: T0 });
    const created = await store.organizations.createOwned(user.id, { name: 'Firm', slug: `f-${randomUUID()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: T0 }, 6, { actorId: user.id, requestId: null });
    if (created.kind !== 'created') throw new Error('cap');
    await store.organizations.setFirm(created.organization.id, { enabled: true, ownerUserIds: [] }, T0, { actorId: null, requestId: null });
    await store.memberships.grant(bookkeeper.id, created.organization.id, T0);
    stripe.customer('cus_A', { email: user.email, userId: user.id });

    const { rows } = await run();
    expect(rows[0]).toMatchObject({ outcome: 'skipped', reason: 'has-members', blockedProfileIds: [created.organization.id] });
    expect(stripe.customers.get('cus_A')?.deleted).toBe(false);
    expect(await store.users.getById(user.id)).not.toBeNull();
    const dry = await run({ dryRun: true });
    expect(dry.rows[0]).toMatchObject({ outcome: 'skipped', reason: 'has-members' });
  });

  it('one person’s failure never stops the run', async () => {
    const { store, run } = world();
    const broken = await closingPerson(store);
    const fine = await closingPerson(store);
    const purge = store.accountPurge.purge.bind(store.accountPurge);
    store.accountPurge.purge = async (userId, at) => {
      if (userId === broken.user.id) throw new Error('boom');
      return purge(userId, at);
    };
    const { summary, rows } = await run();
    expect(summary).toMatchObject({ purged: 1, failed: 1 });
    expect(rows.find((r) => r.userId === broken.user.id)).toMatchObject({ outcome: 'failed', reason: 'error' });
    expect(await store.users.getById(fine.user.id)).toBeNull();
  });
});

const DAY_MS = 86_400_000;
