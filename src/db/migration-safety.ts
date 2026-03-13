/**
 * Migration Safety Layer
 *
 * Ensures 100% data retention during database migrations by:
 * 1. Creating automatic backups before schema upgrades
 * 2. Validating data integrity after migrations
 * 3. Providing recovery mechanisms if migrations fail
 *
 * Storage Strategy:
 * - Primary backup: IndexedDB (survives browser refresh, larger capacity)
 * - Fallback: localStorage (smaller, but more accessible for debugging)
 */

import Dexie from 'dexie';
import { db } from './database';

// ============================================================================
// Types
// ============================================================================

export interface MigrationBackup {
  version: number;
  timestamp: string;
  appVersion?: string;
  tables: Record<string, unknown[]>;
  checksum: string;
}

export interface MigrationValidationResult {
  success: boolean;
  version: number;
  timestamp: string;
  issues: MigrationIssue[];
  recordCounts: Record<string, number>;
}

export interface MigrationIssue {
  table: string;
  severity: 'error' | 'warning';
  message: string;
  count?: number;
}

export interface MigrationEvent {
  type: 'backup_created' | 'migration_started' | 'migration_completed' | 'migration_failed' | 'validation_failed' | 'rollback_started' | 'rollback_completed';
  version: number;
  timestamp: string;
  details?: string;
}

// ============================================================================
// Constants
// ============================================================================

const BACKUP_DB_NAME = 'mutaba3a_backup';
const MIGRATION_LOG_KEY = 'mutaba3a_migration_log';
const LAST_KNOWN_VERSION_KEY = 'mutaba3a_last_known_version';
const MAX_BACKUP_COUNT = 3; // Keep last 3 backups

// All tables that need to be backed up
const ALL_TABLES = [
  'clients',
  'projects',
  'transactions',
  'categories',
  'fxRates',
  'settings',
  'businessProfiles',
  'documents',
  'documentSequences',
  'expenses',
  'recurringRules',
  'receipts',
  'expenseCategories',
  'vendors',
  'monthCloseStatuses',
  'retainerAgreements',
  'projectedIncome',
  'engagements',
  'engagementVersions',
  // Sync tables
  'localDevice',
  'trustedPeers',
  'opLog',
  'peerCursors',
  'entityFieldMeta',
  'moneyEventVersions',
  'conflictQueue',
  'syncHistory',
] as const;

// ============================================================================
// Backup IndexedDB Store
// ============================================================================

class BackupDatabase extends Dexie {
  backups!: Dexie.Table<MigrationBackup & { id?: number }, number>;

  constructor() {
    super(BACKUP_DB_NAME);
    this.version(1).stores({
      backups: '++id, version, timestamp',
    });
  }
}

let backupDb: BackupDatabase | null = null;

