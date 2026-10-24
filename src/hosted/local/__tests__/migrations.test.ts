import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { LOCAL_FORMAT_VERSION, migrate, type StoredSnapshot } from '../migrations/index.js';

/** The local snapshot's format migrations (D1, brief §2.5): a device's older snapshot opens in this build's shape. */

const AT = new Date('2026-10-01T08:00:00.000Z');

/** A format-1 snapshot, as a device saved it before MUT-300: no firm fields on profiles, no role on memberships. */
async function formatOneSnapshot(): Promise<StoredSnapshot> {
  const store = new MemoryLedgerStore();
  await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
  const { maps } = store.snapshot();
  const without = (record: object, fields: string[]) => Object.fromEntries(Object.entries(record).filter(([field]) => !fields.includes(field)));
  const orgs = new Map([...maps.orgs].map(([id, org]) => [id, without(org, ['firmEnabledAt', 'firmRequestedAt', 'firmRequestedByUserId'])]));
  const members = new Map([...maps.members].map(([key, membership]) => [key, without(membership, ['role'])]));
  return { formatVersion: 1, stateVersion: 3, savedAt: AT, maps: { ...maps, orgs, members } as unknown as StoredSnapshot['maps'] };
}

/** A format-2 snapshot, as a device saved it before MUT-255: a receipt on an expense with none of the library fields. */
async function formatTwoSnapshot(): Promise<StoredSnapshot> {
  const store = new MemoryLedgerStore();
  const { user, personalOrganization: personal } = await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'JOD', timezone: 'Asia/Amman' }, at: AT });
  const expense = await store.expenses.create({ organizationId: personal.id, occurredOn: '2026-10-01', amountMinor: 1_000n, currency: 'JOD', title: null, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, AT);
  // 22:30 UTC on 1 Oct is already 2 Oct in Amman.
  await store.expenseReceipts.create({ organizationId: personal.id, expenseId: expense.id, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, receivedOn: 'ignored', uploadedByUserId: user.id, requestId: null }, new Date('2026-10-01T22:30:00.000Z'));
  const { maps } = store.snapshot();
  const library = ['filingStatus', 'receivedOn', 'suggested', 'approved', 'approvedAt', 'approvedByUserId', 'version'];
  const expReceipts = new Map([...maps.expReceipts].map(([id, r]) => [id, Object.fromEntries(Object.entries(r).filter(([field]) => !library.includes(field)))]));
  return { formatVersion: 2, stateVersion: 7, savedAt: AT, maps: { ...maps, expReceipts } as unknown as StoredSnapshot['maps'] };
}

