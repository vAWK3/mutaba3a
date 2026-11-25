/**
 * MUTABA3A-LANDING-3: a lazy page or section whose file can't load (a visitor's page from before a deploy asks for a
 * file the deploy replaced, or the network dropped it) used to put up "Something went wrong" in place of the website.
 * Vite reports it as `vite:preloadError`; the page reloads once so it gets the current files. A second failure within
 * a minute is left to the error boundary, so a file that is really gone never loops.
 */

export const STALE_CHUNK_KEY = 'mutaba3a.landing.staleChunkReload';
const RETRY_AFTER_MS = 60_000;

interface Deps {
  storage: () => Storage;
  reload: () => void;
  now: () => number;
}

const browser: Deps = {
  storage: () => window.sessionStorage,
  reload: () => window.location.reload(),
  now: () => Date.now(),
};

/** True when it reloaded the page (the event's default, throwing the error, is then cancelled). */
export function reloadOnceForStaleChunk(event: Event, deps: Deps = browser): boolean {
  try {
    const storage = deps.storage();
    const last = Number(storage.getItem(STALE_CHUNK_KEY) ?? 0);
    const now = deps.now();
    if (Number.isFinite(last) && now - last < RETRY_AFTER_MS) return false;
    storage.setItem(STALE_CHUNK_KEY, String(now));
  } catch {
    // No session storage (private mode, blocked): no way to know a reload already happened, so never loop
    return false;
  }
  event.preventDefault();
  deps.reload();
  return true;
}

export function installStaleChunkReload(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('vite:preloadError', (event) => void reloadOnceForStaleChunk(event));
}
