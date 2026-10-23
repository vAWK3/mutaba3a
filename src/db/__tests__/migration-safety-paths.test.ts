import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { db } from '../database';
import {
  createBackup,
  getLatestBackup,
  getAllBackups,
  restoreFromBackup,
  validateMigration,
  autoFixMigrationIssues,
  getMigrationLog,
  completeMigrationSafety,
  exportCompleteBackup,
  downloadBackup,
  importBackupFromFile,
  type MigrationBackup,
} from '../migration-safety';

/**
 * MUT-24 §C: the migration safety layer's failure and recovery paths, which
 * migration-safety.test.ts (the happy paths) never reached: the localStorage
 * fallback when the backup store fails, pruning to three backups, every
 * validation rule, auto-fix without a profile, the post-migration hook's
 * fix-and-revalidate branch, and file export/import.
 */

const now = '2026-10-01T09:00:00.000Z';
const LAST_KNOWN_VERSION_KEY = 'mutaba3a_last_known_version';
const EMERGENCY_KEY = 'mutaba3a_emergency_backup';
const LOG_KEY = 'mutaba3a_migration_log';

/**
 * The module keeps its backup Dexie private; reach the open connection to make
 * it fail on cue. Dexie 4 gives `db.backups` and `db.table('backups')` separate
 * Table instances, so spy on the property the module calls.
 */
async function backupStore(): Promise<Dexie.Table> {
  await getAllBackups();
  const backup = Dexie.connections.find((c) => c.name === 'mutaba3a_backup');
  if (!backup) throw new Error('backup database not open');
  return (backup as unknown as { backups: Dexie.Table }).backups;
}

/** jsdom's Blob and File have no text(), so read them with FileReader. */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const backupFile = (content: string) => Object.assign(new File([content], 'backup.json'), { text: () => Promise.resolve(content) });

const profile = (id: string, isDefault = true) => ({ id, name: id, isDefault, createdAt: now });
const client = (id: string, extra: object = {}) => ({ id, name: id, createdAt: now, updatedAt: now, ...extra });
const income = (id: string, extra: object = {}) => ({
  id, kind: 'income' as const, status: 'unpaid' as const, amountMinor: 1000, currency: 'USD' as const,
  occurredAt: '2026-09-01', createdAt: now, updatedAt: now, ...extra,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  const store = await backupStore();
  await store.clear();
  localStorage.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('migration log', () => {
  it('keeps only the last 50 events', async () => {
    const old = Array.from({ length: 50 }, (_, i) => ({ type: 'backup_created', version: i, timestamp: now }));
    localStorage.setItem(LOG_KEY, JSON.stringify(old));

    await createBackup('one more');

    const log = getMigrationLog();
    expect(log).toHaveLength(50);
    expect(log[0].version).toBe(1);
    expect(log[49]).toMatchObject({ type: 'backup_created', details: 'one more' });
  });

  it('reads a corrupt log as empty', () => {
    localStorage.setItem(LOG_KEY, '{not json');
    expect(getMigrationLog()).toEqual([]);
  });

  it('warns and carries on when the log cannot be written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    await expect(createBackup()).resolves.toMatchObject({ version: db.verno });
    expect(warn).toHaveBeenCalledWith('Failed to log migration event:', expect.any(Error));
  });
});

describe('createBackup', () => {
  it('keeps the newest three backups', async () => {
    const store = await backupStore();
    for (let i = 1; i <= 3; i++) {
      await store.add({ version: 24, timestamp: `2026-10-0${i}T00:00:00.000Z`, tables: {}, checksum: '0' });
    }

    const latest = await createBackup();

    const kept = await getAllBackups();
    expect(kept).toHaveLength(3);
    expect(kept.map((b) => b.timestamp)).toEqual([latest.timestamp, '2026-10-03T00:00:00.000Z', '2026-10-02T00:00:00.000Z']);
  });

  it('stamps the backup with the app version when the build defines one', async () => {
    vi.stubGlobal('__APP_VERSION__', '0.0.99');

    expect((await createBackup()).appVersion).toBe('0.0.99');
    vi.unstubAllGlobals();
  });

  it('skips a table it cannot read and backs up the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.clients.add(client('c1', { profileId: 'bp1' }));
    vi.spyOn(db.vendors, 'toArray').mockRejectedValue(new Error('gone'));

    const backup = await createBackup();

    expect(backup.tables).not.toHaveProperty('vendors');
    expect(backup.tables.clients).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith('[Migration Safety] Could not backup table vendors:', expect.any(Error));
  });

  it('falls back to an emergency copy of the essential tables when the backup store fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.clients.add(client('c1', { profileId: 'bp1' }));
    await db.vendors.add({ id: 'v1', profileId: 'bp1', canonicalName: 'shop', createdAt: now } as never);
    vi.spyOn(await backupStore(), 'add').mockRejectedValue(new Error('store full'));

    await createBackup();

    const emergency = JSON.parse(localStorage.getItem(EMERGENCY_KEY) ?? '{}');
    expect(emergency.version).toBe(db.verno);
    expect(Object.keys(emergency.tables).sort()).toEqual(['businessProfiles', 'clients', 'projects', 'settings', 'transactions']);
    expect(emergency.tables.clients).toEqual([expect.objectContaining({ id: 'c1' })]);
  });

  it('logs an error when the emergency copy cannot be written either', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(await backupStore(), 'add').mockRejectedValue(new Error('store full'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    await expect(createBackup()).resolves.toBeDefined();
    expect(error).toHaveBeenCalledWith('[Migration Safety] Failed to create emergency backup:', expect.any(Error));
  });
});

