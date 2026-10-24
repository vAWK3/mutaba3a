/**
 * Database backup and restore utilities.
 * Serializes all IndexedDB tables to JSON for safe migration rollback.
 */

import { db } from './database';
import { enforceSingleDefaultProfile } from './profileDefault';
import { settingsRepo } from './repository';
import { reconcileFeaturesAfterDataLoad } from '../lib/features/features';

export interface BackupData {
  version: number;
  timestamp: string;
  tables: Record<string, unknown[]>;
}

/**
 * Serialize all database tables to a JSON-serializable object. A table that
 * can't be read comes out empty, unless `strict`: the carry-over (MUT-291)
 * must never send an empty table for one it couldn't read, and mark it carried.
 */
export async function serializeAllTables(options: { strict?: boolean } = {}): Promise<BackupData> {
  const tables: Record<string, unknown[]> = {};

  const tableNames = db.tables.map(t => t.name);

  for (const name of tableNames) {
    try {
      tables[name] = await db.table(name).toArray();
    } catch (error) {
      if (options.strict) throw error;
      tables[name] = [];
    }
  }

  return {
    version: db.verno,
    timestamp: new Date().toISOString(),
    tables,
  };
}

/**
 * Restore database from a backup JSON file.
 * Clears all existing data and replaces with backup data.
 */
export async function restoreFromBackup(backupJson: string): Promise<{ recordsRestored: number; backupVersion: number }> {
  const data: BackupData = JSON.parse(backupJson);

  if (!data.version || !data.tables) {
    throw new Error('Invalid backup file: missing version or tables');
  }

  if (data.version > db.verno) {
    throw new Error(
      `Backup is from a newer version (v${data.version}) than the current app (v${db.verno}). Please update the app first.`
    );
  }

  let recordsRestored = 0;

  await db.transaction('rw', db.tables, async () => {
    // Clear all tables
    for (const table of db.tables) {
      await table.clear();
    }

    // Restore data
    for (const [tableName, records] of Object.entries(data.tables)) {
      if (records.length > 0) {
        try {
          await db.table(tableName).bulkAdd(records);
          recordsRestored += records.length;
        } catch {
          // Table might not exist in current schema version - skip
        }
      }
    }

    // An older backup can carry two defaults (MUT-88, ADR-072).
    await enforceSingleDefaultProfile(db.businessProfiles);
    // The device now holds exactly this backup, so it is the last one made.
    if (data.timestamp) await settingsRepo.update({ lastBackupAt: data.timestamp });
  });

  // A backup from an older build carries a settings row without `features`;
  // switch on the optional areas the restored rows belong to (MUT-12 / MUT-14).
  // Logged, never thrown: the restore itself has already succeeded.
  await reconcileFeaturesAfterDataLoad('restore', db);

  return { recordsRestored, backupVersion: data.version };
}
