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
    expect([...after.maps.people.values()]).toEqual([...before.maps.people.values()].map((p) => ({ ...p, emailVerifiedAt: null, trialPrompt: null, closure: null, operatorAt: null })));
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
    expect([...after.maps.people.values()]).toEqual([...before.maps.people.values()].map((p) => ({ ...p, trialPrompt: null, closure: null, operatorAt: null })));
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

    expect(after.formatVersion).toBe(LOCAL_FORMAT_VERSION);
    // 7 → 8 runs next and leaves the person no operator.
    expect([...after.maps.people.values()]).toEqual([...before.maps.people.values()].map((p) => ({ ...p, closure: null, operatorAt: null })));
    expect(() => new MemoryLedgerStore().restore(after)).not.toThrow();
  });

  it('7 → 8 (MUT-459): people arrive no operator (operators are hosted accounts)', async () => {
    const store = new MemoryLedgerStore();
    await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
    const { maps } = store.snapshot();
    const people = new Map([...maps.people].map(([id, p]) => [id, Object.fromEntries(Object.entries(p).filter(([field]) => field !== 'operatorAt'))]));
    const before: StoredSnapshot = { formatVersion: 7, stateVersion: 2, savedAt: AT, maps: { ...maps, people } as unknown as StoredSnapshot['maps'] };

    const after = migrate(before);

    // 8 → 9 runs next and touches only receivables.
    expect(after.formatVersion).toBe(LOCAL_FORMAT_VERSION);
    expect([...after.maps.people.values()]).toEqual([...before.maps.people.values()].map((p) => ({ ...p, operatorAt: null })));
    expect(() => new MemoryLedgerStore().restore(after)).not.toThrow();
  });

  it('8 → 9 (MUT-478): receivables arrive numbered in posting order, and numbering resumes after them', async () => {
    const store = new MemoryLedgerStore();
    const { user, personalOrganization: org } = await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
    const customer = await store.customers.create({ organizationId: org.id, name: 'Haddad', email: null, phone: null, notes: null }, AT);
    const owed = (postingDate: string) => store.receivables.createAdjustment({ organizationId: org.id, customerId: customer.id, projectId: null, currency: 'ILS', netMinor: 100n, vatMinor: 0n, grossMinor: 100n, vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, title: 'Work', dueDate: postingDate, postingDate, postedAt: new Date(`${postingDate}T08:00:00Z`), createdByUserId: user.id, requestId: null });
    const later = await owed('2026-09-01');
    const earlier = await owed('2026-02-01');
    const lastYear = await owed('2025-12-31');
    const { maps } = store.snapshot();
    const recs = new Map([...maps.recs].map(([id, r]) => [id, Object.fromEntries(Object.entries(r).filter(([field]) => field !== 'number'))]));
    const counters = new Map([...maps.counters].filter(([key]) => !key.includes(':CHG:')));
    const before: StoredSnapshot = { formatVersion: 8, stateVersion: 4, savedAt: AT, maps: { ...maps, recs, counters } as unknown as StoredSnapshot['maps'] };

    const after = migrate(before);

    // 9 → 10 runs next and touches only credits and supplements.
    expect(after.formatVersion).toBe(LOCAL_FORMAT_VERSION);
    expect(after.maps.recs.get(lastYear.id)?.number).toBe('CHG-2025-0001');
    expect(after.maps.recs.get(earlier.id)?.number).toBe('CHG-2026-0001');
    expect(after.maps.recs.get(later.id)?.number).toBe('CHG-2026-0002');
    const restored = new MemoryLedgerStore();
    restored.restore(after);
    expect((await restored.receivables.createAdjustment({ organizationId: org.id, customerId: customer.id, projectId: null, currency: 'ILS', netMinor: 1n, vatMinor: 0n, grossMinor: 1n, vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, title: null, dueDate: '2026-10-01', postingDate: '2026-10-01', postedAt: AT, createdByUserId: user.id, requestId: null })).number).toBe('CHG-2026-0003');
  });

  it('9 → 10 (MUT-480): credits and supplements gain the reduction fields as Postgres defaults them, and the store restores', async () => {
    const store = new MemoryLedgerStore();
    const { personalOrganization: org } = await store.users.create({ email: 'nour@studio.ps', displayName: 'Nour', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-nour', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
    const customer = await store.customers.create({ organizationId: org.id, name: 'Haddad', email: null, phone: null, notes: null }, AT);
    const project = await store.projects.create({ organizationId: org.id, customerId: customer.id, name: 'Sale', currency: 'ILS' }, AT);
    const line = { label: 'I1', amountMinor: 100n, netMinor: 100n, vatMinor: 0n, grossMinor: 100n, vatTreatment: 'EXEMPT' as const, rateBasisPoints: 0, triggerType: 'IMMEDIATE' as const, triggerDate: null, paymentTerms: null, dueDateOverride: null };
    const { agreement, installments } = await store.agreements.create({ organizationId: org.id, projectId: project.id, customerId: customer.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: 200n, netMinor: 200n, vatMinor: 0n, grossMinor: 200n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments: [{ ...line, position: 1 }, { ...line, position: 2 }] }, AT);
    const posted = (await store.agreements.postInstallment(org.id, installments[0]!.id, { postingDate: '2026-10-01', dueDate: '2026-10-31', at: AT }))!;
    await store.receivables.credit(org.id, posted.receivable.id, { amountMinor: 10n, netMinor: 10n, vatMinor: 0n, reason: 'Goodwill', effectiveDate: '2026-10-01', requestId: null }, AT);
    await store.agreements.applySupplement(org.id, agreement.id, { supplement: { amountMinor: -10n, description: null, effectiveDate: '2026-10-01', distribution: 'LAST_UNPOSTED', requestId: null }, installmentUpdates: [{ id: installments[1]!.id, amountMinor: 90n, netMinor: 90n, vatMinor: 0n, grossMinor: 90n }], newInstallments: [], totals: { amountMinor: 190n, netMinor: 190n, vatMinor: 0n, grossMinor: 190n }, expectedVersion: agreement.version }, AT);
    const { maps } = store.snapshot();
    const strip = <T extends object>(m: Map<string, T>, fields: string[]) => new Map([...m].map(([id, r]) => [id, Object.fromEntries(Object.entries(r).filter(([field]) => !fields.includes(field)))]));
    const before: StoredSnapshot = { formatVersion: 9, stateVersion: 4, savedAt: AT, maps: { ...maps, credits: strip(maps.credits, ['reasonCode']), supps: strip(maps.supps, ['reasonCode', 'appliedGrossMinor', 'creditedMinor']) } as unknown as StoredSnapshot['maps'] };

    const after = migrate(before);

    expect(after.formatVersion).toBe(10);
    expect([...after.maps.credits.values()]).toEqual([...maps.credits.values()].map((c) => ({ ...c, reasonCode: null })));
    expect([...after.maps.supps.values()]).toEqual([...maps.supps.values()].map((s) => ({ ...s, reasonCode: null, appliedGrossMinor: null, creditedMinor: 0n })));
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
