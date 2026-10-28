import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaLedgerStore } from '../prisma.js';
import { LockConflict } from '../memory.js';
import type { CreateInstallmentInput, LedgerStore, ReceivableRecord } from '../ports.js';

/**
 * MUT-130: payment writes lock receivables in id order, the order the contingency outcome writes use, so the two can
 * never deadlock; a lock conflict that still happens is a LockConflict (409), not a raw Prisma error (500).
 *
 * Deterministic: a second connection holds the LOWER receivable's row lock while the write runs. With id order the
 * write queues on that row before touching the higher one, so `FOR UPDATE NOWAIT` on the higher row succeeds.
 * In request order (higher id first) the write would already hold it and NOWAIT would fail with 55P03.
 */

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma payment lock order (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  const holder = new PrismaClient({ datasources: { db: { url } } });
  const prober = new PrismaClient({ datasources: { db: { url } } });
  afterAll(async () => {
    await Promise.all([store.disconnect(), holder.$disconnect(), prober.$disconnect()]);
  });

  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 8, 10, 0, 0, ms));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const inst = (position: number, amount: bigint): CreateInstallmentInput => ({
    position, label: `I${position}`, amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, vatTreatment: 'EXEMPT',
    rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null,
  });

  /** Two posted receivables, returned as [lower id, higher id]. */
  async function seed(s: LedgerStore) {
    const o = await s.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const c = await s.customers.create({ organizationId: o.id, name: 'Acme', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at(0));
    const p = await s.projects.create({ organizationId: o.id, customerId: c.id, name: 'Case', currency: 'ILS' }, at(1));
    const installments = [inst(1, 10000n), inst(2, 10000n)];
    const { installments: rows } = await s.agreements.create({ organizationId: o.id, projectId: p.id, customerId: c.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: 20000n, netMinor: 20000n, vatMinor: 0n, grossMinor: 20000n, agreementDate: '2026-10-08', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments }, at(2));
    const receivables: ReceivableRecord[] = [];
    for (const [i, row] of rows.entries()) receivables.push((await s.agreements.postInstallment(o.id, row.id, { postingDate: '2026-10-01', dueDate: `2026-10-1${i}`, at: at(3 + i) }))!.receivable);
    const [lo, hi] = [...receivables].sort((a, b) => (a.id < b.id ? -1 : 1));
    return { o, c, lo: lo!, hi: hi! };
  }

  const payment = (organizationId: string, customerId: string, allocations: Array<{ receivableId: string; amountMinor: bigint }>) => ({
    organizationId, customerId, projectId: null, currency: 'ILS', amountMinor: 20000n, receivedOn: '2026-10-08', method: 'BANK' as const,
    reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: 'req-1', createdByUserId: null, origin: 'INTEGRATION' as const, captureSource: null, allocations,
  });

  /** Holds a row lock on `id` from another connection until the returned release() is called. */
  function holdLock(id: string) {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const done = holder.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "receivables" WHERE "id" = ${id}::uuid FOR UPDATE`;
      locked();
      await released;
    }, { timeout: 20_000 });
    return { isLocked, release, done };
  }

  /** True when `id`'s row lock is free right now. */
  async function lockable(id: string): Promise<boolean> {
    try {
      await prober.$transaction((tx) => tx.$queryRaw`SELECT "id" FROM "receivables" WHERE "id" = ${id}::uuid FOR UPDATE NOWAIT`);
      return true;
    } catch {
      return false;
    }
  }

  describe('Prisma payment lock order (MUT-130)', () => {
    it('recording a payment locks its receivables in id order, whatever order the allocations come in', async () => {
      const { o, c, lo, hi } = await seed(store);
      const hold = holdLock(lo.id);
      await hold.isLocked;
      const write = store.payments.create(payment(o.id, c.id, [{ receivableId: hi.id, amountMinor: 10000n }, { receivableId: lo.id, amountMinor: 10000n }]), at(10));
      await sleep(300);
      expect(await lockable(hi.id)).toBe(true);
      hold.release();
      await hold.done;
      const { allocations } = await write;
      expect(allocations.map((a) => a.receivableId)).toEqual([hi.id, lo.id]);
    });

    it('reversing a payment locks its receivables in id order', async () => {
      const { o, c, lo, hi } = await seed(store);
      const { payment: paid } = await store.payments.create(payment(o.id, c.id, [{ receivableId: hi.id, amountMinor: 10000n }, { receivableId: lo.id, amountMinor: 10000n }]), at(10));
      const hold = holdLock(lo.id);
      await hold.isLocked;
      const write = store.payments.reverse(o.id, paid.id, 'wrong client', at(11));
      await sleep(300);
      expect(await lockable(hi.id)).toBe(true);
      hold.release();
      await hold.done;
      expect((await write)!.changed).toBe(true);
    });

    it('a deadlock the write loses surfaces as LockConflict, and nothing is written', async () => {
      const { o, c, lo, hi } = await seed(store);
      // The holder takes the HIGHER row; the write takes the lower one and queues on the higher; then the holder asks
      // for the lower one. Postgres breaks the cycle after deadlock_timeout by aborting the first waiter: the write.
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const holderDone = holder.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "receivables" WHERE "id" = ${hi.id}::uuid FOR UPDATE`;
        locked();
        await released;
        await tx.$queryRaw`SELECT "id" FROM "receivables" WHERE "id" = ${lo.id}::uuid FOR UPDATE`;
      }, { timeout: 20_000 });
      await isLocked;
      const write = store.payments.create(payment(o.id, c.id, [{ receivableId: lo.id, amountMinor: 10000n }, { receivableId: hi.id, amountMinor: 10000n }]), at(10));
      await sleep(300);
      release();
      await expect(write).rejects.toBeInstanceOf(LockConflict);
      await holderDone;
      expect((await store.payments.list(o.id, {}, { limit: 10, cursor: null })).items).toEqual([]);
    }, 20_000);
  });
}
