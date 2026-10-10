import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db/database';
import { settingsRepo } from '../../../db/repository';
import { serializeAllTables, restoreFromBackup } from '../../../db/backup';
import { DEFAULT_FEATURES } from '../features';
import { readFeatureFlags } from '../useFeatures';

const now = '2026-10-01T00:00:00.000Z';
const TABLES = ['expenses', 'receipts', 'vendors', 'recurringRules', 'recurringOccurrences', 'expenseCategories', 'monthCloseStatuses'] as const;

async function clearAll() {
  await Promise.all([...TABLES.map((name) => db.table(name).clear()), db.settings.clear()]);
}

async function seed() {
  await db.expenses.add({ id: 'e1', profileId: 'p1', amountMinor: 1000, currency: 'USD', occurredAt: '2026-10-01', vendorId: 'v1', createdAt: now, updatedAt: now } as never);
  await db.receipts.add({ id: 'r1', profileId: 'p1', expenseId: 'e1', monthKey: '2026-10', fileName: 'a.png', mimeType: 'image/png', sizeBytes: 1, data: btoa('x'), createdAt: now, updatedAt: now } as never);
  await db.vendors.add({ id: 'v1', profileId: 'p1', canonicalName: 'acme', aliases: ['ACME Inc'], createdAt: now } as never);
  await db.recurringRules.add({ id: 'rr1', profileId: 'p1', title: 'Hosting', frequency: 'monthly', createdAt: now } as never);
  await db.recurringOccurrences.add({ id: 'ro1', ruleId: 'rr1', createdAt: now } as never);
  await db.expenseCategories.add({ id: 'c1', profileId: 'p1', name: 'Travel', createdAt: now } as never);
  await db.monthCloseStatuses.add({ id: 'p1:2026-09', profileId: 'p1', monthKey: '2026-09', isClosed: true, checklist: {}, createdAt: now, updatedAt: now } as never);
}

const snapshot = () => Promise.all(TABLES.map((name) => db.table(name).toArray()));

describe('expense data after MUT-14: the switch is inert and every table round-trips the backup', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  it('flipping the Expenses switch off → on → off changes no row', async () => {
    await seed();
    const before = await snapshot();
    for (const on of [false, true, false]) {
      await settingsRepo.update({ features: { ...DEFAULT_FEATURES, expenses: on } });
      expect((await readFeatureFlags()).expenses).toBe(on);
    }
    expect(await snapshot()).toEqual(before);
    expect(db.verno).toBe(20);
  });

  it('receipts, vendors, recurring rules and month-close rows survive a backup → clear → restore', async () => {
    await seed();
    const before = await snapshot();
    const backup = await serializeAllTables();
    for (const name of TABLES) expect(backup.tables[name], name).toHaveLength(1);

    await Promise.all(TABLES.map((name) => db.table(name).clear()));
    await restoreFromBackup(JSON.stringify(backup));
    expect(await snapshot()).toEqual(before);

    // and the restore switched the Expenses area on for the restored data (MUT-12 reconcile)
    expect((await readFeatureFlags()).expenses).toBe(true);
  });
});
