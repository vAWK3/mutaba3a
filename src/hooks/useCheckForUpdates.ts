import { useState, useEffect } from 'react';
import { fetchLatestRelease } from './useLatestRelease';
import { isTauri } from '../lib/platform';
import { compareVersions } from '../lib/whatsNew/releaseNotes';

const CACHE_KEY = 'update-check-result';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

interface CachedResult {
  latestVersion: string;
  hasUpdate: boolean;
  timestamp: number;
}

interface UpdateCheckResult {
  latestVersion: string | null;
  hasUpdate: boolean;
  isLoading: boolean;
  error: string | null;
}

function getCachedResult(): CachedResult | null {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const parsed: CachedResult = JSON.parse(cached);
    const isExpired = Date.now() - parsed.timestamp > CACHE_DURATION_MS;

    if (isExpired) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function setCachedResult(latestVersion: string, hasUpdate: boolean): void {
  const result: CachedResult = {
    latestVersion,
    hasUpdate,
    timestamp: Date.now(),
  };
  sessionStorage.setItem(CACHE_KEY, JSON.stringify(result));
}

/**
 * Get current app version from Tauri or fallback to a default
 */
function getCurrentVersion(): string {
  // In Tauri, we can get the version from the app
  // For now, use a fallback that will be compared against GitHub
  if (isTauri()) {
    // This would need to be fetched async, but for simplicity we use package.json version
    return __APP_VERSION__ || '0.0.0';
  }
  return __APP_VERSION__ || '0.0.0';
}

// Define the app version constant (set by Vite)
declare const __APP_VERSION__: string | undefined;

export function useCheckForUpdates(): UpdateCheckResult {
  const [state, setState] = useState<UpdateCheckResult>({
    latestVersion: null,
    hasUpdate: false,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const checkForUpdates = async () => {
      // Check cache first
      const cached = getCachedResult();
      if (cached) {
        setState({
          latestVersion: cached.latestVersion,
          hasUpdate: cached.hasUpdate,
          isLoading: false,
          error: null,
        });
        return;
      }

      try {
        const release = await fetchLatestRelease();
        const latestVersion = release.version;
        const currentVersion = getCurrentVersion();

        const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

        // Cache the result
        setCachedResult(latestVersion, hasUpdate);

        setState({
          latestVersion,
          hasUpdate,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        setState({
          latestVersion: null,
          hasUpdate: false,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    };

    checkForUpdates();
  }, []);

  return state;
}
