export { db } from './database';
export * from './repository';

// The data-access seam. Consumers resolve repositories through this rather
// than importing a repository singleton directly. Exported from the barrel on
// purpose: `vi.mock('../../db')` stays the single interception point for tests.
export { getRepositories, setRepositories, resetRepositories } from './provider';
export type { Repositories } from './provider';
export { initDatabase, deleteAllData, clearDatabase, repairDatabase, getLastMigrationResult } from './seed';

// Migration safety exports
export {
  createBackup,
  getLatestBackup,
  getAllBackups,
  restoreFromBackup,
  validateMigration,
  autoFixMigrationIssues,
  getMigrationLog,
  downloadBackup,
  exportCompleteBackup,
  importBackupFromFile,
} from './migration-safety';

export type {
  MigrationBackup,
  MigrationValidationResult,
  MigrationIssue,
  MigrationEvent,
} from './migration-safety';

// Repository interfaces for future SQLite migration
export type * from './interfaces';
