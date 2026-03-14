import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
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
} from '../syncStore';

// Mock dependencies
vi.mock('../../../db/database', () => ({
  db: {
    localDevice: {
      toCollection: vi.fn(() => ({
        first: vi.fn().mockResolvedValue({ id: 'device-1' }),
      })),
    },
    opLog: {
      filter: vi.fn(() => ({
        count: vi.fn().mockResolvedValue(5),
      })),
    },
    conflictQueue: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(2),
        })),
      })),
    },
    trustedPeers: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([
            { id: 'peer-1', name: 'Peer 1', status: 'verified' },
          ]),
        })),
      })),
    },
    syncHistory: {
      orderBy: vi.fn(() => ({
        reverse: vi.fn(() => ({
          first: vi.fn().mockResolvedValue({ completedAt: '2026-03-13T12:00:00Z' }),
        })),
      })),
    },
  },
}));

vi.mock('../../core/ops-engine', () => ({
  applyOp: vi.fn().mockResolvedValue({ applied: true }),
}));

vi.mock('../../../lib/platform', () => ({
  isTauri: vi.fn().mockReturnValue(false),
}));

describe('useSyncStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useSyncStore.setState({
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
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial values', () => {
      const state = useSyncStore.getState();

      expect(state.status).toBe('idle');
      expect(state.lastSyncAt).toBeNull();
      expect(state.lastError).toBeNull();
      expect(state.serverRunning).toBe(false);
      expect(state.pendingOpsCount).toBe(0);
      expect(state.pendingConflictsCount).toBe(0);
      expect(state.discoveredPeers).toEqual([]);
      expect(state.trustedPeers).toEqual([]);
      expect(state.syncProgress).toBeNull();
    });
  });

  describe('status updates', () => {
    it('setStatus should update connection status', () => {
      const { setStatus } = useSyncStore.getState();

      act(() => {
        setStatus('syncing');
      });

      expect(useSyncStore.getState().status).toBe('syncing');
    });

    it('setLastSync should update last sync timestamp', () => {
      const { setLastSync } = useSyncStore.getState();
      const timestamp = '2026-03-13T15:00:00Z';

      act(() => {
        setLastSync(timestamp);
      });

      expect(useSyncStore.getState().lastSyncAt).toBe(timestamp);
    });

    it('setLastError should update error state', () => {
      const { setLastError } = useSyncStore.getState();

      act(() => {
        setLastError('Connection failed');
      });

      expect(useSyncStore.getState().lastError).toBe('Connection failed');

      act(() => {
        setLastError(null);
      });

      expect(useSyncStore.getState().lastError).toBeNull();
    });
  });

  describe('server control', () => {
    it('setServerRunning should update server state', () => {
      const { setServerRunning } = useSyncStore.getState();

      act(() => {
        setServerRunning(true, 8080, '2026-03-13T16:00:00Z');
      });

      const state = useSyncStore.getState();
      expect(state.serverRunning).toBe(true);
      expect(state.serverPort).toBe(8080);
      expect(state.serverExpiresAt).toBe('2026-03-13T16:00:00Z');
    });

    it('setServerRunning with only running flag should clear port and expiry', () => {
      const { setServerRunning } = useSyncStore.getState();

      act(() => {
        setServerRunning(true, 8080, '2026-03-13T16:00:00Z');
      });

      act(() => {
        setServerRunning(false);
      });

      const state = useSyncStore.getState();
      expect(state.serverRunning).toBe(false);
      expect(state.serverPort).toBeNull();
      expect(state.serverExpiresAt).toBeNull();
    });
  });

  describe('pending counts', () => {
    it('setPendingOpsCount should update ops count', () => {
      const { setPendingOpsCount } = useSyncStore.getState();

      act(() => {
        setPendingOpsCount(10);
      });

      expect(useSyncStore.getState().pendingOpsCount).toBe(10);
    });

    it('setPendingConflictsCount should update conflicts count', () => {
      const { setPendingConflictsCount } = useSyncStore.getState();

      act(() => {
        setPendingConflictsCount(3);
      });

      expect(useSyncStore.getState().pendingConflictsCount).toBe(3);
    });

    it('refreshCounts should fetch counts from database', async () => {
      const { refreshCounts } = useSyncStore.getState();

      await act(async () => {
        await refreshCounts();
      });

      const state = useSyncStore.getState();
      expect(state.pendingOpsCount).toBe(5);
      expect(state.pendingConflictsCount).toBe(2);
    });
  });

  describe('discovery', () => {
    it('setDiscoveredPeers should update peers list', () => {
      const { setDiscoveredPeers } = useSyncStore.getState();
      const peers = [{ id: 'peer-1', name: 'Device 1', address: '192.168.1.100', port: 8080 }];

      act(() => {
        setDiscoveredPeers(peers);
      });

      expect(useSyncStore.getState().discoveredPeers).toEqual(peers);
    });

    it('setIsDiscovering should update discovery state', () => {
      const { setIsDiscovering } = useSyncStore.getState();

      act(() => {
        setIsDiscovering(true);
      });

      expect(useSyncStore.getState().isDiscovering).toBe(true);
    });
  });

  describe('trusted peers', () => {
    it('setTrustedPeers should update peers list', () => {
      const { setTrustedPeers } = useSyncStore.getState();
      const peers = [{ id: 'peer-1', name: 'Trusted Peer', publicKey: 'key-1', status: 'verified' as const, pairedAt: '2026-03-13', lastSeenAt: '2026-03-13' }];

      act(() => {
        setTrustedPeers(peers);
      });

      expect(useSyncStore.getState().trustedPeers).toEqual(peers);
    });

    it('refreshTrustedPeers should fetch from database', async () => {
      const { refreshTrustedPeers } = useSyncStore.getState();

      await act(async () => {
        await refreshTrustedPeers();
      });

      expect(useSyncStore.getState().trustedPeers).toHaveLength(1);
    });
  });

  describe('sync progress', () => {
    it('setSyncProgress should set progress object', () => {
      const { setSyncProgress } = useSyncStore.getState();
      const progress = {
        stage: 'pulling' as const,
        pulledCount: 5,
        pushedCount: 0,
        totalToPull: 10,
        totalToPush: 3,
      };

      act(() => {
        setSyncProgress(progress);
      });

      expect(useSyncStore.getState().syncProgress).toEqual(progress);
    });

    it('setSyncProgress null should clear progress', () => {
      const { setSyncProgress } = useSyncStore.getState();

      act(() => {
        setSyncProgress({ stage: 'pulling', pulledCount: 0, pushedCount: 0, totalToPull: 10, totalToPush: 0 });
      });

      act(() => {
        setSyncProgress(null);
      });

      expect(useSyncStore.getState().syncProgress).toBeNull();
    });

    it('updateSyncProgress should merge updates', () => {
      const { setSyncProgress, updateSyncProgress } = useSyncStore.getState();

      act(() => {
        setSyncProgress({ stage: 'pulling', pulledCount: 0, pushedCount: 0, totalToPull: 10, totalToPush: 5 });
      });

      act(() => {
        updateSyncProgress({ pulledCount: 3 });
      });

      const progress = useSyncStore.getState().syncProgress;
      expect(progress?.pulledCount).toBe(3);
      expect(progress?.totalToPull).toBe(10);
    });

    it('updateSyncProgress should do nothing if no current progress', () => {
      const { updateSyncProgress } = useSyncStore.getState();

      act(() => {
        updateSyncProgress({ pulledCount: 3 });
      });

      expect(useSyncStore.getState().syncProgress).toBeNull();
    });
  });

  describe('modal state', () => {
    it('should open and close export modal', () => {
      const { openExportModal, closeExportModal } = useSyncStore.getState();

      act(() => {
        openExportModal();
      });
      expect(useSyncStore.getState().isExportModalOpen).toBe(true);

      act(() => {
        closeExportModal();
      });
      expect(useSyncStore.getState().isExportModalOpen).toBe(false);
    });

    it('should open and close import modal', () => {
      const { openImportModal, closeImportModal } = useSyncStore.getState();

      act(() => {
        openImportModal();
      });
      expect(useSyncStore.getState().isImportModalOpen).toBe(true);

      act(() => {
        closeImportModal();
      });
      expect(useSyncStore.getState().isImportModalOpen).toBe(false);
    });

    it('should open and close pairing modal', () => {
      const { openPairingModal, closePairingModal } = useSyncStore.getState();

      act(() => {
        openPairingModal();
      });
      expect(useSyncStore.getState().isPairingModalOpen).toBe(true);

      act(() => {
        closePairingModal();
      });
      expect(useSyncStore.getState().isPairingModalOpen).toBe(false);
    });
  });

  describe('conflict banner', () => {
    it('dismissConflictBanner should set dismissed to true', () => {
      const { dismissConflictBanner } = useSyncStore.getState();

      act(() => {
        dismissConflictBanner();
      });

      expect(useSyncStore.getState().isConflictBannerDismissed).toBe(true);
    });

    it('resetConflictBanner should set dismissed to false', () => {
      const { dismissConflictBanner, resetConflictBanner } = useSyncStore.getState();

      act(() => {
        dismissConflictBanner();
      });

      act(() => {
        resetConflictBanner();
      });

      expect(useSyncStore.getState().isConflictBannerDismissed).toBe(false);
    });
  });
});

