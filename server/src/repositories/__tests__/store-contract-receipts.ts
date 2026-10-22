import { describe, expect, it } from 'vitest';
import type { ApprovedReceiptFields, CreateExpenseInput, CreateExpenseReceiptInput, LedgerStore, Organization, ReceiptSuggestion } from '../ports.js';

/** MUT-255 storage contract: the receipts library — To-review receipts, the library list, approval into an expense, the edit-rate figure. */
export function describeLedgerStoreReceiptsContract(name: string, makeStore: () => Promise<LedgerStore>, options: { concurrent: boolean }): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 22, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function world(store: LedgerStore) {
    const a = await org(store, 'A');
    const b = await org(store, 'B');
    const { user } = await store.users.create({ email: `p-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: a.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const upload = (over: Partial<CreateExpenseReceiptInput> = {}): CreateExpenseReceiptInput => ({
      organizationId: a.id,
      expenseId: null,
      filename: 'scan.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      receivedOn: '2026-10-22',
      uploadedByUserId: user.id,
      requestId: null,
      ...over,
    });
    /** A library receipt, uploaded and completed. */
    const ready = async (over: Partial<CreateExpenseReceiptInput> = {}, ms = 1) => {
      const r = await store.expenseReceipts.create(upload(over), at(ms));
      await store.expenseReceipts.setKey(r.organizationId, r.id, `org/${r.organizationId}/expense-receipts/${r.id}`);
      return (await store.expenseReceipts.complete(r.organizationId, r.id, at(ms)))!;
    };
    const expense = (over: Partial<CreateExpenseInput> = {}): CreateExpenseInput => ({
      organizationId: a.id,
      occurredOn: '2026-10-21',
      amountMinor: 1_500n,
      currency: 'ILS',
      title: null,
      vendor: 'Cafe',
      categoryId: null,
      customerId: null,
      projectId: null,
      notes: null,
      createdByUserId: user.id,
      ...over,
    });
    const approved = (over: Partial<ApprovedReceiptFields> = {}): ApprovedReceiptFields => ({ occurredOn: '2026-10-21', amountMinor: '1500', currency: 'ILS', vendor: 'Cafe', categoryId: null, ...over });
    return { a, b, user, upload, ready, expense, approved };
  }

  const suggestion: ReceiptSuggestion = {
    readerVersion: 'phone-1.0',
    date: { value: '2026-10-21', source: 'ocr', confidence: 0.92 },
    totalMinor: { value: '1500', source: 'ocr', confidence: 0.88 },
    currency: { value: 'ILS', source: 'ocr', confidence: 0.7 },
  };

  describe(`${name} LedgerStore receipts library contract (MUT-255)`, () => {
    it('a receipt with no expense starts TO_REVIEW, keeps its suggestion, and shows in the library only once READY', async () => {
      const store = await makeStore();
      const w = await world(store);
      const pending = await store.expenseReceipts.create(w.upload({ suggested: suggestion }), at(1));
      expect(pending).toMatchObject({ expenseId: null, filingStatus: 'TO_REVIEW', status: 'PENDING_UPLOAD', receivedOn: '2026-10-22', suggested: suggestion, approved: null, version: 1 });
      expect((await store.expenseReceipts.list(w.a.id, {}, { limit: 10, cursor: null })).items).toEqual([]);
      expect(await store.expenseReceipts.countByFilingStatus(w.a.id)).toEqual({ toReview: 0, filed: 0 });

      await store.expenseReceipts.complete(w.a.id, pending.id, at(2));
      const page = await store.expenseReceipts.list(w.a.id, { filingStatus: 'TO_REVIEW' }, { limit: 10, cursor: null });
      expect(page.items.map((r) => r.id)).toEqual([pending.id]);
      expect(await store.expenseReceipts.countByFilingStatus(w.a.id)).toEqual({ toReview: 1, filed: 0 });
      expect((await store.expenseReceipts.list(w.b.id, {}, { limit: 10, cursor: null })).items).toEqual([]);
    });

    it('lists newest upload first, paged without gaps or repeats, filtered by status and inclusive upload day', async () => {
      const store = await makeStore();
      const w = await world(store);
      const r1 = await w.ready({ receivedOn: '2026-10-20' }, 1);
      const r2 = await w.ready({ receivedOn: '2026-10-21' }, 2);
      const r3 = await w.ready({ receivedOn: '2026-10-22' }, 3);
      const e = await store.expenses.create(w.expense(), at(4));
      const filed = await w.ready({ expenseId: e.id, receivedOn: '2026-10-22' }, 5);

      const first = await store.expenseReceipts.list(w.a.id, {}, { limit: 2, cursor: null });
      const second = await store.expenseReceipts.list(w.a.id, {}, { limit: 2, cursor: first.nextCursor });
      expect([...first.items, ...second.items].map((r) => r.id)).toEqual([filed.id, r3.id, r2.id, r1.id]);
      expect(second.nextCursor).toBeNull();

      expect((await store.expenseReceipts.list(w.a.id, { filingStatus: 'FILED' }, { limit: 10, cursor: null })).items.map((r) => r.id)).toEqual([filed.id]);
      expect((await store.expenseReceipts.list(w.a.id, { from: '2026-10-21', to: '2026-10-21' }, { limit: 10, cursor: null })).items.map((r) => r.id)).toEqual([r2.id]);
      expect((await store.expenseReceipts.list(w.a.id, { filingStatus: 'TO_REVIEW', from: '2026-10-21' }, { limit: 10, cursor: null })).items.map((r) => r.id)).toEqual([r3.id, r2.id]);
      expect(await store.expenseReceipts.countByFilingStatus(w.a.id)).toEqual({ toReview: 3, filed: 1 });
    });

    it('counts unfinished uploads since a moment, for the per-profile cap', async () => {
      const store = await makeStore();
      const w = await world(store);
      await store.expenseReceipts.create(w.upload(), at(1));
      await store.expenseReceipts.create(w.upload(), at(5));
      await w.ready({}, 6);
      const gone = await store.expenseReceipts.create(w.upload(), at(7));
      await store.expenseReceipts.softDelete(w.a.id, gone.id, at(8));
      expect(await store.expenseReceipts.countPendingSince(w.a.id, at(2))).toBe(1);
      expect(await store.expenseReceipts.countPendingSince(w.a.id, at(0))).toBe(2);
      expect(await store.expenseReceipts.countPendingSince(w.b.id, at(0))).toBe(0);
    });

    it('replaces a To-review suggestion optimistically; refuses a stale version and a filed receipt', async () => {
      const store = await makeStore();
      const w = await world(store);
      const r = await w.ready();
      const updated = await store.expenseReceipts.setSuggested(w.a.id, r.id, r.version, suggestion);
      expect(updated).toMatchObject({ kind: 'updated', record: { suggested: suggestion, version: r.version + 1 } });
      expect((await store.expenseReceipts.setSuggested(w.a.id, r.id, r.version, { readerVersion: 'x' })).kind).toBe('stale');
      expect((await store.expenseReceipts.setSuggested(w.b.id, r.id, r.version + 1, suggestion)).kind).toBe('not_found');
      await store.expenseReceipts.fileAsExpense({ organizationId: w.a.id, receiptId: r.id, userId: w.user.id, expense: w.expense(), approved: w.approved() }, at(9));
      expect((await store.expenseReceipts.setSuggested(w.a.id, r.id, r.version + 2, suggestion)).kind).toBe('filed');
    });

    it('approves a READY To-review receipt into exactly one expense, FILED with what was approved; a second approval files nothing', async () => {
      const store = await makeStore();
      const w = await world(store);
      const r = await w.ready({ suggested: suggestion });
      const result = await store.expenseReceipts.fileAsExpense({ organizationId: w.a.id, receiptId: r.id, userId: w.user.id, expense: w.expense({ amountMinor: 1_800n }), approved: w.approved({ amountMinor: '1800' }) }, at(9));
      expect(result.kind).toBe('filed');
      if (result.kind !== 'filed') return;
      expect(result.expense).toMatchObject({ organizationId: w.a.id, amountMinor: 1_800n, vendor: 'Cafe' });
      expect(result.receipt).toMatchObject({ expenseId: result.expense.id, filingStatus: 'FILED', suggested: suggestion, approved: w.approved({ amountMinor: '1800' }), approvedAt: at(9), approvedByUserId: w.user.id, version: r.version + 1 });
      expect((await store.expenseReceipts.listByExpense(w.a.id, result.expense.id)).map((x) => x.id)).toEqual([r.id]);

      const again = await store.expenseReceipts.fileAsExpense({ organizationId: w.a.id, receiptId: r.id, userId: w.user.id, expense: w.expense(), approved: w.approved() }, at(10));
      expect(again.kind).toBe('already_filed');
      expect((await store.expenses.list(w.a.id, {}, { limit: 10, cursor: null })).items).toHaveLength(1);
    });

    it('stores the suggestion sent with the approval, replacing the upload-time one', async () => {
      const store = await makeStore();
      const w = await world(store);
      const r = await w.ready({ suggested: { readerVersion: 'old' } });
      const result = await store.expenseReceipts.fileAsExpense({ organizationId: w.a.id, receiptId: r.id, userId: w.user.id, expense: w.expense(), approved: w.approved(), suggested: suggestion }, at(9));
      expect(result.kind === 'filed' && result.receipt.suggested).toEqual(suggestion);
    });

    it("refuses an unfinished upload, another profile's receipt, a deleted one, and leaves no expense behind when the insert fails", async () => {
      const store = await makeStore();
      const w = await world(store);
      const pending = await store.expenseReceipts.create(w.upload(), at(1));
      const r = await w.ready();
      const deleted = await w.ready();
      await store.expenseReceipts.softDelete(w.a.id, deleted.id, at(3));
      const file = (receiptId: string, organizationId = w.a.id, expense = w.expense()) => store.expenseReceipts.fileAsExpense({ organizationId, receiptId, userId: w.user.id, expense: { ...expense, organizationId }, approved: w.approved() }, at(9));

      expect((await file(pending.id)).kind).toBe('not_ready');
      expect((await file(r.id, w.b.id)).kind).toBe('not_found');
      expect((await file(deleted.id)).kind).toBe('not_found');
      // A category that doesn't exist (deleted since the route checked): the insert throws and the receipt stays To review.
      await expect(file(r.id, w.a.id, w.expense({ categoryId: '00000000-0000-4000-8000-0000000000ca' }))).rejects.toThrow();
      expect(await store.expenseReceipts.getById(w.a.id, r.id)).toMatchObject({ filingStatus: 'TO_REVIEW', expenseId: null, approved: null });
      expect((await store.expenses.list(w.a.id, {}, { limit: 10, cursor: null })).items).toEqual([]);
    });

    if (options.concurrent) {
      it('of two concurrent approvals of one receipt, exactly one files it (row lock)', async () => {
        const store = await makeStore();
        const w = await world(store);
        const r = await w.ready();
        const results = await Promise.all([0, 1].map(() => store.expenseReceipts.fileAsExpense({ organizationId: w.a.id, receiptId: r.id, userId: w.user.id, expense: w.expense(), approved: w.approved() }, at(9))));
        expect(results.map((x) => x.kind).sort()).toEqual(['already_filed', 'filed']);
        expect((await store.expenses.list(w.a.id, {}, { limit: 10, cursor: null })).items).toHaveLength(1);
      });
    }

    it('counts the edit rate per field over approvals in a range, never values', async () => {
      const store = await makeStore();
      const w = await world(store);
      // The figure spans every profile, so a shared database's earlier runs must fall outside this run's window.
      const base = Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 1e11);
      const when = (ms: number) => new Date(base + ms);
      const approve = async (suggested: ReceiptSuggestion | undefined, approved: ApprovedReceiptFields, ms: number) => {
        const r = await w.ready(suggested ? { suggested } : {}, ms);
        await store.expenseReceipts.fileAsExpense({ organizationId: w.a.id, receiptId: r.id, userId: w.user.id, expense: w.expense(), approved }, when(ms));
      };
      // Read right; amount edited; currency edited (counts against amount too); no suggestion at all; outside the range.
      await approve(suggestion, w.approved(), 10);
      await approve(suggestion, w.approved({ amountMinor: '1600' }), 20);
      await approve(suggestion, w.approved({ currency: 'USD' }), 30);
      await approve(undefined, w.approved(), 40);
      await approve(suggestion, w.approved({ occurredOn: '2026-10-20' }), 900);

      const rates = await store.expenseReceipts.editRates({ from: when(0), to: when(500) });
      expect(rates).toEqual({
        approved: 4,
        fields: { date: { suggested: 3, edited: 0 }, amount: { suggested: 3, edited: 2 }, currency: { suggested: 3, edited: 1 }, vendor: { suggested: 0, edited: 0 } },
        amountAndDate: { suggested: 3, unedited: 1 },
      });
    });
  });
}
