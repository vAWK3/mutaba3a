/**
 * localStorage keys whose feature is gone. They are removed once at startup so
 * that a retired feature leaves nothing behind in the browser.
 */
const RETIRED_LOCAL_STORAGE_KEYS = [
  // The floating, draggable FX banner's position and minimised state (MUT-79)
  'mutaba3a_fx_banner_state',
];

export function removeRetiredStorageKeys(): void {
  for (const key of RETIRED_LOCAL_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable (private browsing, blocked): nothing to clean
    }
  }
}
