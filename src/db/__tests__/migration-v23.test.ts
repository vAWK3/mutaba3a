import { describe, it, expect, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { MiniCrmDatabase, MIGRATED_PAYMENT_NOTE } from '../database';

/**
 * MUT-60 (TD-029): a Received create used to write status/paidAt/
 * receivedAmountMinor straight onto the Transaction with no PaymentRecord.
 * v23 backfills one PaymentRecord per uncovered amount for data written
 * before this ticket -- generalizing v18's backfill (which assumed zero
 * existing records) to subtract whatever records already exist.
 */

let counter = 0;
const uniqueName = () => `mutaba3a-v23-test-${Date.now()}-${counter++}`;
const opened: Dexie[] = [];

/** v23 adds no stores, so the current schema is exactly what a v22 build left on disk. */
function currentSchema(): Record<string, string> {
  const probe = new MiniCrmDatabase(uniqueName());
  return Object.fromEntries(
    probe.tables.map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(', ')])
  );
}

const now = '2026-10-01T09:00:00.000Z';

async function createV22Database(
  name: string,
  rows: { transactions?: object[]; paymentRecords?: object[] }
): Promise<void> {
  const v22 = new Dexie(name);
  v22.version(22).stores(currentSchema());
  await v22.open();
  for (const t of rows.transactions ?? []) await v22.table('transactions').add(t);
  for (const r of rows.paymentRecords ?? []) await v22.table('paymentRecords').add(r);
  v22.close();
}

async function openCurrent(name: string): Promise<MiniCrmDatabase> {
  const current = new MiniCrmDatabase(name);
  opened.push(current);
  await current.open();
  return current;
}

