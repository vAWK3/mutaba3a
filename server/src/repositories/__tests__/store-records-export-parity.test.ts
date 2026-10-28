import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../memory.js';
import { PrismaLedgerStore } from '../prisma.js';
import type { LedgerStore, ProfileExportField } from '../ports.js';

/**
 * MUT-325: the Prisma export reads the same rows, with the same fields and
 * values, as the memory store the portal's local mode runs. The same records
 * are written through each store's own operations; every profile field (and
 * the inbox) is then read back two rows a page, so the key cursors are
 * exercised too. Ids are random per store, so each row is compared with its
 * ids masked, as a sorted multiset per field.
 */

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const AT = new Date('2026-10-01T08:00:00.000Z');
const LATER = new Date('2026-10-05T08:00:00.000Z');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const FIELDS: readonly ProfileExportField[] = ['custs', 'projs', 'refs', 'rates', 'agrs', 'insts', 'charges', 'recs', 'supps', 'versions', 'pays', 'allocs', 'credits', 'counters', 'props', 'exps', 'expCats', 'expReceipts', 'convs', 'expGroups', 'groupMarks', 'vendors', 'vendorNames'];

async function seed(store: LedgerStore) {
  const tag = randomUUID().slice(0, 8);
  const { user } = await store.users.create({ email: `export-${tag}@studio.ps`, displayName: 'Rana', passwordHash: null, locale: 'en', personal: { name: 'Personal', slug: `export-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
  const org = (await store.memberships.listByUser(user.id))[0]!.organizationId;
  const customer = await store.customers.create({ organizationId: org, name: 'Ramallah Bakery', email: 'b@b.ps', phone: null, notes: 'Mornings', vatTreatment: 'STANDARD_RATED' }, AT);
  const project = await store.projects.create({ organizationId: org, customerId: customer.id, name: 'Menu design', currency: 'ILS' }, AT);
  await store.externalReferences.link({ organizationId: org, provider: 'MALAFAT', externalId: `mal-${tag}`, entityType: 'CUSTOMER', entityId: customer.id }, AT);
  await store.vatRates.upsert(org, 1700, '2026-01-01', AT);
  const line = (position: number, amountMinor: bigint, triggerType: 'IMMEDIATE' | 'MANUAL') => ({ position, label: `Line ${position}`, amountMinor, netMinor: amountMinor, vatMinor: 0n, grossMinor: amountMinor, vatTreatment: 'OUT_OF_SCOPE' as const, rateBasisPoints: 0, triggerType, triggerDate: null, paymentTerms: 'IMMEDIATE' as const, dueDateOverride: null });
  const fixed = await store.agreements.create(
    {
      organizationId: org, projectId: project.id, customerId: customer.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0,
      amountMinor: 90_000n, netMinor: 90_000n, vatMinor: 0n, grossMinor: 90_000n, agreementDate: '2026-10-01', description: 'Menu', paymentTerms: 'IMMEDIATE', startMonth: null, billingDay: null, endMonth: null,
      installments: [line(1, 45_000n, 'IMMEDIATE'), line(2, 45_000n, 'MANUAL')],
    },
    AT,
  );
  const posted = (await store.agreements.postInstallment(org, fixed.installments[0]!.id, { postingDate: '2026-10-01', dueDate: '2026-10-01', at: AT }))!;
  await store.agreements.applySupplement(org, fixed.agreement.id, {
    supplement: { amountMinor: 10_000n, description: 'Extra', effectiveDate: '2026-10-02', distribution: 'LAST_UNPOSTED', requestId: null },
    installmentUpdates: [{ id: fixed.installments[1]!.id, amountMinor: 55_000n, netMinor: 55_000n, vatMinor: 0n, grossMinor: 55_000n }], newInstallments: [],
    totals: { amountMinor: 100_000n, netMinor: 100_000n, vatMinor: 0n, grossMinor: 100_000n }, expectedVersion: fixed.agreement.version,
  }, AT);
  const retainer = await store.agreements.create(
    {
      organizationId: org, projectId: project.id, customerId: customer.id, type: 'RECURRING', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0,
      amountMinor: 20_000n, netMinor: 20_000n, vatMinor: 0n, grossMinor: 20_000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: '2026-10', billingDay: 1, endMonth: null, installments: [],
    },
    AT,
  );
  await store.agreements.appendVersion({ organizationId: org, agreementId: retainer.agreement.id, version: 2, effectiveMonth: '2026-11', monthlyAmountMinor: 25_000n, netMinor: 25_000n, vatMinor: 0n, grossMinor: 25_000n, pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'OUT_OF_SCOPE', rateBasisPoints: 0, billingDay: 1, paymentTerms: 'EOM', endMonth: null, reason: 'Scope', requestId: null, expectedAgreementVersion: retainer.agreement.version }, AT);
  await store.agreements.createPostedCharge({ organizationId: org, agreementId: retainer.agreement.id, customerId: customer.id, projectId: project.id, currency: 'ILS', serviceMonth: '2026-10', chargeDate: '2026-10-01', amountMinor: 20_000n, netMinor: 20_000n, vatMinor: 0n, grossMinor: 20_000n, vatTreatment: 'OUT_OF_SCOPE', rateBasisPoints: 0, dueDate: '2026-10-31' }, AT);
  for (const receivedOn of ['2025-12-30', '2026-10-03']) {
    await store.payments.create({ organizationId: org, customerId: customer.id, projectId: project.id, currency: 'ILS', amountMinor: 1_000n, receivedOn, method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: user.id, origin: 'CAPTURE', captureSource: null, allocations: [{ receivableId: posted.receivable.id, amountMinor: 1_000n }] }, LATER);
  }
  await store.receivables.credit(org, posted.receivable.id, { amountMinor: 5_000n, netMinor: 5_000n, vatMinor: 0n, reason: 'Discount', effectiveDate: '2026-10-04', requestId: null }, LATER);
  await store.receivables.createAdjustment({ organizationId: org, customerId: customer.id, projectId: null, currency: 'JOD', netMinor: 1_234_567_890n, vatMinor: 0n, grossMinor: 1_234_567_890n, vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: 'Owed', dueDate: '2026-10-20', postingDate: '2026-10-01', postedAt: AT, createdByUserId: user.id, requestId: null }, AT);
  const second = await store.projects.create({ organizationId: org, customerId: customer.id, name: 'Logo', currency: 'ILS' }, AT);
  await store.feeProposals.create({ organizationId: org, projectId: second.id, customerId: customer.id, currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', proposedAmountMinor: 30_000n, proposedOn: '2026-10-02', note: null, requestId: null }, AT);
  const category = await store.expenseCategories.create(org, { name: 'Travel export', color: '#00aa00' }, AT);
  const yellow = (await store.vendors.resolve({ organizationId: org, name: 'Yellow', registrationNo: '516667276', phone: '+970 2 555 0100', email: null }, AT))!;
  await store.vendors.resolve({ organizationId: org, name: 'Yellow Taxi', registrationNo: '516667276' }, AT);
  await store.vendors.resolve({ organizationId: org, name: 'Corner Shop' }, AT);
  const expenses = [];
  for (const title of ['Taxi', 'Hotel', 'Lunch']) {
    expenses.push(await store.expenses.create({ organizationId: org, occurredOn: '2026-10-02', amountMinor: 4_500n, currency: 'ILS', title, vendor: 'Yellow', vendorId: yellow.id, categoryId: category.id, customerId: customer.id, projectId: project.id, notes: null, createdByUserId: user.id }, AT));
  }
  await store.vendors.touch(org, yellow.id, { categoryId: category.id }, LATER);
  const receipt = await store.expenseReceipts.create({ organizationId: org, expenseId: expenses[0]!.id, filename: 'taxi.pdf', mimeType: 'application/pdf', sizeBytes: 512, receivedOn: '2026-10-11', uploadedByUserId: user.id, requestId: null }, AT);
  await store.expenseReceipts.setKey(org, receipt.id, `org/${org}/expense-receipts/${receipt.id}`);
  await store.expenseReceipts.complete(org, receipt.id, AT);
  await store.conversions.create({ organizationId: org, occurredOn: '2026-10-03', amountMinor: 10_000n, currency: 'USD', toAmountMinor: 36_500n, toCurrency: 'ILS', notes: null, createdByUserId: user.id }, AT);
  for (const name of ['Amman trip', 'Haifa trip']) {
    const group = await store.expenseGroups.create({ organizationId: org, name, startOn: '2026-10-01', endOn: '2026-10-05', notes: null, createdByUserId: user.id }, AT);
    for (const expense of expenses) await store.expenseGroups.setOverride(org, group.id, expense.id, 'excluded', AT);
  }
  for (const note of ['Parking', 'Coffee', 'Fuel']) await store.inboxEntries.create({ userId: user.id, kind: 'EXPENSE', amountMinor: 1_200n, currency: 'ILS', occurredOn: '2026-10-04', note, captureSource: null }, AT);
  return { org, userId: user.id };
}

async function readAll(read: (after: string | null) => Promise<{ entries: Array<[string, unknown]>; nextKey: string | null }>) {
  const entries: Array<[string, unknown]> = [];
  let after: string | null = null;
  do {
    const page = await read(after);
    entries.push(...page.entries);
    after = page.nextKey;
  } while (after !== null);
  return entries;
}

/** Keys sorted (the stores build rows in different orders), bigints marked, ids masked. */
const masked = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'bigint') return `${v}n`;
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    return v;
  }).replace(UUID, '<id>').replace(/(mal|export)-[0-9a-f]{8}/g, '$1-<tag>');

async function exported(store: LedgerStore) {
  const { org, userId } = await seed(store);
  const out: Record<string, { rows: string[]; keys: string[] }> = {};
  for (const field of [...FIELDS, 'inbox' as const]) {
    const entries = await readAll((after) => (field === 'inbox' ? store.recordsExport.inboxPage(userId, after, 2) : store.recordsExport.profilePage(org, field, after, 2)));
    out[field] = { rows: entries.map(([, row]) => masked(row)).sort(), keys: entries.map(([key]) => key) };
    // Ascending, no repeats: what the next page's cursor relies on.
    expect([...out[field]!.keys].sort(), field).toEqual(out[field]!.keys);
    expect(new Set(out[field]!.keys).size, field).toBe(out[field]!.keys.length);
  }
  return { out, org };
}

if (!url) {
  describe.skip('Prisma records export parity (MUT-325) (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const prisma = PrismaLedgerStore.connect(url);
  afterAll(() => prisma.disconnect());

  describe('Prisma records export parity (MUT-325)', () => {
    it('reads every profile field and the inbox exactly as the memory store holds them', async () => {
      const memory = await exported(new MemoryLedgerStore());
      const postgres = await exported(prisma);

      for (const field of [...FIELDS, 'inbox']) expect(postgres.out[field]!.rows, field).toEqual(memory.out[field]!.rows);
      // Payment counters, then the receivable counters (MUT-478).
      expect(postgres.out.counters!.keys).toEqual([`${postgres.org}:2025`, `${postgres.org}:2026`, `${postgres.org}:CHG:2026`]);
      expect(postgres.out.groupMarks!.rows).toHaveLength(6);
      expect(postgres.out.custs!.rows).toHaveLength(1);
      expect(postgres.out.vendors!.rows).toHaveLength(2);
      expect(postgres.out.vendorNames!.rows).toHaveLength(3);
    });

    it('finds only a READY, undeleted receipt of the profile', async () => {
      const { org } = await seed(prisma);
      const [, receipt] = (await prisma.recordsExport.profilePage(org, 'expReceipts', null, 10)).entries[0]!;

      expect(await prisma.recordsExport.findExportableReceipt(org, receipt.id)).toEqual({ storageKey: receipt.storageKey, mimeType: 'application/pdf', sizeBytes: 512 });
      expect(await prisma.recordsExport.findExportableReceipt(randomUUID(), receipt.id)).toBeNull();
      await prisma.expenseReceipts.softDelete(org, receipt.id, LATER);
      expect(await prisma.recordsExport.findExportableReceipt(org, receipt.id)).toBeNull();
    });
  });
}
