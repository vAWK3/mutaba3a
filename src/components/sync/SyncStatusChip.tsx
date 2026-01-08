/**
 * Sync Status Chip
 *
 * A compact status indicator for the app header that shows sync status.
 * Clicking opens the sync settings.
 */

import { useSyncStatus } from '../../sync/stores/syncStore';
import { useNavigate } from '@tanstack/react-router';
import './SyncStatusChip.css';

export function SyncStatusChip() {
  const { status, pendingConflicts, lastSyncAt } = useSyncStatus();
  const navigate = useNavigate();

  const handleClick = () => {
    navigate({ to: '/settings', search: { section: 'sync' } });
  };

  // Determine display state
  const getDisplayState = () => {
    if (pendingConflicts > 0) {
      return {
        label: 'Conflicts',
        sublabel: `${pendingConflicts} ${pendingConflicts === 1 ? 'item' : 'items'}`,
        variant: 'warning' as const,
        icon: '⚠',
      };
    }

    switch (status) {
      case 'syncing':
        return {
          label: 'Syncing…',
          sublabel: '',
          variant: 'syncing' as const,
          icon: '↻',
        };
      case 'error':
        return {
          label: 'Sync Error',
          sublabel: '',
          variant: 'error' as const,
          icon: '✕',
        };
      case 'offline':
        return {
          label: 'Offline',
          sublabel: '',
          variant: 'muted' as const,
          icon: '○',
        };
      case 'idle':
      default:
        return {
          label: 'Synced',
          sublabel: lastSyncAt ? formatRelativeTime(lastSyncAt) : '',
          variant: 'success' as const,
          icon: '✓',
        };
    }
  };

  const displayState = getDisplayState();

  return (
    <button
      className={`sync-status-chip sync-status-chip--${displayState.variant}`}
      onClick={handleClick}
      title={`Sync status: ${displayState.label}. Click to open sync settings.`}
    >
      <span className="sync-status-chip__icon">{displayState.icon}</span>
      <span className="sync-status-chip__label">{displayState.label}</span>
      {displayState.sublabel && (
        <span className="sync-status-chip__sublabel">{displayState.sublabel}</span>
      )}
    </button>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
