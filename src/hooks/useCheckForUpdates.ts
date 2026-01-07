import { useState, useEffect } from 'react';
import { fetchLatestRelease } from './useLatestRelease';

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

/**
 * Compare two semver versions.
 * Returns > 0 if latest is newer, 0 if same, < 0 if current is newer.
 */
function compareVersions(current: string, latest: string): number {
  const parseParts = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0);
  const [aMajor = 0, aMinor = 0, aPatch = 0] = parseParts(current);
  const [bMajor = 0, bMinor = 0, bPatch = 0] = parseParts(latest);

  if (bMajor !== aMajor) return bMajor - aMajor;
  if (bMinor !== aMinor) return bMinor - aMinor;
  return bPatch - aPatch;
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
  try {
    // @ts-expect-error - Tauri global may not exist in web context
    if (window.__TAURI__) {
      // This would need to be fetched async, but for simplicity we use package.json version
      return __APP_VERSION__ || '0.0.0';
    }
  } catch {
    // Not in Tauri context
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

        const hasUpdate = compareVersions(currentVersion, latestVersion) > 0;

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
