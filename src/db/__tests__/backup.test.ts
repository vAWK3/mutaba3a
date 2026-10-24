import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../database';
import { settingsRepo } from '../repository';
import { restoreFromBackup, serializeAllTables } from '../backup';
import type { BusinessProfile } from '../../types';

/**
 * MUT-88 (ADR-072): restoring a backup sets `settings.lastBackupAt` to that
 * backup's own timestamp, since the data on the device is now exactly that
 * backup. `backUpNow` (the Back up button's stamp-on-success behaviour)
 * lives in `src/utils/backupDownload.ts`, the browser-only half (MUT-47);
 * its tests are there.
 */

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('serializeAllTables', () => {
  function failingTable(name: string) {
    const real = db.table.bind(db);
    vi.spyOn(db, 'table').mockImplementation(((table: string) => (table === name ? { toArray: () => Promise.reject(new Error('read failed')) } : real(table))) as typeof db.table);
  }

  it('a table it can\'t read comes out empty, so a backup download still gets the rest', async () => {
    failingTable('transactions');
    expect((await serializeAllTables()).tables.transactions).toEqual([]);
  });

  it('strict, a table it can\'t read fails the whole read: the carry-over never sends it as empty (MUT-291)', async () => {
    failingTable('transactions');
    await expect(serializeAllTables({ strict: true })).rejects.toThrow('read failed');
  });
});

describe('restoreFromBackup', () => {
  it('sets the last backup date to the restored backup\'s own timestamp', async () => {
    await settingsRepo.update({ lastBackupAt: '2026-10-13T09:12:00.000Z' });
    const backup = await serializeAllTables();
    backup.timestamp = '2026-09-01T08:00:00.000Z';

    await restoreFromBackup(JSON.stringify(backup));

    expect((await settingsRepo.get()).lastBackupAt).toBe('2026-09-01T08:00:00.000Z');
  });

  it('leaves one default business when the backup carried two', async () => {
    const backup = await serializeAllTables();
    backup.tables.businessProfiles = [
      { id: 'demo_business_profile_1', name: 'Sample', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'mine', name: 'Mine', isDefault: true, createdAt: '2026-05-01T00:00:00.000Z' },
    ] as BusinessProfile[];

    await restoreFromBackup(JSON.stringify(backup));

    const defaults = (await db.businessProfiles.toArray()).filter((p) => p.isDefault).map((p) => p.id);
    expect(defaults).toEqual(['mine']);
  });

  it('refuses a backup from a newer app version and keeps the data on the device', async () => {
    await db.clients.add({ id: 'c1', name: 'Acme', createdAt: 'x', updatedAt: 'x' } as never);
    const backup = await serializeAllTables();
    backup.version = db.verno + 1;

    await expect(restoreFromBackup(JSON.stringify(backup))).rejects.toThrow(/newer version/);

    expect(await db.clients.count()).toBe(1);
  });
});
