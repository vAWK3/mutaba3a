import { useState, useEffect, useCallback } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauri } from '../lib/platform';

const LAST_CHECK_KEY = 'tauri-updater-last-check';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error';

export interface TauriUpdaterState {
  status: UpdateStatus;
  currentVersion: string | null;
  availableVersion: string | null;
  downloadProgress: number; // 0-100
  error: string | null;
}

export interface TauriUpdaterActions {
  checkNow: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  applyUpdate: () => Promise<void>;
}

export type TauriUpdaterResult = TauriUpdaterState & TauriUpdaterActions;

function shouldCheckForUpdates(): boolean {
  try {
    const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
    if (!lastCheck) return true;

    const lastCheckTime = parseInt(lastCheck, 10);
    return Date.now() - lastCheckTime > CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markCheckComplete(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, Date.now().toString());
  } catch {
    // Ignore storage errors
  }
}

export function useTauriUpdater(): TauriUpdaterResult {
  const [state, setState] = useState<TauriUpdaterState>({
    status: 'idle',
    currentVersion: null,
    availableVersion: null,
    downloadProgress: 0,
    error: null,
  });

  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);

  const checkNow = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'checking', error: null }));

    try {
      const update = await check();

      if (update) {
        setState((prev) => ({
          ...prev,
          status: 'idle',
          currentVersion: update.currentVersion,
          availableVersion: update.version,
        }));
        setPendingUpdate(update);
      } else {
        setState((prev) => ({
          ...prev,
          status: 'up-to-date',
          availableVersion: null,
        }));
      }

      markCheckComplete();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to check for updates',
      }));
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!pendingUpdate) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: 'No update available to download',
      }));
      return;
    }

    setState((prev) => ({ ...prev, status: 'downloading', downloadProgress: 0 }));

    try {
      let downloadedBytes = 0;
      let totalBytes = 0;

      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            totalBytes = event.data.contentLength || 0;
            break;
          case 'Progress':
            downloadedBytes += event.data.chunkLength;
            if (totalBytes > 0) {
              const progress = Math.round((downloadedBytes / totalBytes) * 100);
              setState((prev) => ({ ...prev, downloadProgress: progress }));
            }
            break;
          case 'Finished':
            setState((prev) => ({ ...prev, status: 'ready', downloadProgress: 100 }));
            break;
        }
      });

      setState((prev) => ({ ...prev, status: 'ready', downloadProgress: 100 }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to download update',
      }));
    }
  }, [pendingUpdate]);

  const applyUpdate = useCallback(async () => {
    try {
      await relaunch();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to restart application',
      }));
    }
  }, []);

  // Auto-check on mount if interval has passed
  useEffect(() => {
    // Only run in Tauri environment
    if (!isTauri()) {
      return;
    }

    if (shouldCheckForUpdates()) {
      checkNow();
    }
  }, [checkNow]);

  return {
    ...state,
    checkNow,
    downloadAndInstall,
    applyUpdate,
  };
}

// Re-export isTauri from platform.ts for backwards compatibility
export { isTauri } from '../lib/platform';