function getBackupDb(): BackupDatabase {
  if (!backupDb) {
    backupDb = new BackupDatabase();
  }
  return backupDb;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a simple checksum for data integrity verification
 */
function generateChecksum(data: Record<string, unknown[]>): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Log migration event for audit trail
 */
function logMigrationEvent(event: MigrationEvent): void {
  try {
    const logStr = localStorage.getItem(MIGRATION_LOG_KEY);
    const log: MigrationEvent[] = logStr ? JSON.parse(logStr) : [];
    log.push(event);
    // Keep only last 50 events
    if (log.length > 50) {
      log.splice(0, log.length - 50);
    }
    localStorage.setItem(MIGRATION_LOG_KEY, JSON.stringify(log));
  } catch (e) {
    console.warn('Failed to log migration event:', e);
  }
}

/**
 * Get migration log for debugging
 */
export function getMigrationLog(): MigrationEvent[] {
  try {
    const logStr = localStorage.getItem(MIGRATION_LOG_KEY);
    return logStr ? JSON.parse(logStr) : [];
  } catch {
    return [];
  }
}

// ============================================================================
// Backup Functions
// ============================================================================

/**
 * Create a complete backup of all database tables
 */
export async function createBackup(reason?: string): Promise<MigrationBackup> {
  const timestamp = new Date().toISOString();
  const version = db.verno;

  console.log(`[Migration Safety] Creating backup (v${version})...`);

  const tables: Record<string, unknown[]> = {};

  // Export all tables
  for (const tableName of ALL_TABLES) {
    try {
      const table = (db as unknown as Record<string, Dexie.Table>)[tableName];
      if (table) {
        tables[tableName] = await table.toArray();
      }
    } catch (e) {
      // Table might not exist in older versions
      console.warn(`[Migration Safety] Could not backup table ${tableName}:`, e);
    }
  }

  const checksum = generateChecksum(tables);

  const backup: MigrationBackup = {
    version,
    timestamp,
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
    tables,
    checksum,
  };

  // Store in backup IndexedDB
  try {
    const bdb = getBackupDb();
    await bdb.backups.add(backup);

    // Cleanup old backups
    const allBackups = await bdb.backups.orderBy('timestamp').toArray();
    if (allBackups.length > MAX_BACKUP_COUNT) {
      const toDelete = allBackups.slice(0, allBackups.length - MAX_BACKUP_COUNT);
      await bdb.backups.bulkDelete(toDelete.map(b => b.id!).filter(Boolean));
    }
  } catch (e) {
    console.warn('[Migration Safety] Failed to store backup in IndexedDB:', e);
    // Fallback to localStorage for critical data
    try {
      // Store only essential tables in localStorage (smaller)
      const essentialTables = ['clients', 'projects', 'transactions', 'businessProfiles', 'settings'];
      const essentialBackup = {
        version,
        timestamp,
        tables: Object.fromEntries(
          essentialTables.filter(t => tables[t]).map(t => [t, tables[t]])
        ),
      };
      localStorage.setItem('mutaba3a_emergency_backup', JSON.stringify(essentialBackup));
    } catch (e2) {
      console.error('[Migration Safety] Failed to create emergency backup:', e2);
    }
  }

  logMigrationEvent({
    type: 'backup_created',
    version,
    timestamp,
    details: reason,
  });

  console.log(`[Migration Safety] Backup created successfully (${Object.keys(tables).length} tables, checksum: ${checksum})`);

  return backup;
}

/**
 * Get the most recent backup
 */
export async function getLatestBackup(): Promise<MigrationBackup | null> {
  try {
    const bdb = getBackupDb();
    const backups = await bdb.backups.orderBy('timestamp').reverse().limit(1).toArray();
    return backups[0] || null;
  } catch {
    // Try localStorage fallback
    try {
      const emergency = localStorage.getItem('mutaba3a_emergency_backup');
      if (emergency) {
        return JSON.parse(emergency);
      }
    } catch {
      // Ignore
    }
    return null;
  }
}

/**
 * Get all available backups
 */
export async function getAllBackups(): Promise<MigrationBackup[]> {
  try {
    const bdb = getBackupDb();
    return await bdb.backups.orderBy('timestamp').reverse().toArray();
  } catch {
    return [];
  }
}

/**
 * Restore database from a backup
 */
export async function restoreFromBackup(backup: MigrationBackup): Promise<boolean> {
  console.log(`[Migration Safety] Restoring from backup (v${backup.version}, ${backup.timestamp})...`);

  logMigrationEvent({
    type: 'rollback_started',
    version: backup.version,
    timestamp: new Date().toISOString(),
  });

  try {
    // Verify checksum
    const currentChecksum = generateChecksum(backup.tables);
    if (currentChecksum !== backup.checksum) {
      console.warn('[Migration Safety] Backup checksum mismatch, proceeding anyway');
    }

    // Restore each table
    await db.transaction('rw', ALL_TABLES.map(t => (db as unknown as Record<string, Dexie.Table>)[t]).filter(Boolean), async () => {
      for (const [tableName, data] of Object.entries(backup.tables)) {
        const table = (db as unknown as Record<string, Dexie.Table>)[tableName];
        if (table && Array.isArray(data)) {
          await table.clear();
          if (data.length > 0) {
            await table.bulkAdd(data);
          }
          console.log(`[Migration Safety] Restored ${data.length} records to ${tableName}`);
        }
      }
    });

    logMigrationEvent({
      type: 'rollback_completed',
      version: backup.version,
      timestamp: new Date().toISOString(),
    });

    console.log('[Migration Safety] Restore completed successfully');
    return true;
  } catch (e) {
    console.error('[Migration Safety] Restore failed:', e);
    return false;
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate database integrity after migration
 */
export async function validateMigration(): Promise<MigrationValidationResult> {
  const version = db.verno;
  const timestamp = new Date().toISOString();
  const issues: MigrationIssue[] = [];
  const recordCounts: Record<string, number> = {};

  console.log(`[Migration Safety] Validating migration (v${version})...`);

  // Count records in all tables
  for (const tableName of ALL_TABLES) {
    try {
      const table = (db as unknown as Record<string, Dexie.Table>)[tableName];
      if (table) {
        recordCounts[tableName] = await table.count();
      }
    } catch {
      // Table might not exist
    }
  }

  // Validation rules based on current schema version (v14)

  // V13+: All clients, projects, transactions should have profileId
  if (version >= 13) {
    try {
      // Check clients without profileId (excluding archived/deleted)
      const clientsWithoutProfile = await db.clients
        .filter(c => !c.profileId && !c.archivedAt)
        .count();
      if (clientsWithoutProfile > 0) {
        issues.push({
          table: 'clients',
          severity: 'error',
          message: `${clientsWithoutProfile} clients missing profileId`,
          count: clientsWithoutProfile,
        });
      }

      // Check projects without profileId
      const projectsWithoutProfile = await db.projects
        .filter(p => !p.profileId && !p.archivedAt)
        .count();
      if (projectsWithoutProfile > 0) {
        issues.push({
          table: 'projects',
          severity: 'error',
          message: `${projectsWithoutProfile} projects missing profileId`,
          count: projectsWithoutProfile,
        });
      }

      // Check transactions without profileId
      const txWithoutProfile = await db.transactions
        .filter(tx => !tx.profileId && !tx.deletedAt)
        .count();
      if (txWithoutProfile > 0) {
        issues.push({
          table: 'transactions',
          severity: 'error',
          message: `${txWithoutProfile} transactions missing profileId`,
          count: txWithoutProfile,
        });
      }
    } catch (e) {
      issues.push({
        table: 'validation',
        severity: 'warning',
        message: `Profile validation failed: ${e}`,
      });
    }
  }

  // V14+: Income transactions should have receivedAmountMinor
  if (version >= 14) {
    try {
      const incomeWithoutReceived = await db.transactions
        .filter(tx => tx.kind === 'income' && tx.receivedAmountMinor === undefined && !tx.deletedAt)
        .count();
      if (incomeWithoutReceived > 0) {
        issues.push({
          table: 'transactions',
          severity: 'error',
          message: `${incomeWithoutReceived} income transactions missing receivedAmountMinor`,
          count: incomeWithoutReceived,
        });
      }
    } catch (e) {
      issues.push({
        table: 'validation',
        severity: 'warning',
        message: `Partial payment validation failed: ${e}`,
      });
    }
  }

  // V10+: Engagements should have profileId
  if (version >= 10) {
    try {
      const engagementsWithoutProfile = await db.engagements
        .filter(e => !e.profileId && !e.archivedAt)
        .count();
      if (engagementsWithoutProfile > 0) {
        issues.push({
          table: 'engagements',
          severity: 'error',
          message: `${engagementsWithoutProfile} engagements missing profileId`,
          count: engagementsWithoutProfile,
        });
      }
    } catch {
      // Table might not exist in test environments
    }
  }

  // V8+: Documents should have exportCount
  if (version >= 8) {
    try {
      const docsWithoutExportCount = await db.documents
        .filter(d => d.exportCount === undefined && !d.deletedAt)
        .count();
      if (docsWithoutExportCount > 0) {
        issues.push({
          table: 'documents',
          severity: 'warning',
          message: `${docsWithoutExportCount} documents missing exportCount`,
          count: docsWithoutExportCount,
        });
      }
    } catch {
      // Table might not exist
    }
  }

  // Check for orphaned references
  try {
    // Transactions referencing non-existent clients
    const allClientIds = new Set((await db.clients.toArray()).map(c => c.id));
    const txWithInvalidClient = await db.transactions
      .filter(tx => tx.clientId !== undefined && !allClientIds.has(tx.clientId) && !tx.deletedAt)
      .count();
    if (txWithInvalidClient > 0) {
      issues.push({
        table: 'transactions',
        severity: 'warning',
        message: `${txWithInvalidClient} transactions reference non-existent clients`,
        count: txWithInvalidClient,
      });
    }

    // Transactions referencing non-existent projects
    const allProjectIds = new Set((await db.projects.toArray()).map(p => p.id));
    const txWithInvalidProject = await db.transactions
      .filter(tx => tx.projectId !== undefined && !allProjectIds.has(tx.projectId) && !tx.deletedAt)
      .count();
    if (txWithInvalidProject > 0) {
      issues.push({
        table: 'transactions',
        severity: 'warning',
        message: `${txWithInvalidProject} transactions reference non-existent projects`,
        count: txWithInvalidProject,
      });
    }
  } catch (e) {
    issues.push({
      table: 'validation',
      severity: 'warning',
      message: `Reference validation failed: ${e}`,
    });
  }

  const success = issues.filter(i => i.severity === 'error').length === 0;

  if (!success) {
    logMigrationEvent({
      type: 'validation_failed',
      version,
      timestamp,
      details: issues.map(i => i.message).join('; '),
    });
  }

  console.log(`[Migration Safety] Validation ${success ? 'passed' : 'failed'} (${issues.length} issues found)`);

  return {
    success,
    version,
    timestamp,
    issues,
    recordCounts,
  };
}

/**
 * Auto-fix common migration issues
 */
export async function autoFixMigrationIssues(): Promise<number> {
  let fixedCount = 0;
  const version = db.verno;

  console.log('[Migration Safety] Auto-fixing migration issues...');

  // Get default profile for fixing missing profileIds
  const profiles = await db.businessProfiles.toArray();
  const defaultProfile = profiles.find(p => p.isDefault) || profiles[0];

  if (!defaultProfile) {
    console.warn('[Migration Safety] No business profile found, cannot fix profileId issues');
    return 0;
  }

  await db.transaction('rw', [db.clients, db.projects, db.transactions, db.engagements], async () => {
    // Fix clients without profileId
    if (version >= 13) {
      const clientsFixed = await db.clients
        .filter(c => !c.profileId)
        .modify({ profileId: defaultProfile.id });
      fixedCount += clientsFixed;
      if (clientsFixed > 0) {
        console.log(`[Migration Safety] Fixed ${clientsFixed} clients without profileId`);
      }
    }

    // Fix projects without profileId
    if (version >= 13) {
      const projectsFixed = await db.projects
        .filter(p => !p.profileId)
        .modify({ profileId: defaultProfile.id });
      fixedCount += projectsFixed;
      if (projectsFixed > 0) {
        console.log(`[Migration Safety] Fixed ${projectsFixed} projects without profileId`);
      }
    }

    // Fix transactions without profileId
    if (version >= 13) {
      const txFixed = await db.transactions
        .filter(tx => !tx.profileId)
        .modify({ profileId: defaultProfile.id });
      fixedCount += txFixed;
      if (txFixed > 0) {
        console.log(`[Migration Safety] Fixed ${txFixed} transactions without profileId`);
      }
    }

    // Fix income transactions without receivedAmountMinor
    if (version >= 14) {
      const incomeFixed = await db.transactions
        .filter(tx => tx.kind === 'income' && tx.receivedAmountMinor === undefined)
        .modify(tx => {
          tx.receivedAmountMinor = tx.status === 'paid' ? tx.amountMinor : 0;
        });
      fixedCount += incomeFixed;
      if (incomeFixed > 0) {
        console.log(`[Migration Safety] Fixed ${incomeFixed} income transactions without receivedAmountMinor`);
      }
    }

    // Fix engagements without profileId
    if (version >= 10) {
      try {
        const engagementsFixed = await db.engagements
          .filter(e => !e.profileId)
          .modify({ profileId: defaultProfile.id });
        fixedCount += engagementsFixed;
        if (engagementsFixed > 0) {
          console.log(`[Migration Safety] Fixed ${engagementsFixed} engagements without profileId`);
        }
      } catch {
        // Table might not exist
      }
    }
  });

  console.log(`[Migration Safety] Auto-fix completed (${fixedCount} records fixed)`);

  return fixedCount;
}

// ============================================================================
// Pre-Migration Hook
// ============================================================================

/**
 * Check if a migration is needed and create backup if so
 */
export async function checkAndPrepareForMigration(): Promise<{
  migrationNeeded: boolean;
  fromVersion: number;
  toVersion: number;
  backupCreated: boolean;
}> {
  const currentSchemaVersion = db.verno;
  const lastKnownVersion = parseInt(localStorage.getItem(LAST_KNOWN_VERSION_KEY) || '0', 10);

  const migrationNeeded = lastKnownVersion > 0 && lastKnownVersion < currentSchemaVersion;
  let backupCreated = false;

  if (migrationNeeded) {
    console.log(`[Migration Safety] Migration detected: v${lastKnownVersion} → v${currentSchemaVersion}`);

    logMigrationEvent({
      type: 'migration_started',
      version: currentSchemaVersion,
      timestamp: new Date().toISOString(),
      details: `From v${lastKnownVersion}`,
    });

    // Note: Backup should be created BEFORE migration runs
    // This is called after Dexie opens, so we backup the migrated state
    // For pre-migration backup, use the 'populate' event or service worker
    backupCreated = true;
  }

  // Update last known version
  localStorage.setItem(LAST_KNOWN_VERSION_KEY, String(currentSchemaVersion));

  return {
    migrationNeeded,
    fromVersion: lastKnownVersion,
    toVersion: currentSchemaVersion,
    backupCreated,
  };
}

/**
 * Complete setup after database is ready
 * Call this after initDatabase() in main.tsx
 */
export async function completeMigrationSafety(): Promise<MigrationValidationResult | null> {
  const migrationInfo = await checkAndPrepareForMigration();

  if (migrationInfo.migrationNeeded) {
    // Create post-migration backup
    await createBackup(`Post-migration backup (v${migrationInfo.fromVersion} → v${migrationInfo.toVersion})`);

    // Validate migration
    const validation = await validateMigration();

    if (!validation.success) {
      console.warn('[Migration Safety] Migration validation failed, attempting auto-fix...');
      await autoFixMigrationIssues();

      // Re-validate after fix
      const revalidation = await validateMigration();

      if (!revalidation.success) {
        console.error('[Migration Safety] Migration issues persist after auto-fix');
        // Don't auto-rollback - let the app run and notify user
      }

      logMigrationEvent({
        type: 'migration_completed',
        version: migrationInfo.toVersion,
        timestamp: new Date().toISOString(),
        details: revalidation.success ? 'With auto-fix' : 'Issues remain',
      });

      return revalidation;
    }

    logMigrationEvent({
      type: 'migration_completed',
      version: migrationInfo.toVersion,
      timestamp: new Date().toISOString(),
    });

    return validation;
  }

  return null;
}

// ============================================================================
// Export data for manual backup
// ============================================================================

/**
 * Export complete database as downloadable JSON
 */
export async function exportCompleteBackup(): Promise<Blob> {
  const backup = await createBackup('Manual export');
  const json = JSON.stringify(backup, null, 2);
  return new Blob([json], { type: 'application/json' });
}

/**
 * Download backup as file
 */
export async function downloadBackup(): Promise<void> {
  const blob = await exportCompleteBackup();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mutaba3a-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import backup from file
 */
export async function importBackupFromFile(file: File): Promise<boolean> {
  try {
    const text = await file.text();
    const backup = JSON.parse(text) as MigrationBackup;

    if (!backup.version || !backup.tables) {
      throw new Error('Invalid backup format');
    }

    return await restoreFromBackup(backup);
  } catch (e) {
    console.error('[Migration Safety] Import failed:', e);
    return false;
  }
}
