/**
 * Sync State Store
 *
 * Zustand store for managing sync-related UI state.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { db } from '../../db/database';
import { applyOp } from '../core/ops-engine';
import { isTauri } from '../../lib/platform';
import type {
  SyncConnectionStatus,
  DiscoveredPeer,
  TrustedPeer,
  Operation,
} from '../core/ops-types';

// ============================================================================
// Store Types
// ============================================================================

export interface SyncStoreState {
  // Connection status
  status: SyncConnectionStatus;
  lastSyncAt: string | null;
  lastError: string | null;

  // Server state (Tauri only)
  serverRunning: boolean;
  serverPort: number | null;
  serverExpiresAt: string | null;

  // Pending counts
  pendingOpsCount: number;
  pendingConflictsCount: number;

  // Discovery
  discoveredPeers: DiscoveredPeer[];
  isDiscovering: boolean;

  // Trusted peers (cached)
  trustedPeers: TrustedPeer[];

  // Sync progress (when syncing)
  syncProgress: {
    stage: 'connecting' | 'pulling' | 'pushing' | 'applying' | 'done' | null;
    pulledCount: number;
    pushedCount: number;
    totalToPull: number;
    totalToPush: number;
  } | null;

  // Modal states
  isExportModalOpen: boolean;
  isImportModalOpen: boolean;
  isPairingModalOpen: boolean;
  isConflictBannerDismissed: boolean;
}

export interface SyncStoreActions {
  // Status updates
  setStatus: (status: SyncConnectionStatus) => void;
  setLastSync: (timestamp: string) => void;
  setLastError: (error: string | null) => void;

  // Server control
  setServerRunning: (running: boolean, port?: number, expiresAt?: string) => void;

  // Counts
  setPendingOpsCount: (count: number) => void;
  setPendingConflictsCount: (count: number) => void;
  refreshCounts: () => Promise<void>;

  // Discovery
  setDiscoveredPeers: (peers: DiscoveredPeer[]) => void;
  setIsDiscovering: (discovering: boolean) => void;
  startDiscovery: () => Promise<void>;

  // Peers
  setTrustedPeers: (peers: TrustedPeer[]) => void;
  refreshTrustedPeers: () => Promise<void>;

  // Progress
  setSyncProgress: (progress: SyncStoreState['syncProgress']) => void;
  updateSyncProgress: (update: Partial<NonNullable<SyncStoreState['syncProgress']>>) => void;

  // Modals
  openExportModal: () => void;
  closeExportModal: () => void;
  openImportModal: () => void;
  closeImportModal: () => void;
  openPairingModal: () => void;
  closePairingModal: () => void;
  dismissConflictBanner: () => void;
  resetConflictBanner: () => void;

  // Initialize
  initialize: () => Promise<void>;
}

export type SyncStore = SyncStoreState & SyncStoreActions;

// ============================================================================
// Store Implementation
// ============================================================================

export const useSyncStore = create<SyncStore>((set, get) => ({
  // Initial state
  status: 'idle',
  lastSyncAt: null,
  lastError: null,
  serverRunning: false,
  serverPort: null,
  serverExpiresAt: null,
  pendingOpsCount: 0,
  pendingConflictsCount: 0,
  discoveredPeers: [],
  isDiscovering: false,
  trustedPeers: [],
  syncProgress: null,
  isExportModalOpen: false,
  isImportModalOpen: false,
  isPairingModalOpen: false,
  isConflictBannerDismissed: false,

  // Status updates
  setStatus: (status) => set({ status }),
  setLastSync: (timestamp) => set({ lastSyncAt: timestamp }),
  setLastError: (error) => set({ lastError: error }),

  // Server control
  setServerRunning: (running, port, expiresAt) =>
    set({
      serverRunning: running,
      serverPort: port ?? null,
      serverExpiresAt: expiresAt ?? null,
    }),

  // Counts
  setPendingOpsCount: (count) => set({ pendingOpsCount: count }),
  setPendingConflictsCount: (count) => set({ pendingConflictsCount: count }),

  refreshCounts: async () => {
    try {
      // Get pending ops count (ops not yet synced to any peer)
      const device = await db.localDevice.toCollection().first();
      if (!device) {
        set({ pendingOpsCount: 0 });
      } else {
        // For now, count all local ops
        // TODO: Filter by peer cursor when syncing is fully implemented
        const opsCount = await db.opLog
          .filter((op) => op.createdBy === device.id)
          .count();
        set({ pendingOpsCount: opsCount });
      }

      // Get pending conflicts count
      const conflictsCount = await db.conflictQueue
        .where('status')
        .equals('open')
        .count();
      set({ pendingConflictsCount: conflictsCount });
    } catch (error) {
      console.error('Failed to refresh sync counts:', error);
    }
  },

  // Discovery
  setDiscoveredPeers: (peers) => set({ discoveredPeers: peers }),
  setIsDiscovering: (discovering) => set({ isDiscovering: discovering }),

  startDiscovery: async () => {
    const { isDiscovering } = get();
    if (isDiscovering) return;

    set({ isDiscovering: true, discoveredPeers: [] });

    try {
      // Check if Tauri is available
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const peers = await invoke<DiscoveredPeer[]>('discover_lan_peers');
        set({ discoveredPeers: peers });
      }
    } catch (error) {
      console.error('Failed to discover peers:', error);
    } finally {
      set({ isDiscovering: false });
    }
  },

  // Peers
  setTrustedPeers: (peers) => set({ trustedPeers: peers }),

  refreshTrustedPeers: async () => {
    try {
      const peers = await db.trustedPeers
        .where('status')
        .equals('verified')
        .toArray();
      set({ trustedPeers: peers });
    } catch (error) {
      console.error('Failed to refresh trusted peers:', error);
    }
  },

  // Progress
  setSyncProgress: (progress) => set({ syncProgress: progress }),

  updateSyncProgress: (update) => {
    const current = get().syncProgress;
    if (current) {
      set({ syncProgress: { ...current, ...update } });
    }
  },

  // Modals
  openExportModal: () => set({ isExportModalOpen: true }),
  closeExportModal: () => set({ isExportModalOpen: false }),
  openImportModal: () => set({ isImportModalOpen: true }),
  closeImportModal: () => set({ isImportModalOpen: false }),
  openPairingModal: () => set({ isPairingModalOpen: true }),
  closePairingModal: () => set({ isPairingModalOpen: false }),
  dismissConflictBanner: () => set({ isConflictBannerDismissed: true }),
  resetConflictBanner: () => set({ isConflictBannerDismissed: false }),

  // Initialize
  initialize: async () => {
    await get().refreshCounts();
    await get().refreshTrustedPeers();

    // Get last sync time from history
    const lastSync = await db.syncHistory
      .orderBy('completedAt')
      .reverse()
      .first();

    if (lastSync) {
      set({ lastSyncAt: lastSync.completedAt });
    }

    // Set up Tauri event listener for incoming sync operations
    if (isTauri()) {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');

      await listen<number>('sync:ops_received', async (event) => {
        console.log('[SyncStore] Received sync:ops_received event, count:', event.payload);

        try {
          // Fetch pending operations from Rust backend
          const ops = await invoke<Operation[]>('get_pending_sync_ops');
          console.log('[SyncStore] Fetched pending ops:', ops.length);

          // Apply each operation to the database
          for (const op of ops) {
            console.log('[SyncStore] Applying op:', op.id, op.opType, op.entityType);
            await applyOp(op);
          }

          // Clear the pending queue
          const cleared = await invoke<number>('clear_pending_sync_ops');
          console.log('[SyncStore] Cleared pending ops:', cleared);

          // Refresh counts to update UI
          await get().refreshCounts();

          // Update last sync time
          set({ lastSyncAt: new Date().toISOString() });
        } catch (error) {
          console.error('[SyncStore] Failed to process sync operations:', error);
          set({ lastError: String(error) });
        }
      });

      console.log('[SyncStore] Tauri event listener registered for sync:ops_received');
    }
  },
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectSyncStatus = (state: SyncStore) => state.status;
export const selectHasPendingConflicts = (state: SyncStore) => state.pendingConflictsCount > 0;
export const selectIsServerRunning = (state: SyncStore) => state.serverRunning;
export const selectHasTrustedPeers = (state: SyncStore) => state.trustedPeers.length > 0;

export const selectSyncSummary = (state: SyncStore) => ({
  status: state.status,
  pendingOps: state.pendingOpsCount,
  pendingConflicts: state.pendingConflictsCount,
  lastSync: state.lastSyncAt,
  trustedPeersCount: state.trustedPeers.length,
});

// ============================================================================
// Hooks for common patterns
// ============================================================================

export function useSyncStatus() {
  return useSyncStore(
    useShallow((state) => ({
      status: state.status,
      pendingConflicts: state.pendingConflictsCount,
      lastSyncAt: state.lastSyncAt,
      serverRunning: state.serverRunning,
    }))
  );
}

export function useSyncActions() {
  return useSyncStore(
    useShallow((state) => ({
      openExportModal: state.openExportModal,
      openImportModal: state.openImportModal,
      openPairingModal: state.openPairingModal,
      startDiscovery: state.startDiscovery,
      refreshCounts: state.refreshCounts,
    }))
  );
}

export function useSyncProgress() {
  return useSyncStore((state) => state.syncProgress);
}

export function useConflictBanner() {
  return useSyncStore(
    useShallow((state) => ({
      count: state.pendingConflictsCount,
      isDismissed: state.isConflictBannerDismissed,
      dismiss: state.dismissConflictBanner,
      reset: state.resetConflictBanner,
    }))
  );
}
