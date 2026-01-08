/**
 * Sync Module Public API
 *
 * This module provides all sync-related functionality:
 * - Operations log and HLC clock
 * - Synced repositories (wrap existing repos with ops capture)
 * - Bundle export/import for offline sync
 * - Conflict resolution
 * - Sync state management
 */

// Core types
export type {
  HLC,
  Operation,
  EntityType,
  OpType,
  LocalDevice,
  TrustedPeer,
  DiscoveredPeer,
  PeerCursor,
  EntityFieldMeta,
  MoneyEventVersion,
  Conflict,
  ConflictType,
  ConflictStatus,
  ConflictResolution,
  SyncHistoryEntry,
  SyncMethod,
  SyncStatus,
  MsyncBundle,
  BundleManifest,
  SyncConnectionStatus,
  SyncState,
  SyncErrorCode,
} from './core/ops-types';

export { SyncError } from './core/ops-types';

// HLC Clock
export {
  HybridLogicalClock,
  initializeClock,
  getClock,
  tick,
  receive,
} from './core/hlc';

// Ops Engine
export {
  getOrCreateLocalDevice,
  getLocalDevice,
  captureOp,
  captureCreate,
  captureUpdate,
  captureDelete,
  captureArchive,
  captureMarkPaid,
  applyOp,
  applyOps,
  getOpsSince,
  getLocalOpsSince,
  getPendingOpsCount,
  getOpenConflicts,
  getOpenConflictsCount,
} from './core/ops-engine';

// Synced Repositories
export {
  syncedClientRepo,
  syncedProjectRepo,
  syncedTransactionRepo,
  syncedCategoryRepo,
  syncedFxRateRepo,
  settingsRepo,
  projectSummaryRepo,
  clientSummaryRepo,
} from './core/synced-repository';

// Bundle Operations
export {
  createBundle,
  createFullBackupBundle,
  previewBundle,
  importBundle,
  downloadBundle,
  readBundleFile,
  isMsyncFile,
} from './transport/bundle-encoder';

export type {
  ExportOptions,
  ExportResult,
  ImportPreview,
  ImportResult,
} from './transport/bundle-encoder';

// Encryption
export {
  encryptBundle,
  decryptBundle,
  validatePassphrase,
  generatePassphrase,
  storePassphraseHint,
  getPassphraseHint,
  clearPassphraseHint,
} from './transport/crypto';

// Conflict Resolution
export {
  resolveProfileConflict,
  resolveMoneyConflict,
  resolveAllProfileConflicts,
  resolveAllConflicts,
  getConflictSummary,
  getEntityConflicts,
  getTransactionVersions,
} from './core/conflict-resolver';

export type {
  ProfileResolution,
  MoneyResolution,
  ConflictSummary,
} from './core/conflict-resolver';

// Sync Store
export {
  useSyncStore,
  useSyncStatus,
  useSyncActions,
  useSyncProgress,
  useConflictBanner,
  selectSyncStatus,
  selectHasPendingConflicts,
  selectIsServerRunning,
  selectHasTrustedPeers,
  selectSyncSummary,
} from './stores/syncStore';

export type { SyncStore, SyncStoreState, SyncStoreActions } from './stores/syncStore';

// ============================================================================
// Initialization
// ============================================================================

import { getOrCreateLocalDevice } from './core/ops-engine';
import { initializeClock } from './core/hlc';
import { useSyncStore } from './stores/syncStore';

let initialized = false;

/**
 * Initialize the sync system.
 * Must be called once at app startup before any sync operations.
 */
export async function initializeSync(): Promise<void> {
  if (initialized) return;

  // Get or create device identity
  const device = await getOrCreateLocalDevice();

  // Initialize HLC with device ID
  initializeClock(device.id);

  // Initialize sync store
  await useSyncStore.getState().initialize();

  initialized = true;
  console.log('[Sync] Initialized with device:', device.name);
}

/**
 * Check if sync is initialized.
 */
export function isSyncInitialized(): boolean {
  return initialized;
}
