import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../database';
import { serializeAllTables, restoreFromBackup } from '../backup';
import type { MonthCloseStatus } from '../retained/monthCloseSchema';

/**
 * MUT-14 removed the month-close checklist UI and repository. The table is
 * retained (ADR-029): rows written by older builds must survive, round-trip
 * through backup and restore, and keep their checklist as an opaque record.
 */
const status: MonthCloseStatus = {
  id: 'p1:2026-09',
  profileId: 'p1',
  monthKey: '2026-09',
  isClosed: true,
  closedAt: '2026-10-01T09:00:00.000Z',
  checklist: { receiptsLinked: true, recurringConfirmed: true, categorized: false, zipExported: true },
  notes: 'closed by the old checklist page',
  createdAt: '2026-09-30T18:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

describe('retained month-close schema', () => {
  beforeEach(async () => {
    await db.monthCloseStatuses.clear();
  });

  it('keeps the monthCloseStatuses table in the Dexie schema at v20', () => {
    expect(db.tables.map((t) => t.name)).toContain('monthCloseStatuses');
    expect(db.verno).toBe(20);
  });

  it('stores and reads back a pre-existing row unchanged', async () => {
    await db.monthCloseStatuses.add(status);
    expect(await db.monthCloseStatuses.get(status.id)).toEqual(status);
  });

  it('round-trips rows through backup and restore', async () => {
    await db.monthCloseStatuses.add(status);
    const backup = await serializeAllTables();
    expect(backup.tables.monthCloseStatuses).toEqual([status]);

    await db.monthCloseStatuses.clear();
    await restoreFromBackup(JSON.stringify(backup));
    expect(await db.monthCloseStatuses.get(status.id)).toEqual(status);
  });
});
