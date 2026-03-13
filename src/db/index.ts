export { db } from './database';
export * from './repository';
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