afterEach(async () => {
  for (const d of opened.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
  vi.restoreAllMocks();
});

describe('Migration v23: backfill payment records for uncovered paid income (MUT-60)', () => {
  it('backfills a fully-paid income transaction with no records', async () => {
    const name = uniqueName();
    await createV22Database(name, {
      transactions: [
        {
          id: 't1', kind: 'income', status: 'paid', amountMinor: 50000, currency: 'USD',
          occurredAt: '2026-09-01', paidAt: '2026-09-05', createdAt: now, updatedAt: now,
        },
      ],
    });

    const upgraded = await openCurrent(name);

    expect(upgraded.verno).toBe(23);
    const records = await upgraded.paymentRecords.where('transactionId').equals('t1').toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ amountMinor: 50000, paidAt: '2026-09-05', notes: MIGRATED_PAYMENT_NOTE });
  });

  it('backfills a part-paid (unpaid) transaction for only its receivedAmountMinor', async () => {
    const name = uniqueName();
    await createV22Database(name, {
      transactions: [
        {
          id: 't2', kind: 'income', status: 'unpaid', amountMinor: 120000, receivedAmountMinor: 40000,
          currency: 'ILS', occurredAt: '2026-09-10', createdAt: now, updatedAt: now,
        },
      ],
    });

    const upgraded = await openCurrent(name);

    const records = await upgraded.paymentRecords.where('transactionId').equals('t2').toArray();
    expect(records).toHaveLength(1);
    expect(records[0].amountMinor).toBe(40000);
  });

  it('falls back to occurredAt when paidAt is missing', async () => {
    const name = uniqueName();
    await createV22Database(name, {
      transactions: [
        {
          id: 't3', kind: 'income', status: 'paid', amountMinor: 20000, currency: 'USD',
          occurredAt: '2026-08-15', createdAt: now, updatedAt: now,
        },
      ],
    });

    const upgraded = await openCurrent(name);

    const records = await upgraded.paymentRecords.where('transactionId').equals('t3').toArray();
    expect(records[0].paidAt).toBe('2026-08-15');
  });

  it('clamps a future-dated legacy paidAt to today instead of manufacturing a future payment', async () => {
    const name = uniqueName();
    const futureDate = '2099-01-01';
    await createV22Database(name, {
      transactions: [
        {
          id: 't4', kind: 'income', status: 'paid', amountMinor: 15000, currency: 'USD',
          occurredAt: '2026-09-01', paidAt: futureDate, createdAt: now, updatedAt: now,
        },
      ],
    });

    const upgraded = await openCurrent(name);

    const records = await upgraded.paymentRecords.where('transactionId').equals('t4').toArray();
    expect(records[0].paidAt < futureDate).toBe(true);
    expect(new Date(records[0].paidAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('adds nothing when a transaction is already fully covered by an existing record', async () => {
    const name = uniqueName();
    await createV22Database(name, {
      transactions: [
        {
          id: 't5', kind: 'income', status: 'paid', amountMinor: 30000, currency: 'USD',
          occurredAt: '2026-09-01', paidAt: '2026-09-02', createdAt: now, updatedAt: now,
        },
      ],
      paymentRecords: [
        { id: 'pr1', transactionId: 't5', amountMinor: 30000, paidAt: '2026-09-02', createdAt: now, updatedAt: now },
      ],
    });

    const upgraded = await openCurrent(name);

    const records = await upgraded.paymentRecords.where('transactionId').equals('t5').toArray();
    expect(records).toHaveLength(1); // the original -- no second, migrated record added
  });

  it('tops up a transaction that is only partially covered by an existing record', async () => {
    const name = uniqueName();
    await createV22Database(name, {
      transactions: [
        {
          id: 't6', kind: 'income', status: 'paid', amountMinor: 30000, currency: 'USD',
          occurredAt: '2026-09-01', paidAt: '2026-09-02', createdAt: now, updatedAt: now,
        },
      ],
      paymentRecords: [
        { id: 'pr2', transactionId: 't6', amountMinor: 10000, paidAt: '2026-09-02', createdAt: now, updatedAt: now },
      ],
    });

    const upgraded = await openCurrent(name);

    const records = await upgraded.paymentRecords.where('transactionId').equals('t6').toArray();
    expect(records).toHaveLength(2);
    expect(records.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(30000);
  });

  it('skips a soft-deleted paid transaction', async () => {
    const name = uniqueName();
    await createV22Database(name, {
      transactions: [
        {
          id: 't7', kind: 'income', status: 'paid', amountMinor: 10000, currency: 'USD',
          occurredAt: '2026-09-01', paidAt: '2026-09-02', deletedAt: now, createdAt: now, updatedAt: now,
        },
      ],
    });

    const upgraded = await openCurrent(name);

    expect(await upgraded.paymentRecords.where('transactionId').equals('t7').toArray()).toHaveLength(0);
  });

  it('skips an archived paid transaction', async () => {
    const name = uniqueName();
    await createV22Database(name, {
      transactions: [
        {
          id: 't8', kind: 'income', status: 'paid', amountMinor: 10000, currency: 'USD',
          occurredAt: '2026-09-01', paidAt: '2026-09-02', archivedAt: now, createdAt: now, updatedAt: now,
        },
      ],
    });

    const upgraded = await openCurrent(name);

    expect(await upgraded.paymentRecords.where('transactionId').equals('t8').toArray()).toHaveLength(0);
  });

  it('skips expenses entirely -- payment records only apply to income', async () => {
    const name = uniqueName();
    await createV22Database(name, {
      transactions: [
        {
          id: 't9', kind: 'expense', status: 'paid', amountMinor: 5000, currency: 'USD',
          occurredAt: '2026-09-01', paidAt: '2026-09-02', createdAt: now, updatedAt: now,
        },
      ],
    });

    const upgraded = await openCurrent(name);

    expect(await upgraded.paymentRecords.where('transactionId').equals('t9').toArray()).toHaveLength(0);
  });

  it('opens an empty v22 database without an error', async () => {
    const errors = vi.spyOn(console, 'error');
    const name = uniqueName();
    await createV22Database(name, {});

    const upgraded = await openCurrent(name);

    expect(upgraded.verno).toBe(23);
    expect(errors).not.toHaveBeenCalled();
  });

  it('a fresh install is created at v23 and has no stray migrated records', async () => {
    const fresh = await openCurrent(uniqueName());

    expect(fresh.verno).toBe(23);
    expect(await fresh.paymentRecords.count()).toBe(0);
  });
});
