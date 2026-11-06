import { describe, expect, it } from 'vitest';
import type { CreateUserInput, LedgerStore } from '../ports.js';

/**
 * MUT-314 storage contract (ADR-248): a period download's reads. The estimate counts by the feed's row rules (live
 * expenses, POSTED payments, money date in bounds, logged by `asOf`) and sums READY, live receipts on those expenses;
 * `listReadyByExpenseIds` returns one profile's READY, live receipts, oldest first; `names` answers only the profile's
 * own ids. Run against the memory store and Postgres.
 */
export function describeLedgerStorePeriodPackContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 6, 9, minute, 0));
  const userInput = (): CreateUserInput => ({
    email: `pack-${unique()}@studio-${unique()}.ps`,
    displayName: 'Rana Saleh',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: at(0),
  });

  async function world(store: LedgerStore) {
    const { user, personalOrganization } = await store.users.create(userInput());
    const other = await store.users.create(userInput());
    const org = personalOrganization.id;
    const expense = (occurredOn: string, minute = 1, organizationId = org) =>
      store.expenses.create(
        { organizationId, occurredOn, amountMinor: 1000n, currency: 'ILS', title: occurredOn, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, allocationNumber: null },
        at(minute),
      );
    const receipt = async (expenseId: string | null, sizeBytes: number, minute = 1, ready = true, organizationId = org) => {
      const r = await store.expenseReceipts.create({ organizationId, expenseId, filename: 'r.png', mimeType: 'image/png', sizeBytes, receivedOn: '2026-10-05', uploadedByUserId: user.id, requestId: null }, at(minute));
      await store.expenseReceipts.setKey(organizationId, r.id, `org/${organizationId}/r/${r.id}`);
      if (ready) await store.expenseReceipts.complete(organizationId, r.id, at(minute));
      return r.id;
    };
    const payment = (receivedOn: string, minute = 1) =>
      store.payments.capture({ organizationId: org, customerId: null, projectId: null, currency: 'ILS', amountMinor: 500n, receivedOn, method: 'CASH', notes: null, requestId: null, createdByUserId: user.id, captureSource: 'app' }, at(minute)).then((r) => r.payment);
    return { store, user, org, otherOrg: other.personalOrganization.id, expense, receipt, payment };
  }

  describe(`${name} LedgerStore period pack contract (MUT-314)`, () => {
    it('estimate: live expenses and POSTED payments in bounds, logged by asOf; READY live receipts on those expenses', async () => {
      const w = await world(await makeStore());
      const inside = await w.expense('2026-10-01');
      await w.expense('2026-10-31');
      await w.expense('2026-09-30');
      await w.expense('2026-11-01');
      const late = await w.expense('2026-10-15', 30);
      const deleted = await w.expense('2026-10-16');
      await w.store.expenses.softDelete(w.org, deleted.id, at(2), 'remove');
      await w.receipt(inside.id, 100);
      await w.receipt(inside.id, 50);
      await w.receipt(inside.id, 7, 1, false);
      await w.receipt(late.id, 1000);
      await w.receipt(deleted.id, 1000);
      await w.receipt(null, 1000);
      await w.payment('2026-10-10');
      const undone = await w.payment('2026-10-11');
      await w.store.payments.undoCapture(w.org, undone.id, w.user.id, at(3));
      await w.payment('2026-11-02');
      const bounds = { occurredFrom: '2026-10-01', occurredBefore: '2026-11-01' };
      expect(await w.store.periodPack.estimate(w.org, bounds, at(10))).toEqual({ expenses: 2, income: 1, receipts: 2, receiptBytes: 150 });
      expect(await w.store.periodPack.estimate(w.org, bounds, at(40))).toEqual({ expenses: 3, income: 1, receipts: 3, receiptBytes: 1150 });
      expect(await w.store.periodPack.estimate(w.org, { occurredBefore: '2026-11-01' }, at(10))).toMatchObject({ expenses: 3 });
      expect(await w.store.periodPack.estimate(w.otherOrg, bounds, at(40))).toEqual({ expenses: 0, income: 0, receipts: 0, receiptBytes: 0 });
    });

    it('listReadyByExpenseIds: READY, live, this profile’s, oldest upload first; none asked, none read', async () => {
      const w = await world(await makeStore());
      const a = await w.expense('2026-10-01');
      const b = await w.expense('2026-10-02');
      const second = await w.receipt(a.id, 10, 5);
      const first = await w.receipt(a.id, 10, 4);
      const onB = await w.receipt(b.id, 10, 6);
      await w.receipt(a.id, 10, 7, false);
      const removed = await w.receipt(a.id, 10, 8);
      await w.store.expenseReceipts.softDelete(w.org, removed, at(9));
      const rows = await w.store.expenseReceipts.listReadyByExpenseIds(w.org, [a.id, b.id]);
      expect(rows.map((r) => r.id)).toEqual([first, second, onB]);
      expect(rows[0]).toEqual({ id: first, expenseId: a.id, mimeType: 'image/png', sizeBytes: 10, storageKey: `org/${w.org}/r/${first}`, createdAt: at(4) });
      expect(await w.store.expenseReceipts.listReadyByExpenseIds(w.otherOrg, [a.id])).toEqual([]);
      expect(await w.store.expenseReceipts.listReadyByExpenseIds(w.org, [])).toEqual([]);
    });

    it('names: the profile’s customers, projects and vendors by id, and people by id; another profile’s ids are absent', async () => {
      const w = await world(await makeStore());
      const customer = await w.store.customers.create({ organizationId: w.org, name: 'Haddad Bakery', email: null, phone: null, notes: null }, at(1));
      const foreign = await w.store.customers.create({ organizationId: w.otherOrg, name: 'Not yours', email: null, phone: null, notes: null }, at(1));
      const project = await w.store.projects.create({ organizationId: w.org, customerId: customer.id, name: 'Menu', currency: 'ILS' }, at(1));
      const vendor = await w.store.vendors.resolve({ organizationId: w.org, name: 'مطبعة الأمل' }, at(1));
      const names = await w.store.periodPack.names(w.org, {
        customers: new Set([customer.id, foreign.id]),
        projects: new Set([project.id]),
        vendors: new Set([vendor!.id]),
        users: new Set([w.user.id]),
      });
      expect([...names.customers]).toEqual([[customer.id, 'Haddad Bakery']]);
      expect([...names.projects]).toEqual([[project.id, 'Menu']]);
      expect([...names.vendors]).toEqual([[vendor!.id, 'مطبعة الأمل']]);
      expect([...names.users]).toEqual([[w.user.id, 'Rana Saleh']]);
      const empty = await w.store.periodPack.names(w.org, { customers: new Set(), projects: new Set(), vendors: new Set(), users: new Set() });
      expect([empty.customers.size, empty.projects.size, empty.vendors.size, empty.users.size]).toEqual([0, 0, 0, 0]);
    });
  });
}
