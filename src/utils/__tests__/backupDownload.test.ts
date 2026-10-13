import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../db/database';
import { settingsRepo } from '../../db/repository';
import { backUpNow } from '../backupDownload';

/**
 * MUT-88 (ADR-072): Settings › Your data shows when the last backup was
 * made. `backUpNow` stamps `settings.lastBackupAt` only once the download
 * was produced; this is the browser-only half of Back up (MUT-47) — the
 * data layer's own backup/restore tests live in `db/__tests__/backup.test.ts`.
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