describe('Selectors', () => {
  beforeEach(() => {
    useSyncStore.setState({
      status: 'idle',
      lastSyncAt: '2026-03-13T12:00:00Z',
      lastError: null,
      serverRunning: true,
      serverPort: 8080,
      serverExpiresAt: null,
      pendingOpsCount: 10,
      pendingConflictsCount: 3,
      discoveredPeers: [],
      isDiscovering: false,
      trustedPeers: [
        { id: 'peer-1', name: 'Peer 1', publicKey: 'key-1', status: 'verified', pairedAt: '2026-03-13', lastSeenAt: '2026-03-13' },
      ],
      syncProgress: null,
      isExportModalOpen: false,
      isImportModalOpen: false,
      isPairingModalOpen: false,
      isConflictBannerDismissed: false,
    });
  });

  describe('selectSyncStatus', () => {
    it('should return current status', () => {
      const state = useSyncStore.getState();
      expect(selectSyncStatus(state)).toBe('idle');
    });
  });

  describe('selectHasPendingConflicts', () => {
    it('should return true when conflicts exist', () => {
      const state = useSyncStore.getState();
      expect(selectHasPendingConflicts(state)).toBe(true);
    });

    it('should return false when no conflicts', () => {
      useSyncStore.setState({ pendingConflictsCount: 0 });
      const state = useSyncStore.getState();
      expect(selectHasPendingConflicts(state)).toBe(false);
    });
  });

  describe('selectIsServerRunning', () => {
    it('should return server running state', () => {
      const state = useSyncStore.getState();
      expect(selectIsServerRunning(state)).toBe(true);
    });
  });

  describe('selectHasTrustedPeers', () => {
    it('should return true when peers exist', () => {
      const state = useSyncStore.getState();
      expect(selectHasTrustedPeers(state)).toBe(true);
    });

    it('should return false when no peers', () => {
      useSyncStore.setState({ trustedPeers: [] });
      const state = useSyncStore.getState();
      expect(selectHasTrustedPeers(state)).toBe(false);
    });
  });

  describe('selectSyncSummary', () => {
    it('should return summary object', () => {
      const state = useSyncStore.getState();
      const summary = selectSyncSummary(state);

      expect(summary).toEqual({
        status: 'idle',
        pendingOps: 10,
        pendingConflicts: 3,
        lastSync: '2026-03-13T12:00:00Z',
        trustedPeersCount: 1,
      });
    });
  });
});

