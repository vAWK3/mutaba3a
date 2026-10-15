import { db } from './database';
import { DEFAULT_SETTINGS } from './defaultSettings';
import { completeMigrationSafety, validateMigration, autoFixMigrationIssues } from './migration-safety';
import type { MigrationValidationResult } from './migration-safety';

// Store last migration result for debugging
let lastMigrationResult: MigrationValidationResult | null = null;

/**
 * Get the last migration validation result (for debugging)
 */
export function getLastMigrationResult(): MigrationValidationResult | null {
  return lastMigrationResult;
}

/**
 * Initialize the database with default settings if not already present.
 * Does NOT seed any sample data - fresh installs start empty.
 *
 * Also runs migration safety checks:
 * - Creates backup if migration occurred
 * - Validates data integrity
 * - Auto-fixes common issues
 */
export async function initDatabase(): Promise<void> {
  // First, ensure default settings exist
  const existingSettings = await db.settings.get('default');
  if (!existingSettings) {
    await db.settings.put({ ...DEFAULT_SETTINGS });
    console.log('Database initialized with default settings');
  }

  // Run migration safety checks
  try {
    lastMigrationResult = await completeMigrationSafety();
    if (lastMigrationResult) {
      if (lastMigrationResult.success) {
        console.log('[Migration] Completed successfully');
      } else {
        console.warn('[Migration] Completed with issues:', lastMigrationResult.issues);
      }
    }
  } catch (e) {
    console.error('[Migration] Safety check failed:', e);
  }
}

/**
 * Re-validate and fix migration issues manually
 * Useful for debugging or recovery
 */
export async function repairDatabase(): Promise<MigrationValidationResult> {
  console.log('[Database] Running repair...');

  // Run auto-fix first
  const fixedCount = await autoFixMigrationIssues();
  console.log(`[Database] Auto-fixed ${fixedCount} records`);

  // Then validate
  const result = await validateMigration();
  lastMigrationResult = result;

  return result;
}

/**
 * "Delete all data" (MUT-164): empty every table except settings, in one
 * transaction. The settings row keeps the person's preferences (currencies,
 * last backup, Malafat suggestions); the optional areas go back to off, since
 * the data that switched them on is gone. Every table is enumerated, so a
 * table added later is cleared without touching this function.
 */
export async function deleteAllData(): Promise<void> {
  const dataTables = db.tables.filter((table) => table.name !== db.settings.name);
  await db.transaction('rw', [...dataTables, db.settings], async () => {
    await Promise.all(dataTables.map((table) => table.clear()));
    await db.settings.toCollection().modify((settings) => {
      settings.features = {};
      settings.featureNotice = [];
    });
  });
}

/**
 * Clear all tables including settings.
 * Used for import functionality to ensure clean slate.
 */
export async function clearDatabase(): Promise<void> {
  await db.transactions.clear();
  await db.projects.clear();
  await db.clients.clear();
  await db.categories.clear();
  await db.fxRates.clear();
  await db.settings.clear();
  console.log('Database cleared');
}
