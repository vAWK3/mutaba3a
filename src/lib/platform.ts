/**
 * Platform Detection Utilities
 *
 * Centralized detection of runtime environment (Tauri desktop vs web browser).
 * All platform-specific checks should use these functions for consistency.
 *
 * IMPORTANT: Tauri 2.x uses __TAURI_INTERNALS__ (not __TAURI__ from v1.x)
 */

/**
 * Check if the app is running in a Tauri desktop environment.
 * Uses Tauri 2.x detection pattern (__TAURI_INTERNALS__).
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Check if the app is running in a web browser (not Tauri).
 */
export function isWeb(): boolean {
  return !isTauri();
}

/**
 * Check if running on macOS.
 */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform?.toLowerCase() || '';
  const userAgent = navigator.userAgent?.toLowerCase() || '';
  return platform.includes('mac') || userAgent.includes('macintosh');
}

/**
 * Check if running on Windows.
 */
export function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform?.toLowerCase() || '';
  const userAgent = navigator.userAgent?.toLowerCase() || '';
  return platform.includes('win') || userAgent.includes('windows');
}

/**
 * Check if running on Linux.
 */
export function isLinux(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform?.toLowerCase() || '';
  const userAgent = navigator.userAgent?.toLowerCase() || '';
  return platform.includes('linux') || userAgent.includes('linux');
}

// --- Version change handling ---

const LAST_KNOWN_VERSION_KEY = 'app-last-known-version';
const UPDATE_CACHE_KEYS = [
  'update-banner-dismissed-version',
  'tauri-updater-last-check',
  'update-check-result',
  'latest-release-info',
];

/**
 * Check if app version changed since last run.
 * If so, clear update-related caches to ensure users see the correct version
 * after installing a new DMG (macOS preserves localStorage across installs).
 *
 * Call this early in app initialization.
 */
export function handleVersionChange(currentVersion: string): void {
  if (typeof localStorage === 'undefined') return;

  try {
    const lastKnownVersion = localStorage.getItem(LAST_KNOWN_VERSION_KEY);

    if (lastKnownVersion && lastKnownVersion !== currentVersion) {
      // Version changed! Clear update-related caches
      console.log(
        `[platform] App version changed from ${lastKnownVersion} to ${currentVersion}, clearing update caches`
      );
      for (const key of UPDATE_CACHE_KEYS) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
    }

    // Always update the stored version
    localStorage.setItem(LAST_KNOWN_VERSION_KEY, currentVersion);
  } catch {
    // Ignore storage errors (private browsing, quota exceeded, etc.)
  }
}
