import { describe, expect, it } from 'vitest';
import type { EntryRow, FeedPageRequest, LedgerStore, Organization } from '../ports.js';

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
      await store.expenses.softDelete(w.a.id, deletedExpense.id, at(2), 'unlink');
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
      // MUT-390: the money-date order leaves out the same rows.
      expect((await store.entries.list([w.a.id, w.b.id], { limit: 10, cursor: null, order: 'occurredOn' })).items.map(idOf)).toEqual([`payment:${reversed.id}`]);
    });

    it('links a settle payment to the Owed it paid, and nothing else', async () => {
      const store = await makeStore();
      const w = await world(store);
      const owed = await w.owed(1);
      const other = await w.owed(2);
      const pay = (allocations: Array<{ receivableId: string; amountMinor: bigint }>, s: number) =>
        store.payments.create({ organizationId: w.b.id, customerId: w.client.id, projectId: null, currency: 'ILS', amountMinor: 50_000n, receivedOn: '2026-10-08', method: 'CASH', reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: w.user.id, origin: 'CAPTURE', captureSource: null, allocations }, at(s));
      const settle = (await pay([{ receivableId: owed.id, amountMinor: 50_000n }], 3)).payment;
      const split = (await pay([{ receivableId: other.id, amountMinor: 25_000n }, { receivableId: (await w.owed(4)).id, amountMinor: 25_000n }], 5)).payment;
      const bare = await w.capture(w.b.id, 6);
      const project = await store.projects.create({ organizationId: w.b.id, customerId: w.client.id, name: 'Case', currency: 'ILS' }, at(7));
      const { installments } = await store.agreements.create(
        {
          organizationId: w.b.id, projectId: project.id, customerId: w.client.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0,
          amountMinor: 50_000n, netMinor: 50_000n, vatMinor: 0n, grossMinor: 50_000n, agreementDate: '2026-10-08', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null,
          installments: [{ position: 1, label: 'I1', amountMinor: 50_000n, netMinor: 50_000n, vatMinor: 0n, grossMinor: 50_000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
        },
        at(8),
      );
      const posted = await store.agreements.postInstallment(w.b.id, installments[0]!.id, { postingDate: '2026-10-08', dueDate: '2026-10-31', at: at(9) });
      const toInstallment = (await pay([{ receivableId: posted!.receivable.id, amountMinor: 50_000n }], 10)).payment;

      const links = await store.entries.settledOwedIds([w.b.id], [settle.id, split.id, bare.id, toInstallment.id]);

      expect(links.get(settle.id)).toBe(owed.id);
      expect(links.has(split.id)).toBe(false); // more than one allocation: not one Owed's settle
      expect(links.has(bare.id)).toBe(false);
      expect(links.has(toInstallment.id)).toBe(false); // one allocation, but to a scheduled installment, not an Owed
      expect((await store.entries.settledOwedIds([w.a.id], [settle.id])).size).toBe(0);
      expect((await store.entries.settledOwedIds([w.b.id], [])).size).toBe(0);
    });

    it('counts READY, live receipts per expense, within the given organizations', async () => {
      const store = await makeStore();
      const w = await world(store);
      const e1 = await w.expense(w.a.id, 1);
      const e2 = await w.expense(w.a.id, 2);
      const receipt = async (expenseId: string, state: 'ready' | 'pending' | 'deleted') => {
        const r = await store.expenseReceipts.create({ organizationId: w.a.id, expenseId, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, receivedOn: '2026-10-11', uploadedByUserId: w.user.id, requestId: null }, at(3));
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

  describe(`${name} LedgerStore entries contract, money-date order and filters (MUT-390)`, () => {
    /** A world whose rows carry their own money dates, logged at `at(s)`. */
    async function dated(store: LedgerStore) {
      const w = await world(store);
      const expense = (organizationId: string, occurredOn: string, s: number) =>
        store.expenses.create({ organizationId, occurredOn, amountMinor: 4_000n, currency: 'ILS', title: 'Paper', vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: w.user.id }, at(s));
      const conversion = (organizationId: string, occurredOn: string, s: number) =>
        store.conversions.create({ organizationId, occurredOn, amountMinor: 10_000n, currency: 'USD', toAmountMinor: 36_500n, toCurrency: 'ILS', notes: null, createdByUserId: w.user.id }, at(s));
      const capture = (organizationId: string, receivedOn: string, s: number) =>
        store.payments.capture({ organizationId, customerId: null, projectId: null, currency: 'ILS', amountMinor: 25_000n, receivedOn, method: 'CASH', notes: null, requestId: null, createdByUserId: w.user.id, captureSource: 'app' }, at(s));
      const owed = (postingDate: string, s: number) =>
        store.receivables.createAdjustment(
          { organizationId: w.b.id, customerId: w.client.id, projectId: null, currency: 'ILS', netMinor: 50_000n, vatMinor: 0n, grossMinor: 50_000n, vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, title: 'Logo', dueDate: '2026-10-31', postingDate, postedAt: at(s), createdByUserId: w.user.id, requestId: null },
          at(s),
        );
      return { ...w, expense, conversion, capture, owed };
    }

    async function walk(store: LedgerStore, organizationIds: string[], request: Omit<FeedPageRequest, 'cursor'>): Promise<string[]> {
      const seen: string[] = [];
      let cursor: FeedPageRequest['cursor'] = null;
      do {
        const page = await store.entries.list(organizationIds, { ...request, cursor });
        expect(page.items.length).toBeLessThanOrEqual(request.limit);
        seen.push(...page.items.map((r) => r.record.id));
        cursor = page.nextCursor;
      } while (cursor);
      return seen;
    }

    it('orders by money day, then newest logged, across kinds and profiles, and pages without gaps or repeats', async () => {
      const store = await makeStore();
      const w = await dated(store);
      // Logged in an order unrelated to their money dates; three share 2026-10-20 and two share one instant.
      const e1 = await w.expense(w.a.id, '2026-10-20', 1);
      const o1 = await w.owed('2026-10-14', 9); // logged last, dated earliest: sorts by postingDate
      const p1 = await w.capture(w.b.id, '2026-10-20', 4);
      const c1 = await w.conversion(w.a.id, '2026-10-18', 4);
      const e2 = await w.expense(w.b.id, '2026-10-20', 4);
      const future = await w.expense(w.a.id, '2026-10-25', 2); // dated ahead: above every other day
      const e3 = await w.expense(w.a.id, '2026-10-18', 7);
      await w.expense(w.other.id, '2026-10-21', 5);

      const all = (await store.entries.list([w.a.id, w.b.id], { limit: 20, cursor: null, order: 'occurredOn' })).items;
      const sameInstant = [p1.id, e2.id].sort().reverse(); // logged at once: id descending
      expect(all.map((r) => r.record.id)).toEqual([future.id, ...sameInstant, e1.id, e3.id, c1.id, o1.id]);

      expect(await walk(store, [w.a.id, w.b.id], { limit: 2, order: 'occurredOn' })).toEqual(all.map((r) => r.record.id));
    });

    it('applies occurredFrom and occurredBefore to the money-date order across pages', async () => {
      const store = await makeStore();
      const w = await dated(store);
      const days = ['2026-10-13', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-19', '2026-10-21'];
      const made = await Promise.all(days.map((d, i) => w.expense(w.a.id, d, i + 1)));
      const between = made.filter((r) => r.occurredOn >= '2026-10-15' && r.occurredOn < '2026-10-21').map((r) => r.id).reverse();

      expect(await walk(store, [w.a.id], { limit: 2, order: 'occurredOn', occurredFrom: '2026-10-15', occurredBefore: '2026-10-21' })).toEqual(between);
      expect(await walk(store, [w.a.id], { limit: 2, order: 'occurredOn', occurredFrom: '2026-10-19' })).toEqual([made[5]!.id, made[4]!.id]);
    });

    it('applies the day filters to every kind by its own money date', async () => {
      const store = await makeStore();
      const w = await dated(store);
      const payment = await w.capture(w.b.id, '2026-10-16', 1);
      await w.capture(w.b.id, '2026-10-21', 2);
      const owed = await w.owed('2026-10-15', 3); // its dueDate, 2026-10-31, is outside the window: only postingDate counts
      await w.owed('2026-10-14', 4);
      const conversion = await w.conversion(w.a.id, '2026-10-20', 5);
      await w.conversion(w.a.id, '2026-10-21', 6);
      const expense = await w.expense(w.a.id, '2026-10-18', 7);
      await w.expense(w.a.id, '2026-10-12', 8);

      expect(await walk(store, [w.a.id, w.b.id], { limit: 1, order: 'occurredOn', occurredFrom: '2026-10-15', occurredBefore: '2026-10-21' })).toEqual([
        conversion.id,
        expense.id,
        payment.id,
        owed.id,
      ]);
    });

    it('finds what was logged since an instant but dated before a day, across pages, newest logged first', async () => {
      const store = await makeStore();
      const w = await dated(store);
      await w.expense(w.a.id, '2026-10-01', 1); // dated earlier, but logged before loggedSince
      const backdated = [await w.expense(w.a.id, '2026-09-30', 10), await w.capture(w.b.id, '2026-10-02', 11), await w.conversion(w.a.id, '2026-10-05', 12)];
      await w.expense(w.a.id, '2026-10-16', 13); // logged since, but inside the window

      expect(await walk(store, [w.a.id, w.b.id], { limit: 2, loggedSince: at(10), occurredBefore: '2026-10-12' })).toEqual(backdated.map((r) => r.id).reverse());
    });

    it('moves an entry when its money date is edited: re-read after moving older, it shows again further down', async () => {
      const store = await makeStore();
      const w = await dated(store);
      const moved = await w.expense(w.a.id, '2026-10-20', 1);
      const middle = await w.expense(w.a.id, '2026-10-19', 2);
      const oldest = await w.expense(w.a.id, '2026-10-10', 3);

      const first = await store.entries.list([w.a.id], { limit: 1, cursor: null, order: 'occurredOn' });
      expect(first.items.map((r) => r.record.id)).toEqual([moved.id]);
      const edited = await store.expenses.update(w.a.id, moved.id, moved.version, { occurredOn: '2026-10-11' }, at(4));
      expect(edited.kind).toBe('updated');

      // MUT-390 D3: a page is a snapshot; the rest of the walk now meets the moved row again.
      const rest: string[] = [];
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await store.entries.list([w.a.id], { limit: 1, cursor, order: 'occurredOn' });
        rest.push(...page.items.map((r) => r.record.id));
        cursor = page.nextCursor;
      }
      expect(rest).toEqual([middle.id, moved.id, oldest.id]);
    });
  });
}
