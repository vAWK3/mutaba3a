import { afterAll, describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';
import type { CreateExpenseInput, LedgerStore, MoveExpenseParams } from '../ports.js';

/**
 * MUT-589 (ADR-252): moving a saved expense with its receipts in Postgres — one transaction re-homes the expense and
 * its receipts, drops its group marks and writes both audit rows; the expense lock decides between a move and a
 * filing onto it, or a second move.
 */

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma expense move (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  afterAll(async () => {
    await store.disconnect();
  });

  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 11, 10, 0, 0, ms));

  async function seed(s: LedgerStore) {
    const a = await s.organizations.create({ name: 'Studio', slug: `studio-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const b = await s.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user } = await s.users.create({ email: `x-${unique()}@studio.ps`, displayName: 'Lina', passwordHash: 'x', locale: 'en', organizationId: a.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const input: CreateExpenseInput = { organizationId: a.id, occurredOn: '2026-11-02', amountMinor: 1_500n, currency: 'ILS', title: null, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1700, netMinor: 1_282n, vatMinor: 218n, allocationNumber: null, createdByUserId: user.id };
    const expense = await s.expenses.create(input, at(1));
    const receipt = async (ready = true) => {
      const r = await s.expenseReceipts.create({ organizationId: a.id, expenseId: expense.id, filename: 'scan.pdf', mimeType: 'application/pdf', sizeBytes: 2048, receivedOn: '2026-11-02', uploadedByUserId: user.id, requestId: null }, at(2));
      await s.expenseReceipts.setKey(a.id, r.id, `org/${a.id}/expense-receipts/${r.id}`);
      return ready ? (await s.expenseReceipts.complete(a.id, r.id, at(3)))! : r;
    };
    const params = (over: Partial<MoveExpenseParams> = {}): MoveExpenseParams => ({
      organizationId: a.id,
      expenseId: expense.id,
      targetOrganizationId: b.id,
      expectedVersion: expense.version,
      patch: { vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null },
      receiptKeys: {},
      approvedCategoryId: null,
      audit: [
        { organizationId: a.id, actorType: 'USER', actorId: user.id, action: 'expense.moved_out', entityType: 'expense', entityId: expense.id, metadata: { toProfileId: b.id }, requestId: null },
        { organizationId: b.id, actorType: 'USER', actorId: user.id, action: 'expense.moved_in', entityType: 'expense', entityId: expense.id, metadata: { fromProfileId: a.id }, requestId: null },
      ],
      at: at(9),
      ...over,
    });
    return { a, b, user, expense, receipt, params };
  }

  describe('Prisma expense move (MUT-589)', () => {
    it('re-homes the expense and its receipts, clears the VAT columns, drops group marks and writes both audits', async () => {
      const { a, b, user, expense, receipt, params } = await seed(store);
      const r = await receipt();
      const group = await store.expenseGroups.create({ organizationId: a.id, name: 'Trip', startOn: '2026-11-01', endOn: null, notes: null, createdByUserId: user.id }, at(4));
      await store.expenseGroups.setOverride(a.id, group.id, expense.id, 'excluded', at(5));
      const result = await store.expenses.moveToProfile(params({ receiptKeys: { [r.id]: `org/${b.id}/expense-receipts/${r.id}-abc` } }));
      expect(result.kind).toBe('moved');
      if (result.kind !== 'moved') return;
      expect(result.expense).toMatchObject({ id: expense.id, organizationId: b.id, amountMinor: 1_500n, vatTreatment: null, version: expense.version + 1 });
      expect(result.receipts).toEqual([expect.objectContaining({ id: r.id, organizationId: b.id, expenseId: expense.id, storageKey: `org/${b.id}/expense-receipts/${r.id}-abc` })]);
      expect(result.previousStorageKeys).toEqual([r.storageKey]);
      expect(await store.expenses.getById(a.id, expense.id)).toBeNull();
      expect(await store.expenseGroups.overridesForExpense(a.id, expense.id)).toEqual([]);
      expect((await store.audit.list(b.id, { action: 'expense.moved_in' }, { limit: 5, cursor: null })).items).toHaveLength(1);
      expect((await store.audit.list(a.id, { action: 'expense.moved_out' }, { limit: 5, cursor: null })).items).toHaveLength(1);
    });

    it('refuses a stale version, a changed receipt set and an unfinished upload, writing nothing', async () => {
      const { a, expense, receipt, params } = await seed(store);
      const r = await receipt();
      expect(await store.expenses.moveToProfile(params({ expectedVersion: expense.version + 1, receiptKeys: { [r.id]: 'k' } }))).toEqual({ kind: 'stale', currentVersion: expense.version });
      expect(await store.expenses.moveToProfile(params())).toEqual({ kind: 'receipts_changed', currentVersion: expense.version });
      await receipt(false);
      expect((await store.expenses.moveToProfile(params({ receiptKeys: { [r.id]: 'k' } }))).kind).toBe('receipt_not_ready');
      expect(await store.expenses.getById(a.id, expense.id)).toMatchObject({ version: expense.version });
    });

    it('two moves at once: exactly one wins', async () => {
      const { params } = await seed(store);
      const results = await Promise.all([store.expenses.moveToProfile(params()), store.expenses.moveToProfile(params())]);
      expect(results.map((x) => x.kind).sort()).toEqual(['moved', 'not_found']);
    });
  });
}
