import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../database';
import { settingsRepo } from '../repository';
import { backUpNow, restoreFromBackup, serializeAllTables } from '../backup';
import type { BusinessProfile } from '../../types';

/**
 * MUT-88 (ADR-072): Settings › Your data shows when the last backup was made.
 * `backUpNow` stamps `settings.lastBackupAt` only once the backup file was
 * produced; restoring a backup sets it to that backup's own timestamp, since
 * the data on the device is now exactly that backup.
 */

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  // jsdom has no object URLs; the download itself is not under test here.
  URL.createObjectURL = vi.fn(() => 'blob:backup');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('backUpNow', () => {
  it('downloads a full backup and records when it happened', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T09:12:00.000Z'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await backUpNow();

    expect(click).toHaveBeenCalledTimes(1);
    expect((await settingsRepo.get()).lastBackupAt).toBe('2026-10-13T09:12:00.000Z');
  });

  it('records nothing when the backup could not be produced', async () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error('blocked');
    });

    await expect(backUpNow()).rejects.toThrow('blocked');

    expect((await settingsRepo.get()).lastBackupAt).toBeUndefined();
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
