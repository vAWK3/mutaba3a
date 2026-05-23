/**
 * Database backup and restore utilities.
 * Serializes all IndexedDB tables to JSON for safe migration rollback.
 */

import { db } from './database';

export interface BackupData {
  version: number;
  timestamp: string;
  tables: Record<string, unknown[]>;
}

/**
 * Serialize all database tables to a JSON-serializable object.
 */
export async function serializeAllTables(): Promise<BackupData> {
  const tables: Record<string, unknown[]> = {};

  const tableNames = db.tables.map(t => t.name);

  for (const name of tableNames) {
    try {
      tables[name] = await db.table(name).toArray();
    } catch {
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
 * Export backup as a downloadable JSON file.
 * Triggers a browser download with the backup data.
 */
export async function exportBackup(): Promise<void> {
  const data = await serializeAllTables();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `mutaba3a-backup-v${data.version}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  });

  return { recordsRestored, backupVersion: data.version };
}