describe('Custom Hooks', () => {
  beforeEach(() => {
    useSyncStore.setState({
      status: 'syncing',
      lastSyncAt: '2026-03-13T12:00:00Z',
      lastError: null,
      serverRunning: true,
      serverPort: 8080,
      serverExpiresAt: null,
      pendingOpsCount: 5,
      pendingConflictsCount: 2,
      discoveredPeers: [],
      isDiscovering: false,
      trustedPeers: [],
      syncProgress: { stage: 'pulling', pulledCount: 3, pushedCount: 0, totalToPull: 10, totalToPush: 0 },
      isExportModalOpen: false,
      isImportModalOpen: false,
      isPairingModalOpen: false,
      isConflictBannerDismissed: false,
    });
  });

  describe('useSyncStatus', () => {
    it('should return status-related state', () => {
      const { result } = renderHook(() => useSyncStatus());

      expect(result.current.status).toBe('syncing');
      expect(result.current.pendingConflicts).toBe(2);
      expect(result.current.lastSyncAt).toBe('2026-03-13T12:00:00Z');
      expect(result.current.serverRunning).toBe(true);
    });
  });

  describe('useSyncActions', () => {
    it('should return action functions', () => {
      const { result } = renderHook(() => useSyncActions());

      expect(typeof result.current.openExportModal).toBe('function');
      expect(typeof result.current.openImportModal).toBe('function');
      expect(typeof result.current.openPairingModal).toBe('function');
      expect(typeof result.current.startDiscovery).toBe('function');
      expect(typeof result.current.refreshCounts).toBe('function');
    });
  });

  describe('useSyncProgress', () => {
    it('should return current progress', () => {
      const { result } = renderHook(() => useSyncProgress());

      expect(result.current).toEqual({
        stage: 'pulling',
        pulledCount: 3,
        pushedCount: 0,
        totalToPull: 10,
        totalToPush: 0,
      });
    });

    it('should return null when no progress', () => {
      useSyncStore.setState({ syncProgress: null });
      const { result } = renderHook(() => useSyncProgress());

      expect(result.current).toBeNull();
    });
  });

  describe('useConflictBanner', () => {
    it('should return conflict banner state', () => {
      const { result } = renderHook(() => useConflictBanner());

      expect(result.current.count).toBe(2);
      expect(result.current.isDismissed).toBe(false);
      expect(typeof result.current.dismiss).toBe('function');
      expect(typeof result.current.reset).toBe('function');
    });

    it('dismiss should update state', () => {
      const { result } = renderHook(() => useConflictBanner());

      act(() => {
        result.current.dismiss();
      });

      expect(useSyncStore.getState().isConflictBannerDismissed).toBe(true);
    });
  });
});

