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

// --- Device kind (for choosing what to offer a visitor) ---

export type DeviceKind = 'mac' | 'windows' | 'ios' | 'android' | 'linux' | 'unknown';

/** The navigator fields `detectDevice` reads, passed in so the rule is pure and testable. */
export interface DeviceSignals {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

/**
 * Which kind of device these navigator signals describe.
 *
 * It separates an iPad from a Mac (iPadOS 13+ reports `MacIntel`; only touch
 * support gives it away) and Android from Linux (Android's UA also says
 * "Linux"). It replaced the substring checks `isMacOS`/`isWindows`/`isLinux`,
 * which got both wrong (TD-049, MUT-79). It cannot tell an Intel Mac from an
 * Apple Silicon one — no browser signal does that reliably.
 */
export function detectDevice({ userAgent, platform, maxTouchPoints }: DeviceSignals): DeviceKind {
  const ua = userAgent.toLowerCase();
  const pf = platform.toLowerCase();
  const looksLikeMac = pf.includes('mac') || ua.includes('macintosh');

  if (/iphone|ipad|ipod/.test(ua) || /iphone|ipad|ipod/.test(pf)) return 'ios';
  if (looksLikeMac && maxTouchPoints > 1) return 'ios';
  if (ua.includes('android')) return 'android';
  if (looksLikeMac) return 'mac';
  if (pf.includes('win') || ua.includes('windows')) return 'windows';
  if (pf.includes('linux') || ua.includes('linux') || ua.includes('cros')) return 'linux';
  return 'unknown';
}

/** `detectDevice` for the browser this code is running in. */
export function currentDevice(): DeviceKind {
  if (typeof navigator === 'undefined') return 'unknown';
  return detectDevice({
    userAgent: navigator.userAgent ?? '',
    platform: navigator.platform ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
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
