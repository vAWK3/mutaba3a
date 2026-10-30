import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaLedgerStore } from '../prisma.js';
import type { CreateExpenseReceiptInput, LedgerStore } from '../ports.js';
import { expenseLockHarness } from './expense-lock-harness.js';

/**
 * MUT-397: a MUT-44 completion decides under the expense lock, the one MUT-389's filing takes. Deterministic: the
 * holder takes the expense's lock (and, in the first case, files a 10th receipt under it); the completions are seen
 * queued on it via pg_blocking_pids before it commits, so they must decide on the committed state. Without the lock
 * they wouldn't wait at all, `blockedBy` would never see them, and two completions at 9 could both win.
 */

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma receipt completion lock (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  const holder = new PrismaClient({ datasources: { db: { url } } });
  const prober = new PrismaClient({ datasources: { db: { url } } });
  afterAll(async () => {
    await Promise.all([store.disconnect(), holder.$disconnect(), prober.$disconnect()]);
  }, 30_000);
  const { holdExpense, blockedBy } = expenseLockHarness(holder, prober);

  const MAX = 10;
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 22, 10, 0, 0, ms));

  async function seed(s: LedgerStore) {
    const o = await s.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user } = await s.users.create({ email: `p-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: o.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const expense = await s.expenses.create({ organizationId: o.id, occurredOn: '2026-10-21', amountMinor: 1_500n, currency: 'ILS', title: null, vendor: 'Cafe', categoryId: null, customerId: null, projectId: null, notes: null, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, createdByUserId: user.id }, at(1));
    const upload = (expenseId: string | null): CreateExpenseReceiptInput => ({ organizationId: o.id, expenseId, filename: 'scan.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, receivedOn: '2026-10-22', uploadedByUserId: user.id, requestId: null });
    const pending = (expenseId: string | null) => s.expenseReceipts.create(upload(expenseId), at(2));
    const ready = async (expenseId: string | null) => (await s.expenseReceipts.complete(o.id, (await pending(expenseId)).id, at(3)))!;
    return { o, expense, pending, ready };
  }

  const complete = (organizationId: string, expenseId: string, receiptId: string) => store.expenseReceipts.completeOnExpense({ organizationId, expenseId, receiptId, maxReceipts: MAX }, at(5));

  // Lock tests wait on real sessions; a loaded machine stretches every round trip, so they get room beyond vitest's 5 s.
  const LOCK_TEST_MS = 30_000;

  describe('Prisma receipt completion lock (MUT-397)', () => {
    it('a completion that waits while a filing takes the expense’s 10th place is refused once that commits, and stays PENDING_UPLOAD', async () => {
      const { o, expense, pending, ready } = await seed(store);
      for (let i = 0; i < MAX - 1; i += 1) await ready(expense.id);
      const rival = await ready(null);
      const mine = await pending(expense.id);
      // The holder plays the filing (raw SQL in its own transaction: store.fileOntoExpense would itself wait on it).
      const hold = holdExpense(expense.id, (tx) => tx.$executeRaw`UPDATE "expense_receipts" SET "expenseId" = ${expense.id}::uuid, "filingStatus" = 'FILED' WHERE "id" = ${rival.id}::uuid`);
      const holderPid = await hold.isLocked;

      const completion = complete(o.id, expense.id, mine.id);
      await blockedBy(holderPid);
      hold.release();
      await hold.done;

      expect((await completion).kind).toBe('too_many_receipts');
      expect(await store.expenseReceipts.listByExpense(o.id, expense.id)).toHaveLength(MAX);
      expect(await store.expenseReceipts.getById(o.id, mine.id)).toMatchObject({ status: 'PENDING_UPLOAD' });
    }, LOCK_TEST_MS);

    it('two completions queued on the lock with one place left: exactly one wins and the expense ends at 10', async () => {
      const { o, expense, pending, ready } = await seed(store);
      for (let i = 0; i < MAX - 1; i += 1) await ready(expense.id);
      const first = await pending(expense.id);
      const second = await pending(expense.id);
      const hold = holdExpense(expense.id);
      const holderPid = await hold.isLocked;

      const completions = [first, second].map((r) => complete(o.id, expense.id, r.id));
      await blockedBy(holderPid, 2);
      hold.release();
      await hold.done;

      expect((await Promise.all(completions)).map((r) => r.kind).sort()).toEqual(['completed', 'too_many_receipts']);
      expect(await store.expenseReceipts.listByExpense(o.id, expense.id)).toHaveLength(MAX);
    }, LOCK_TEST_MS);

    it('a completion that waits while the expense is deleted answers expense_not_found', async () => {
      const { o, expense, pending } = await seed(store);
      const mine = await pending(expense.id);
      const hold = holdExpense(expense.id, (tx) => tx.$executeRaw`UPDATE "expenses" SET "deletedAt" = now() WHERE "id" = ${expense.id}::uuid`);
      const holderPid = await hold.isLocked;

      const completion = complete(o.id, expense.id, mine.id);
      await blockedBy(holderPid);
      hold.release();
      await hold.done;

      expect((await completion).kind).toBe('expense_not_found');
      expect(await store.expenseReceipts.getById(o.id, mine.id)).toMatchObject({ status: 'PENDING_UPLOAD' });
    }, LOCK_TEST_MS);
  });
}