describe('State Transitions', () => {
  beforeEach(() => {
    useSyncStore.setState({
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
    });
  });

  it('should handle full sync lifecycle', () => {
    const state = useSyncStore.getState();

    // Start sync
    act(() => {
      state.setStatus('syncing');
      state.setSyncProgress({
        stage: 'connecting',
        pulledCount: 0,
        pushedCount: 0,
        totalToPull: 0,
        totalToPush: 0,
      });
    });

    expect(useSyncStore.getState().status).toBe('syncing');
    expect(useSyncStore.getState().syncProgress?.stage).toBe('connecting');

    // Pulling
    act(() => {
      state.updateSyncProgress({ stage: 'pulling', totalToPull: 10 });
    });

    expect(useSyncStore.getState().syncProgress?.stage).toBe('pulling');

    // Progress updates
    act(() => {
      state.updateSyncProgress({ pulledCount: 5 });
    });

    expect(useSyncStore.getState().syncProgress?.pulledCount).toBe(5);

    // Pushing
    act(() => {
      state.updateSyncProgress({ stage: 'pushing', pulledCount: 10, totalToPush: 3 });
    });

    expect(useSyncStore.getState().syncProgress?.stage).toBe('pushing');

    // Complete
    act(() => {
      state.updateSyncProgress({ stage: 'done', pushedCount: 3 });
      state.setStatus('idle');
      state.setLastSync('2026-03-13T15:00:00Z');
      state.setSyncProgress(null);
    });

    const finalState = useSyncStore.getState();
    expect(finalState.status).toBe('idle');
    expect(finalState.lastSyncAt).toBe('2026-03-13T15:00:00Z');
    expect(finalState.syncProgress).toBeNull();
  });

  it('should handle sync error', () => {
    const state = useSyncStore.getState();

    // Start sync
    act(() => {
      state.setStatus('syncing');
      state.setSyncProgress({
        stage: 'connecting',
        pulledCount: 0,
        pushedCount: 0,
        totalToPull: 0,
        totalToPush: 0,
      });
    });

    // Error occurs
    act(() => {
      state.setStatus('error');
      state.setLastError('Connection refused');
      state.setSyncProgress(null);
    });

    const finalState = useSyncStore.getState();
    expect(finalState.status).toBe('error');
    expect(finalState.lastError).toBe('Connection refused');
    expect(finalState.syncProgress).toBeNull();
  });
});
