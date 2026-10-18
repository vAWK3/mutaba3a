import { describe, expect, it } from 'vitest';
import type { EntryRow, LedgerStore, Organization } from '../ports.js';

/**
 * MUT-270 storage contract: the entries feed. Newest logged first across expenses, payments, Owed (ADJUSTMENT)
 * receivables and conversions, over the organizations given; deleted rows, capture undos and scheduled
 * receivables are not entries.
 */
export function describeLedgerStoreEntriesContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (s: number) => new Date(Date.UTC(2026, 9, 18, 10, 0, s));
  const org = (store: LedgerStore, label: string): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const idOf = (row: EntryRow) => `${row.kind}:${row.record.id}`;

  async function world(store: LedgerStore) {
    const a = await org(store, 'A');
    const b = await org(store, 'B');
    const other = await org(store, 'Other');
    const { user } = await store.users.create({ email: `p-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: a.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const client = await store.customers.create({ organizationId: b.id, name: 'Acme', email: null, phone: null, notes: null, vatTreatment: 'OUT_OF_SCOPE' }, at(0));

    const expense = (organizationId: string, s: number) =>
      store.expenses.create({ organizationId, occurredOn: '2026-10-08', amountMinor: 4_000n, currency: 'ILS', title: 'Paper', vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at(s));
    const conversion = (organizationId: string, s: number) =>
      store.conversions.create({ organizationId, occurredOn: '2026-10-08', amountMinor: 10_000n, currency: 'USD', toAmountMinor: 36_500n, toCurrency: 'ILS', notes: null, createdByUserId: user.id }, at(s));
    const capture = (organizationId: string, s: number) =>
      store.payments.capture({ organizationId, customerId: null, projectId: null, currency: 'ILS', amountMinor: 25_000n, receivedOn: '2026-10-08', method: 'CASH', notes: null, requestId: null, createdByUserId: user.id, captureSource: 'app' }, at(s));
    const owed = (s: number) =>
      store.receivables.createAdjustment(
        { organizationId: b.id, customerId: client.id, projectId: null, currency: 'ILS', netMinor: 50_000n, vatMinor: 0n, grossMinor: 50_000n, vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, title: 'Logo', dueDate: '2026-10-31', postingDate: '2026-10-08', postedAt: at(s), createdByUserId: user.id, requestId: null },
        at(s),
      );
    return { a, b, other, user, client, expense, conversion, capture, owed };
  }

  describe(`${name} LedgerStore entries contract (MUT-270)`, () => {
    it('merges every kind across the given organizations, newest logged first, and nothing from others', async () => {
      const store = await makeStore();
      const w = await world(store);
      const e = await w.expense(w.a.id, 1);
      const p = await w.capture(w.b.id, 2);
      const c = await w.conversion(w.a.id, 3);
      const o = await w.owed(4);
      await w.expense(w.other.id, 5);

      const page = await store.entries.list([w.a.id, w.b.id], { limit: 10, cursor: null });

      expect(page.items.map(idOf)).toEqual([`receivable:${o.id}`, `conversion:${c.id}`, `payment:${p.id}`, `expense:${e.id}`]);
      expect(page.nextCursor).toBeNull();
      expect(page.items[0]!.record).toMatchObject({ organizationId: w.b.id, grossMinor: 50_000n, createdAt: at(4) });
    });

    it('pages without gaps or repeats, breaking equal instants by id', async () => {
      const store = await makeStore();
      const w = await world(store);
      // Three rows share one instant, so the id tie-break decides their order and the cursor must respect it.
      const made = [await w.expense(w.a.id, 1), await w.expense(w.a.id, 2), await w.conversion(w.a.id, 2), await w.expense(w.b.id, 2), await w.conversion(w.b.id, 3)];

      const seen: string[] = [];
      let cursor = null;
      do {
        const page: Awaited<ReturnType<LedgerStore['entries']['list']>> = await store.entries.list([w.a.id, w.b.id], { limit: 2, cursor });
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((r) => r.record.id));
        cursor = page.nextCursor;
      } while (cursor);

      expect(seen).toHaveLength(made.length);
      expect(new Set(seen)).toEqual(new Set(made.map((r) => r.id)));
      const all = (await store.entries.list([w.a.id, w.b.id], { limit: 10, cursor: null })).items.map((r) => r.record.id);
      expect(seen).toEqual(all);
    });

    it('leaves out deleted rows, capture undos and scheduled receivables; keeps a reversed payment', async () => {
      const store = await makeStore();
      const w = await world(store);
      const deletedExpense = await w.expense(w.a.id, 1);
      await store.expenses.softDelete(w.a.id, deletedExpense.id, at(2));
      const deletedConversion = await w.conversion(w.a.id, 3);
      await store.conversions.softDelete(w.a.id, deletedConversion.id, at(4));
      const undone = await w.capture(w.b.id, 5);
      await store.payments.undoCapture(w.b.id, undone.id, w.user.id, at(6));
      const voided = await w.owed(7);
      await store.receivables.softDeleteAdjustment(w.b.id, voided.id, at(8));
      const reversed = await w.capture(w.b.id, 9);
      await store.payments.reverse(w.b.id, reversed.id, 'bounced', at(10));

      // A posted installment: a scheduled receivable, not something a person logged.
      const project = await store.projects.create({ organizationId: w.b.id, customerId: w.client.id, name: 'Case', currency: 'ILS' }, at(11));
      const { installments } = await store.agreements.create(
        {
          organizationId: w.b.id, projectId: project.id, customerId: w.client.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0,
          amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, grossMinor: 1_000n, agreementDate: '2026-10-08', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null,
          installments: [{ position: 1, label: 'I1', amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, grossMinor: 1_000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
        },
        at(12),
      );
      const posted = await store.agreements.postInstallment(w.b.id, installments[0]!.id, { postingDate: '2026-10-08', dueDate: '2026-10-31', at: at(13) });
      expect(posted?.receivable.origin).toBe('INSTALLMENT');

      const page = await store.entries.list([w.a.id, w.b.id], { limit: 10, cursor: null });
      expect(page.items.map(idOf)).toEqual([`payment:${reversed.id}`]);
      expect(page.items[0]!.record).toMatchObject({ status: 'REVERSED', reversalReason: 'bounced' });
    });

    it('counts READY, live receipts per expense, within the given organizations', async () => {
      const store = await makeStore();
      const w = await world(store);
      const e1 = await w.expense(w.a.id, 1);
      const e2 = await w.expense(w.a.id, 2);
      const receipt = async (expenseId: string, state: 'ready' | 'pending' | 'deleted') => {
        const r = await store.expenseReceipts.create({ organizationId: w.a.id, expenseId, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, uploadedByUserId: w.user.id, requestId: null }, at(3));
        if (state !== 'pending') await store.expenseReceipts.complete(w.a.id, r.id, at(4));
        if (state === 'deleted') await store.expenseReceipts.softDelete(w.a.id, r.id, at(5));
      };
      await receipt(e1.id, 'ready');
      await receipt(e1.id, 'ready');
      await receipt(e1.id, 'pending');
      await receipt(e1.id, 'deleted');

      const counts = await store.expenseReceipts.countReadyByExpenseIds([w.a.id], [e1.id, e2.id]);
      expect(counts.get(e1.id)).toBe(2);
      expect(counts.has(e2.id)).toBe(false);
      expect((await store.expenseReceipts.countReadyByExpenseIds([w.b.id], [e1.id])).size).toBe(0);
      expect((await store.expenseReceipts.countReadyByExpenseIds([w.a.id], [])).size).toBe(0);
    });
  });
}