describe('reading backups when the store fails', () => {
  async function breakStore() {
    vi.spyOn(await backupStore(), 'orderBy').mockImplementation(() => {
      throw new Error('store closed');
    });
  }

  it('getLatestBackup returns the emergency copy', async () => {
    await breakStore();
    localStorage.setItem(EMERGENCY_KEY, JSON.stringify({ version: 23, timestamp: now, tables: { clients: [] } }));

    expect(await getLatestBackup()).toEqual({ version: 23, timestamp: now, tables: { clients: [] } });
  });

  it('getLatestBackup returns null with no emergency copy, or a corrupt one', async () => {
    await breakStore();
    expect(await getLatestBackup()).toBeNull();

    localStorage.setItem(EMERGENCY_KEY, '{oops');
    expect(await getLatestBackup()).toBeNull();
  });

  it('getAllBackups returns an empty list', async () => {
    await breakStore();
    expect(await getAllBackups()).toEqual([]);
  });
});

describe('restoreFromBackup', () => {
  const backupOf = (tables: Record<string, unknown>, checksum = 'stale'): MigrationBackup =>
    ({ version: 24, timestamp: now, tables, checksum }) as MigrationBackup;

  it('restores despite a checksum mismatch, ignoring unknown tables and non-list data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.clients.add(client('old', { profileId: 'bp1' }));

    const ok = await restoreFromBackup(backupOf({
      clients: [client('c1', { profileId: 'bp1' })],
      projects: [],
      opLog: [{ id: 'op1' }],
      settings: 'not-a-list',
    }));

    expect(ok).toBe(true);
    expect((await db.clients.toArray()).map((c) => c.id)).toEqual(['c1']);
    expect(warn).toHaveBeenCalledWith('[Migration Safety] Backup checksum mismatch, proceeding anyway');
    expect(getMigrationLog().map((e) => e.type)).toEqual(['rollback_started', 'rollback_completed']);
  });

  it('returns false and keeps the current rows when a table cannot be restored', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.clients.add(client('keep', { profileId: 'bp1' }));

    const ok = await restoreFromBackup(backupOf({ clients: [client('dup'), client('dup')] }));

    expect(ok).toBe(false);
    expect((await db.clients.toArray()).map((c) => c.id)).toEqual(['keep']);
    expect(error).toHaveBeenCalledWith('[Migration Safety] Restore failed:', expect.anything());
  });
});

