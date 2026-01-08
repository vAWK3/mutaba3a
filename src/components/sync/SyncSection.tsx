/**
 * Sync Section
 *
 * Settings section for sync configuration, displayed in the Settings page.
 */

import { useState, useEffect } from 'react';
import { useSyncStore, useSyncStatus, useSyncActions } from '../../sync/stores/syncStore';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import './SyncSection.css';

// Check if running in Tauri (Tauri 2.x uses __TAURI_INTERNALS__)
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function SyncSection() {
  const { status, pendingConflicts, lastSyncAt, serverRunning } = useSyncStatus();
  const { openExportModal, openImportModal, openPairingModal, startDiscovery, refreshCounts } = useSyncActions();
  const trustedPeers = useSyncStore((s) => s.trustedPeers);
  const pendingOpsCount = useSyncStore((s) => s.pendingOpsCount);
  const discoveredPeers = useSyncStore((s) => s.discoveredPeers);
  const isDiscovering = useSyncStore((s) => s.isDiscovering);

  const [serverStarting, setServerStarting] = useState(false);

  useEffect(() => {
    refreshCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  const handleStartServer = async () => {
    if (!isTauri) return;

    setServerStarting(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const device = await getLocalDevice();

      const result = await invoke<{ port: number; expires_at: string | null }>('start_sync_server', {
        deviceId: device.id,
        deviceName: device.name,
        autoShutdownMinutes: 30,
      });

      useSyncStore.getState().setServerRunning(true, result.port, result.expires_at ?? undefined);
    } catch (error) {
      console.error('Failed to start sync server:', error);
    } finally {
      setServerStarting(false);
    }
  };

  const handleStopServer = async () => {
    if (!isTauri) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('stop_sync_server');
      useSyncStore.getState().setServerRunning(false);
    } catch (error) {
      console.error('Failed to stop sync server:', error);
    }
  };

  const handleDiscoverPeers = () => {
    startDiscovery();
  };

  return (
    <div className="sync-section">
      <h2 className="sync-section__title">Sync</h2>

      {/* Status Card */}
      <Card className="sync-section__card">
        <div className="sync-status-block">
          <div className="sync-status-block__header">
            <span className={`sync-status-indicator sync-status-indicator--${status}`} />
            <span className="sync-status-block__title">
              {getStatusTitle(status, pendingConflicts)}
            </span>
          </div>

          <div className="sync-status-block__meta">
            {lastSyncAt && (
              <div className="sync-meta-item">
                <span className="sync-meta-item__label">Last sync:</span>
                <span className="sync-meta-item__value">{formatDateTime(lastSyncAt)}</span>
              </div>
            )}
            {pendingOpsCount > 0 && (
              <div className="sync-meta-item">
                <span className="sync-meta-item__label">Pending changes:</span>
                <span className="sync-meta-item__value">{pendingOpsCount}</span>
              </div>
            )}
            {trustedPeers.length > 0 && (
              <div className="sync-meta-item">
                <span className="sync-meta-item__label">Trusted devices:</span>
                <span className="sync-meta-item__value">
                  {trustedPeers.map((p) => p.name).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Wi-Fi Sync (Tauri only) */}
      {isTauri && (
        <Card className="sync-section__card">
          <h3 className="sync-section__subtitle">Wi-Fi Sync</h3>

          <div className="sync-server-toggle">
            <div className="sync-server-toggle__info">
              <span className="sync-server-toggle__label">
                Make this desktop available for sync
              </span>
              <span className="sync-server-toggle__helper">
                {serverRunning
                  ? 'This desktop is discoverable on your network.'
                  : 'Your phone won\'t find this desktop on Wi-Fi.'}
              </span>
            </div>
            <Button
              variant={serverRunning ? 'secondary' : 'primary'}
              onClick={serverRunning ? handleStopServer : handleStartServer}
              disabled={serverStarting}
            >
              {serverStarting ? 'Starting...' : serverRunning ? 'Stop Server' : 'Start Server'}
            </Button>
          </div>

          {serverRunning && (
            <div className="sync-discovery">
              <div className="sync-discovery__actions">
                <Button variant="primary" onClick={openPairingModal}>
                  Pair Device
                </Button>
                <Button variant="ghost" onClick={handleDiscoverPeers} disabled={isDiscovering}>
                  {isDiscovering ? 'Discovering...' : 'Find Devices'}
                </Button>
              </div>

              {discoveredPeers.length > 0 && (
                <ul className="sync-discovered-list">
                  {discoveredPeers.map((peer) => (
                    <li key={peer.deviceId} className="sync-discovered-item">
                      <span className="sync-discovered-item__name">{peer.name}</span>
                      <span className="sync-discovered-item__address">
                        {peer.address}:{peer.port}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Export / Import Fallback */}
      <Card className="sync-section__card">
        <h3 className="sync-section__subtitle">Export / Import</h3>
        <p className="sync-section__description">
          Use this to sync when Wi-Fi sync isn't available. Creates an encrypted file with your
          changes.
        </p>

        <div className="sync-fallback-actions">
          <Button variant="secondary" onClick={openExportModal}>
            Export Sync Bundle
          </Button>
          <Button variant="secondary" onClick={openImportModal}>
            Import Sync Bundle
          </Button>
        </div>
      </Card>

      {/* Conflicts */}
      {pendingConflicts > 0 && (
        <Card className="sync-section__card sync-section__card--warning">
          <h3 className="sync-section__subtitle">Conflicts</h3>
          <p className="sync-section__description">
            {pendingConflicts} {pendingConflicts === 1 ? 'edit needs' : 'edits need'} your review.
            These changes were made on multiple devices.
          </p>
          <Button variant="primary">Review Conflicts</Button>
        </Card>
      )}
    </div>
  );
}

// Helper to get local device
async function getLocalDevice() {
  const { getOrCreateLocalDevice } = await import('../../sync/core/ops-engine');
  return getOrCreateLocalDevice();
}

function getStatusTitle(status: string, conflictCount: number): string {
  if (conflictCount > 0) return 'Conflicts need review';
  switch (status) {
    case 'syncing':
      return 'Syncing...';
    case 'error':
      return 'Sync error';
    case 'offline':
      return 'Offline';
    default:
      return 'Synced';
  }
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
