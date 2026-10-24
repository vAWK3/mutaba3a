import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaLedgerStore } from '../prisma.js';
import type { CreateExpenseReceiptInput, LedgerStore } from '../ports.js';
import { expenseLockHarness } from './expense-lock-harness.js';

/**
 * MUT-389: filing a receipt onto an existing expense locks the expense and decides under that lock. Deterministic: a
 * second connection holds the expense's row lock and makes the competing change (a 10th receipt, a delete); the filing
 * is seen waiting on that lock before the holder commits, so it must decide on the committed state. Without the lock
 * the filing would not wait at all, and would count 9 or read the expense as live.
 */

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma receipt filing lock (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  const holder = new PrismaClient({ datasources: { db: { url } } });
  const prober = new PrismaClient({ datasources: { db: { url } } });
  afterAll(async () => {
    await Promise.all([store.disconnect(), holder.$disconnect(), prober.$disconnect()]);
  });

  const MAX = 10;
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 22, 10, 0, 0, ms));

  async function seed(s: LedgerStore) {
    const o = await s.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user } = await s.users.create({ email: `p-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: o.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const expense = await s.expenses.create({ organizationId: o.id, occurredOn: '2026-10-21', amountMinor: 1_500n, currency: 'ILS', title: null, vendor: 'Cafe', categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at(1));
    const ready = async (expenseId: string | null) => {
      const input: CreateExpenseReceiptInput = { organizationId: o.id, expenseId, filename: 'scan.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, receivedOn: '2026-10-22', uploadedByUserId: user.id, requestId: null };
      const r = await s.expenseReceipts.create(input, at(2));
      return (await s.expenseReceipts.complete(o.id, r.id, at(3)))!;
    };
    return { o, expense, ready };
  }

  const { holdExpense, blockedBy } = expenseLockHarness(holder, prober);

  describe('Prisma receipt filing lock (MUT-389)', () => {
    it('a filing that waits while another takes the expense’s 10th place is refused once that commits', async () => {
      const { o, expense, ready } = await seed(store);
      for (let i = 0; i < MAX - 1; i += 1) await ready(expense.id);
      const rival = await ready(null);
      const mine = await ready(null);
      const hold = holdExpense(expense.id, (tx) => tx.$executeRaw`UPDATE "expense_receipts" SET "expenseId" = ${expense.id}::uuid, "filingStatus" = 'FILED' WHERE "id" = ${rival.id}::uuid`);
      const holderPid = await hold.isLocked;

      const filing = store.expenseReceipts.fileOntoExpense({ organizationId: o.id, receiptId: mine.id, expenseId: expense.id, maxReceipts: MAX });
      await blockedBy(holderPid);
      hold.release();
      await hold.done;

      expect((await filing).kind).toBe('too_many_receipts');
      expect(await store.expenseReceipts.listByExpense(o.id, expense.id)).toHaveLength(MAX);
      expect(await store.expenseReceipts.getById(o.id, mine.id)).toMatchObject({ filingStatus: 'TO_REVIEW', expenseId: null });
    });

    it('a filing that waits while the expense is deleted answers expense_not_found and leaves the receipt To review', async () => {
      const { o, expense, ready } = await seed(store);
      const mine = await ready(null);
      const hold = holdExpense(expense.id, (tx) => tx.$executeRaw`UPDATE "expenses" SET "deletedAt" = now() WHERE "id" = ${expense.id}::uuid`);
      const holderPid = await hold.isLocked;

      const filing = store.expenseReceipts.fileOntoExpense({ organizationId: o.id, receiptId: mine.id, expenseId: expense.id, maxReceipts: MAX });
      await blockedBy(holderPid);
      hold.release();
      await hold.done;

      expect((await filing).kind).toBe('expense_not_found');
      expect(await store.expenseReceipts.getById(o.id, mine.id)).toMatchObject({ filingStatus: 'TO_REVIEW', expenseId: null });
    });

    it('a delete that waits while a filing commits first sends the just-filed receipt back to To review (never FILED on a deleted expense)', async () => {
      const { o, expense, ready } = await seed(store);
      const mine = await ready(null);
      // The holder plays the filing: the expense lock, then the receipt moved to FILED on it.
      const hold = holdExpense(expense.id, (tx) => tx.$executeRaw`UPDATE "expense_receipts" SET "expenseId" = ${expense.id}::uuid, "filingStatus" = 'FILED', "version" = "version" + 1 WHERE "id" = ${mine.id}::uuid`);
      const holderPid = await hold.isLocked;

      const deleting = store.expenses.softDelete(o.id, expense.id, at(9), 'unlink');
      await blockedBy(holderPid);
      hold.release();
      await hold.done;

      expect((await deleting)?.changed).toBe(true);
      expect(await store.expenseReceipts.getById(o.id, mine.id)).toMatchObject({ filingStatus: 'TO_REVIEW', expenseId: null, status: 'READY' });
    });
  });
}