describe('validateMigration', () => {
  it('reports every core record missing a profile, ignoring archived and deleted ones', async () => {
    await db.projects.bulkAdd([
      { id: 'p1', name: 'p1', createdAt: now, updatedAt: now },
      { id: 'p-archived', name: 'p', createdAt: now, updatedAt: now, archivedAt: now },
    ] as never);
    await db.transactions.bulkAdd([
      income('t1', { receivedAmountMinor: 0 }),
      income('t-deleted', { receivedAmountMinor: 0, deletedAt: now }),
    ] as never);

    const result = await validateMigration();

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'projects', severity: 'error', count: 1 }),
      expect.objectContaining({ table: 'transactions', severity: 'error', message: '1 transactions missing profileId' }),
    ]));
    expect(getMigrationLog().at(-1)).toMatchObject({ type: 'validation_failed' });
  });

  it('reports engagements missing a profile', async () => {
    await db.engagements.add({ id: 'e1', type: 'design', status: 'draft' } as never);

    const result = await validateMigration();

    expect(result.issues).toEqual([expect.objectContaining({ table: 'engagements', severity: 'error', count: 1 })]);
  });

  it('warns about transactions pointing at missing clients or projects without failing', async () => {
    await db.transactions.bulkAdd([
      income('t1', { profileId: 'bp1', receivedAmountMinor: 0, clientId: 'ghost' }),
      income('t2', { profileId: 'bp1', receivedAmountMinor: 0, projectId: 'ghost' }),
      income('t3', { profileId: 'bp1', receivedAmountMinor: 0, clientId: 'ghost', deletedAt: now }),
    ] as never);

    const result = await validateMigration();

    expect(result.success).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: 'warning', message: '1 transactions reference non-existent clients' }),
      expect.objectContaining({ severity: 'warning', message: '1 transactions reference non-existent projects' }),
    ]);
  });

  it('turns a failed check into a warning instead of throwing', async () => {
    vi.spyOn(db.clients, 'filter').mockImplementation(() => {
      throw new Error('profiles exploded');
    });
    vi.spyOn(db.transactions, 'filter').mockImplementation(() => {
      throw new Error('transactions exploded');
    });

    const result = await validateMigration();

    expect(result.issues.map((i) => i.message)).toEqual([
      'Profile validation failed: Error: profiles exploded',
      'Partial payment validation failed: Error: transactions exploded',
      'Reference validation failed: Error: transactions exploded',
    ]);
    expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('autoFixMigrationIssues', () => {
  it('fixes nothing without a business profile', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.clients.add(client('c1'));

    expect(await autoFixMigrationIssues()).toBe(0);
    expect((await db.clients.get('c1'))?.profileId).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[Migration Safety] No business profile found, cannot fix profileId issues');
  });

  it('uses the first profile when none is default and also fixes engagements', async () => {
    await db.businessProfiles.add(profile('first', false) as never);
    await db.engagements.add({ id: 'e1', type: 'design', status: 'draft' } as never);

    expect(await autoFixMigrationIssues()).toBe(1);
    expect((await db.engagements.get('e1'))?.profileId).toBe('first');
  });

  it('fixes transactions with no profile and partial-payment totals in one pass', async () => {
    await db.businessProfiles.add(profile('bp1') as never);
    await db.transactions.bulkAdd([income('t1'), income('t2', { profileId: 'bp1', status: 'paid' })] as never);

    expect(await autoFixMigrationIssues()).toBe(3);
    expect(await db.transactions.get('t1')).toMatchObject({ profileId: 'bp1', receivedAmountMinor: 0 });
    expect((await db.transactions.get('t2'))?.receivedAmountMinor).toBe(1000);
  });

  it('reports zero when everything is already in order', async () => {
    await db.businessProfiles.add(profile('bp1') as never);
    await db.clients.add(client('c1', { profileId: 'bp1' }));

    expect(await autoFixMigrationIssues()).toBe(0);
  });
});

describe('on a database older than the rules', () => {
  // The profile rules start at v13, received amounts at v14, engagement profiles at v10.
  // Dexie's verno is a plain field on the open database, so set it and put it back.
  it('validates and fixes only what that version had', async () => {
    await db.businessProfiles.add(profile('bp1') as never);
    await db.clients.add(client('c1'));
    await db.transactions.add(income('t1') as never);
    await db.engagements.add({ id: 'e1', type: 'design', status: 'draft' } as never);
    const realVersion = db.verno;
    db.verno = 9;
    try {
      expect((await validateMigration()).issues).toEqual([]);
      expect(await autoFixMigrationIssues()).toBe(0);
    } finally {
      db.verno = realVersion;
    }
    expect((await db.clients.get('c1'))?.profileId).toBeUndefined();
  });
});

describe('completeMigrationSafety', () => {
  it('does nothing on a fresh install', async () => {
    expect(await completeMigrationSafety()).toBeNull();
    expect(localStorage.getItem(LAST_KNOWN_VERSION_KEY)).toBe(String(db.verno));
  });

  it('backs up and validates after an upgrade', async () => {
    localStorage.setItem(LAST_KNOWN_VERSION_KEY, '23');

    const result = await completeMigrationSafety();

    expect(result?.success).toBe(true);
    expect(getMigrationLog().map((e) => e.type)).toEqual(['migration_started', 'backup_created', 'migration_completed']);
    expect((await getLatestBackup())?.version).toBe(db.verno);
  });

  it('auto-fixes a failed validation and records the fix', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(LAST_KNOWN_VERSION_KEY, '23');
    await db.businessProfiles.add(profile('bp1') as never);
    await db.clients.add(client('c1'));

    const result = await completeMigrationSafety();

    expect(result?.success).toBe(true);
    expect((await db.clients.get('c1'))?.profileId).toBe('bp1');
    expect(getMigrationLog().at(-1)).toMatchObject({ type: 'migration_completed', details: 'With auto-fix' });
  });

  it('lets the app run and says so when the issues cannot be fixed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(LAST_KNOWN_VERSION_KEY, '23');
    await db.clients.add(client('c1'));

    const result = await completeMigrationSafety();

    expect(result?.success).toBe(false);
    expect(error).toHaveBeenCalledWith('[Migration Safety] Migration issues persist after auto-fix');
    expect(getMigrationLog().at(-1)).toMatchObject({ type: 'migration_completed', details: 'Issues remain' });
  });
});

describe('backup files', () => {
  it('exports the whole database as JSON', async () => {
    await db.clients.add(client('c1', { profileId: 'bp1' }));

    const blob = await exportCompleteBackup();

    expect(blob.type).toBe('application/json');
    const parsed = JSON.parse(await readText(blob));
    expect(parsed.tables.clients).toEqual([expect.objectContaining({ id: 'c1' })]);
  });

  it('downloads the export as a dated file and releases the URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:backup');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadBackup();

    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^mtb3a-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(anchor.href).toBe('blob:backup');
    expect(anchor.isConnected).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup');
    vi.unstubAllGlobals();
  });

  it('imports a backup file', async () => {
    const backup = { version: 24, timestamp: now, tables: { clients: [client('c9', { profileId: 'bp1' })] }, checksum: 'x' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await importBackupFromFile(backupFile(JSON.stringify(backup)))).toBe(true);
    expect(await db.clients.get('c9')).toBeDefined();
  });

  it('refuses a file that is not a backup, or not JSON', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await importBackupFromFile(backupFile('{"tables":{}}'))).toBe(false);
    expect(await importBackupFromFile(backupFile('nope'))).toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
  });
});
