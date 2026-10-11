import { describe, expect, it } from 'vitest';
import { UniqueViolation } from '../memory.js';
import type { CreateExpenseInput, LedgerStore, Organization } from '../ports.js';

/** MUT-42 storage contract: expenses, expense categories and expense receipts on hosted profiles. */
export function describeLedgerStoreExpensesContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function world(store: LedgerStore) {
    const a = await org(store, 'A');
    const b = await org(store, 'B');
    const { user } = await store.users.create({ email: `p-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: a.id, at: at(0) });
    const customer = await store.customers.create({ organizationId: a.id, name: 'Haddad', email: null, phone: null, notes: null }, at(0));
    const project = await store.projects.create({ organizationId: a.id, customerId: customer.id, name: 'Sale', currency: 'USD' }, at(0));
    const expense = (over: Partial<CreateExpenseInput> = {}): CreateExpenseInput => ({
      organizationId: a.id,
      occurredOn: '2026-10-05',
      amountMinor: 12_345n,
      currency: 'ILS',
      title: 'Court fee',
      vendor: 'Court',
      categoryId: null,
      customerId: null,
      projectId: null,
      notes: null,
      createdByUserId: user.id,
      ...over,
    });
    return { a, b, user, customer, project, expense };
  }

  describe(`${name} LedgerStore expenses contract (MUT-42)`, () => {
    it('creates and reads an expense with every field, inside one organization only', async () => {
      const store = await makeStore();
      const w = await world(store);
      const category = await store.expenseCategories.create(w.a.id, { name: 'Court Filing Fees', color: '#f97316' }, at(0));
      const created = await store.expenses.create(w.expense({ categoryId: category.id, customerId: w.customer.id, projectId: w.project.id, notes: 'Stamp duty', amountMinor: 9_007_199_254_740_993n }), at(1));
      expect(created).toMatchObject({
        organizationId: w.a.id,
        occurredOn: '2026-10-05',
        amountMinor: 9_007_199_254_740_993n,
        currency: 'ILS',
        title: 'Court fee',
        vendor: 'Court',
        categoryId: category.id,
        customerId: w.customer.id,
        projectId: w.project.id,
        notes: 'Stamp duty',
        createdByUserId: w.user.id,
        version: 1,
        createdAt: at(1),
        updatedAt: at(1),
        deletedAt: null,
      });
      expect(await store.expenses.getById(w.a.id, created.id)).toEqual(created);
      expect(await store.expenses.getById(w.b.id, created.id)).toBeNull();
    });

    it('lists newest first by (occurredOn, id), paginated without gaps or repeats, with every filter', async () => {
      const store = await makeStore();
      const w = await world(store);
      const cat = await store.expenseCategories.create(w.a.id, { name: 'Rent', color: null }, at(0));
      const dates = ['2026-10-01', '2026-10-03', '2026-10-03', '2026-10-03', '2026-10-07', '2026-09-30'];
      const made = [];
      for (const [i, d] of dates.entries()) made.push(await store.expenses.create(w.expense({ occurredOn: d, ...(i === 1 ? { categoryId: cat.id, customerId: w.customer.id } : {}), ...(i === 2 ? { currency: 'USD', projectId: w.project.id, customerId: w.customer.id } : {}) }), at(i)));
      await store.expenses.create(w.expense({ organizationId: w.b.id }), at(9));

      const seen: string[] = [];
      let cursor = null;
      do {
        const page = await store.expenses.list(w.a.id, {}, { limit: 2, cursor });
        seen.push(...page.items.map((x) => x.id));
        cursor = page.nextCursor;
      } while (cursor);
      const expected = [...made].sort((x, y) => (x.occurredOn === y.occurredOn ? (x.id < y.id ? 1 : -1) : x.occurredOn < y.occurredOn ? 1 : -1)).map((x) => x.id);
      expect(seen).toEqual(expected);

      const ids = async (filter: Parameters<LedgerStore['expenses']['list']>[1]) => (await store.expenses.list(w.a.id, filter, { limit: 50, cursor: null })).items.map((x) => x.id).sort();
      expect(await ids({ from: '2026-10-03', to: '2026-10-03' })).toEqual([made[1]!.id, made[2]!.id, made[3]!.id].sort());
      expect(await ids({ from: '2026-10-04' })).toEqual([made[4]!.id]);
      expect(await ids({ to: '2026-09-30' })).toEqual([made[5]!.id]);
      expect(await ids({ currency: 'USD' })).toEqual([made[2]!.id]);
      expect(await ids({ categoryId: cat.id })).toEqual([made[1]!.id]);
      expect(await ids({ customerId: w.customer.id })).toEqual([made[1]!.id, made[2]!.id].sort());
      expect(await ids({ projectId: w.project.id })).toEqual([made[2]!.id]);
      expect(await ids({ unlinked: true })).toEqual([made[0]!.id, made[3]!.id, made[4]!.id, made[5]!.id].sort());
    });

    it('updates optimistically: version bump, stale refused without side effects, null clears, absent keeps', async () => {
      const store = await makeStore();
      const w = await world(store);
      const e = await store.expenses.create(w.expense({ notes: 'keep me', customerId: w.customer.id }), at(0));
      const updated = await store.expenses.update(w.a.id, e.id, 1, { amountMinor: 500n, vendor: null, occurredOn: '2026-10-09' }, at(1));
      expect(updated.kind).toBe('updated');
      if (updated.kind !== 'updated') return;
      expect(updated.record).toMatchObject({ amountMinor: 500n, vendor: null, occurredOn: '2026-10-09', notes: 'keep me', customerId: w.customer.id, currency: 'ILS', version: 2, updatedAt: at(1), createdAt: at(0) });
      const stale = await store.expenses.update(w.a.id, e.id, 1, { amountMinor: 1n }, at(2));
      expect(stale).toEqual({ kind: 'stale', record: updated.record });
      expect((await store.expenses.getById(w.a.id, e.id))!.amountMinor).toBe(500n);
      expect(await store.expenses.update(w.b.id, e.id, 2, { amountMinor: 1n }, at(2))).toEqual({ kind: 'not_found' });
    });

    it('soft-deletes: hidden from get, list and update; a second delete reports unchanged; unknown is null', async () => {
      const store = await makeStore();
      const w = await world(store);
      const e = await store.expenses.create(w.expense(), at(0));
      const first = await store.expenses.softDelete(w.a.id, e.id, at(1));
      expect(first).toMatchObject({ changed: true, record: { id: e.id, deletedAt: at(1) } });
      expect(await store.expenses.getById(w.a.id, e.id)).toBeNull();
      expect((await store.expenses.list(w.a.id, {}, { limit: 50, cursor: null })).items).toEqual([]);
      expect(await store.expenses.update(w.a.id, e.id, 1, { amountMinor: 1n }, at(2))).toEqual({ kind: 'not_found' });
      const second = await store.expenses.softDelete(w.a.id, e.id, at(3));
      expect(second).toMatchObject({ changed: false, record: { deletedAt: at(1) } });
      expect(await store.expenses.softDelete(w.b.id, e.id, at(3))).toBeNull();
      expect(await store.expenses.softDelete(w.a.id, '00000000-0000-4000-8000-00000000dead', at(3))).toBeNull();
    });

    it('keeps category names unique per organization regardless of case, lists in creation order, archives', async () => {
      const store = await makeStore();
      const w = await world(store);
      const rent = await store.expenseCategories.create(w.a.id, { name: 'Office Rent', color: '#6366f1' }, at(0));
      const fees = await store.expenseCategories.create(w.a.id, { name: 'Bank Fees', color: null }, at(1));
      await expect(store.expenseCategories.create(w.a.id, { name: '  office RENT ', color: null }, at(2))).rejects.toBeInstanceOf(UniqueViolation);
      await store.expenseCategories.create(w.b.id, { name: 'Office Rent', color: null }, at(2));
      expect((await store.expenseCategories.list(w.a.id, { includeArchived: false })).map((c) => c.name)).toEqual(['Office Rent', 'Bank Fees']);

      const renamed = await store.expenseCategories.update(w.a.id, fees.id, 1, { name: 'Bank Charges', color: '#64748b' }, at(3));
      expect(renamed).toMatchObject({ kind: 'updated', record: { name: 'Bank Charges', color: '#64748b', version: 2 } });
      await expect(store.expenseCategories.update(w.a.id, fees.id, 2, { name: 'office rent' }, at(4))).rejects.toBeInstanceOf(UniqueViolation);
      expect(await store.expenseCategories.update(w.a.id, fees.id, 1, { color: null }, at(4))).toMatchObject({ kind: 'stale' });

      const archived = await store.expenseCategories.update(w.a.id, rent.id, 1, { archived: true }, at(5));
      expect(archived).toMatchObject({ kind: 'updated', record: { archivedAt: at(5) } });
      expect((await store.expenseCategories.list(w.a.id, { includeArchived: false })).map((c) => c.id)).toEqual([fees.id]);
      expect((await store.expenseCategories.list(w.a.id, { includeArchived: true })).map((c) => c.id)).toEqual([rent.id, fees.id]);
      const restored = await store.expenseCategories.update(w.a.id, rent.id, 2, { archived: false }, at(6));
      expect(restored).toMatchObject({ kind: 'updated', record: { archivedAt: null } });
      expect(await store.expenseCategories.getById(w.b.id, rent.id)).toBeNull();
    });

    it('seeds a preset only into an organization with no categories, once, even when two seeds race', async () => {
      const store = await makeStore();
      const w = await world(store);
      const preset = [
        { name: 'Court Filing Fees', color: '#f97316' },
        { name: 'Expert Witnesses', color: '#ec4899' },
        { name: 'Other', color: '#78716c' },
      ];
      const results = await Promise.all([store.expenseCategories.seed(w.a.id, preset, at(0)), store.expenseCategories.seed(w.a.id, preset, at(0))]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await store.expenseCategories.list(w.a.id, { includeArchived: true })).map((c) => c.name)).toEqual(preset.map((p) => p.name));
      expect(await store.expenseCategories.seed(w.a.id, preset, at(1))).toBe(false);

      await store.expenseCategories.create(w.b.id, { name: 'Mine', color: null }, at(0));
      expect(await store.expenseCategories.seed(w.b.id, preset, at(1))).toBe(false);
      expect((await store.expenseCategories.list(w.b.id, { includeArchived: true })).map((c) => c.name)).toEqual(['Mine']);
    });

    it('creates receipts pending, keys and completes them, lists READY ones per expense, soft-deletes one or all', async () => {
      const store = await makeStore();
      const w = await world(store);
      const e = await store.expenses.create(w.expense(), at(0));
      const input = { organizationId: w.a.id, expenseId: e.id, filename: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 1234, uploadedByUserId: w.user.id, requestId: 'req' };
      const r1 = await store.expenseReceipts.create(input, at(1));
      expect(r1).toMatchObject({ status: 'PENDING_UPLOAD', storageKey: '', completedAt: null, deletedAt: null, uploadedByUserId: w.user.id });
      const keyed = await store.expenseReceipts.setKey(w.a.id, r1.id, `org/${w.a.id}/expense-receipts/${r1.id}`);
      expect(keyed!.storageKey).toBe(`org/${w.a.id}/expense-receipts/${r1.id}`);
      expect(await store.expenseReceipts.listByExpense(w.a.id, e.id)).toEqual([]);
      expect(await store.expenseReceipts.complete(w.a.id, r1.id, at(2))).toMatchObject({ status: 'READY', completedAt: at(2) });
      const r2 = await store.expenseReceipts.create({ ...input, filename: 'second.png', mimeType: 'image/png' }, at(3));
      await store.expenseReceipts.complete(w.a.id, r2.id, at(4));
      const pending = await store.expenseReceipts.create({ ...input, filename: 'never.pdf' }, at(5));
      expect((await store.expenseReceipts.listByExpense(w.a.id, e.id)).map((r) => r.id)).toEqual([r1.id, r2.id]);
      expect(await store.expenseReceipts.getById(w.b.id, r1.id)).toBeNull();
      expect(await store.expenseReceipts.setKey(w.b.id, r1.id, 'x')).toBeNull();

      const one = await store.expenseReceipts.softDelete(w.a.id, r1.id, at(6));
      expect(one!.deletedAt).toEqual(at(6));
      expect(await store.expenseReceipts.getById(w.a.id, r1.id)).toBeNull();
      const rest = await store.expenseReceipts.softDeleteByExpense(w.a.id, e.id, at(7));
      expect(rest.map((r) => r.id).sort()).toEqual([r2.id, pending.id].sort());
      expect(await store.expenseReceipts.listByExpense(w.a.id, e.id)).toEqual([]);
      expect(await store.expenseReceipts.softDeleteByExpense(w.a.id, e.id, at(8))).toEqual([]);
    });
  });
}
