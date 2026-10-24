import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../database';
import { datasetRepo } from '../dataset';

/** MUT-291: the carry-over screen opens only when this browser has records to carry (a deleted row is not one). */
const STAMP = '2026-03-01T09:00:00.000Z';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('datasetRepo.countRecords', () => {
  it('is 0 on a fresh device, settings and businesses aside', async () => {
    await db.businessProfiles.add({ id: 'b1', name: 'B', defaultCurrency: 'ILS', isDefault: true, createdAt: STAMP, updatedAt: STAMP });
    expect(await datasetRepo.countRecords()).toBe(0);
  });

  it('counts clients, projects, entries and expenses that are not deleted', async () => {
    await db.clients.add({ id: 'c1', name: 'C', createdAt: STAMP, updatedAt: STAMP });
    await db.projects.add({ id: 'p1', name: 'P', createdAt: STAMP, updatedAt: STAMP });
    await db.transactions.bulkAdd([
      { id: 't1', kind: 'income', status: 'paid', amountMinor: 1, currency: 'ILS', occurredAt: '2026-02-01', createdAt: STAMP, updatedAt: STAMP },
      { id: 't2', kind: 'income', status: 'paid', amountMinor: 1, currency: 'ILS', occurredAt: '2026-02-01', createdAt: STAMP, updatedAt: STAMP, deletedAt: STAMP },
    ]);
    await db.expenses.add({ id: 'e1', profileId: 'b1', amountMinor: 1, currency: 'ILS', occurredAt: '2026-02-01', createdAt: STAMP, updatedAt: STAMP });
    expect(await datasetRepo.countRecords()).toBe(4);
  });
});
