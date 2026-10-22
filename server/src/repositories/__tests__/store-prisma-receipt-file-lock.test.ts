import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaLedgerStore } from '../prisma.js';
import type { CreateExpenseReceiptInput, LedgerStore } from '../ports.js';

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
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  /** Holds the expense's row lock from another connection, runs `change` under it, and commits on release(). */
  function holdExpense(expenseId: string, change: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<unknown>) {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const done = holder.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "expenses" WHERE "id" = ${expenseId}::uuid FOR NO KEY UPDATE`;
      await change(tx);
      locked();
      await released;
    }, { timeout: 20_000 });
    return { isLocked, release, done };
  }

  /** Resolves once some session is waiting for a row lock while locking an expense, i.e. the filing is queued. */
  async function filingIsWaiting(): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      const [row] = await prober.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "expenses"%FOR NO KEY UPDATE%'`;
      if (row && row.n > 0) return;
      await sleep(20);
    }
    throw new Error('the filing never waited on the expense lock');
  }

  describe('Prisma receipt filing lock (MUT-389)', () => {
    it('a filing that waits while another takes the expense’s 10th place is refused once that commits', async () => {
      const { o, expense, ready } = await seed(store);
      for (let i = 0; i < MAX - 1; i += 1) await ready(expense.id);
      const rival = await ready(null);
      const mine = await ready(null);
      const hold = holdExpense(expense.id, (tx) => tx.$executeRaw`UPDATE "expense_receipts" SET "expenseId" = ${expense.id}::uuid, "filingStatus" = 'FILED' WHERE "id" = ${rival.id}::uuid`);
      await hold.isLocked;

      const filing = store.expenseReceipts.fileOntoExpense({ organizationId: o.id, receiptId: mine.id, expenseId: expense.id, maxReceipts: MAX }, at(9));
      await filingIsWaiting();
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
      await hold.isLocked;

      const filing = store.expenseReceipts.fileOntoExpense({ organizationId: o.id, receiptId: mine.id, expenseId: expense.id, maxReceipts: MAX }, at(9));
      await filingIsWaiting();
      hold.release();
      await hold.done;

      expect((await filing).kind).toBe('expense_not_found');
      expect(await store.expenseReceipts.getById(o.id, mine.id)).toMatchObject({ filingStatus: 'TO_REVIEW', expenseId: null });
    });
  });
}