describe('local snapshot migrations', () => {
  it('runs up to the current format', async () => {
    expect((migrate(await formatOneSnapshot())).formatVersion).toBe(LOCAL_FORMAT_VERSION);
  });

  it('1 → 2 (MUT-300): profiles arrive with firm features off and nothing requested; memberships as OWNER', async () => {
    const before = await formatOneSnapshot();

    const after = migrate(before);

    expect([...after.maps.orgs.values()]).toEqual([...before.maps.orgs.values()].map((org) => ({ ...org, firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null })));
    expect([...after.maps.members.values()]).toEqual([...before.maps.members.values()].map((m) => ({ ...m, role: 'OWNER' })));
    expect(after.stateVersion).toBe(before.stateVersion);
  });

  it('2 → 3 (MUT-255): receipts arrive FILED, never approved, at version 1, received on their upload day in the profile timezone', async () => {
    const before = await formatTwoSnapshot();

    const after = migrate(before);

    expect(after.formatVersion).toBe(LOCAL_FORMAT_VERSION);
    expect([...after.maps.expReceipts.values()]).toEqual(
      [...before.maps.expReceipts.values()].map((r) => ({ ...r, filingStatus: 'FILED', receivedOn: '2026-10-02', suggested: null, approved: null, approvedAt: null, approvedByUserId: null, version: 1 })),
    );
  });

  it('3 → 4 (MUT-366): people arrive with no verified address', async () => {
    const store = new MemoryLedgerStore();
    await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
    const { maps } = store.snapshot();
    const people = new Map([...maps.people].map(([id, p]) => [id, Object.fromEntries(Object.entries(p).filter(([field]) => field !== 'emailVerifiedAt'))]));
    const before: StoredSnapshot = { formatVersion: 3, stateVersion: 2, savedAt: AT, maps: { ...maps, people } as unknown as StoredSnapshot['maps'] };

    const after = migrate(before);

    expect(after.formatVersion).toBe(LOCAL_FORMAT_VERSION);
    // 4 → 5 runs next and answers nothing on the trial prompt.
    expect([...after.maps.people.values()]).toEqual([...before.maps.people.values()].map((p) => ({ ...p, emailVerifiedAt: null, trialPrompt: null, closure: null })));
  });

  it('4 → 5 (MUT-418): people arrive with nothing answered on the trial prompt (a device has no trial)', async () => {
    const store = new MemoryLedgerStore();
    await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
    const { maps } = store.snapshot();
    const people = new Map([...maps.people].map(([id, p]) => [id, Object.fromEntries(Object.entries(p).filter(([field]) => field !== 'trialPrompt'))]));
    const before: StoredSnapshot = { formatVersion: 4, stateVersion: 2, savedAt: AT, maps: { ...maps, people } as unknown as StoredSnapshot['maps'] };

    const after = migrate(before);

    expect(after.formatVersion).toBe(LOCAL_FORMAT_VERSION);
    // 6 → 7 runs later and leaves the person not closing.
    expect([...after.maps.people.values()]).toEqual([...before.maps.people.values()].map((p) => ({ ...p, trialPrompt: null, closure: null })));
  });

  it('5 → 6 (MUT-254): expenses arrive with no vendor, and the vendor maps start empty', async () => {
    const store = new MemoryLedgerStore();
    const { user, personalOrganization: personal } = await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
    await store.expenses.create({ organizationId: personal.id, occurredOn: '2026-10-01', amountMinor: 1_000n, currency: 'ILS', title: null, vendor: 'Cafe', categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, AT);
    const { maps } = store.snapshot();
    const exps = new Map([...maps.exps].map(([id, e]) => [id, Object.fromEntries(Object.entries(e).filter(([field]) => field !== 'vendorId'))]));
    const older: Partial<StoredSnapshot['maps']> = { ...maps };
    delete older.vendors;
    delete older.vendorNames;
    const before = { formatVersion: 5, stateVersion: 2, savedAt: AT, maps: { ...older, exps } } as unknown as StoredSnapshot;

    const after = migrate(before);

    expect(after.formatVersion).toBe(LOCAL_FORMAT_VERSION);
    expect([...after.maps.exps.values()]).toEqual([...before.maps.exps.values()].map((e) => ({ ...e, vendorId: null })));
    expect(after.maps.vendors.size).toBe(0);
    expect(after.maps.vendorNames.size).toBe(0);
    expect(() => new MemoryLedgerStore().restore(after)).not.toThrow();
  });

  it('6 → 7 (MUT-333): people arrive not closing (closing is the hosted account’s)', async () => {
    const store = new MemoryLedgerStore();
    await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
    const { maps } = store.snapshot();
    const people = new Map([...maps.people].map(([id, p]) => [id, Object.fromEntries(Object.entries(p).filter(([field]) => field !== 'closure'))]));
    const before: StoredSnapshot = { formatVersion: 6, stateVersion: 2, savedAt: AT, maps: { ...maps, people } as unknown as StoredSnapshot['maps'] };

    const after = migrate(before);

    expect(after.formatVersion).toBe(7);
    expect([...after.maps.people.values()]).toEqual([...before.maps.people.values()].map((p) => ({ ...p, closure: null })));
    expect(() => new MemoryLedgerStore().restore(after)).not.toThrow();
  });

  it("leaves the snapshot it was given untouched", async () => {
    const before = await formatOneSnapshot();
    const orgs = JSON.stringify([...before.maps.orgs.values()]);

    migrate(before);

    expect(JSON.stringify([...before.maps.orgs.values()])).toBe(orgs);
    expect([...before.maps.members.values()].every((m) => !('role' in m))).toBe(true);
  });

  it('restores into a store whose /v1/me reads the firm fields', async () => {
    const store = new MemoryLedgerStore();

    store.restore(migrate(await formatOneSnapshot()));

    const [org] = [...store.snapshot().maps.orgs.values()];
    expect(org).toMatchObject({ firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null });
  });
});
