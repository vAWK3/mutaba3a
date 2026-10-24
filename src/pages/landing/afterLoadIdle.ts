/**
 * When the landing's lazy SDKs may load (MUT-154 D1, MUT-150 eng D5): after
 * the page has finished loading (fonts and the hero first), then once the
 * browser is idle, so first paint carries none of them. PostHog's counting and
 * Sentry's error reports both wait here.
 */

/** How long to wait for idle before running anyway. */
export const FALLBACK_IDLE_MS = 1500;

/** Runs `run` once the browser is idle; returns the cancel. */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: FALLBACK_IDLE_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, FALLBACK_IDLE_MS);
  return () => window.clearTimeout(id);
}

/** Runs `run` after load, then idle; returns the cancel. */
export function afterLoadIdle(run: () => void): () => void {
  if (document.readyState === 'complete') return whenIdle(run);
  let cancelIdle: (() => void) | null = null;
  const onLoad = () => {
    cancelIdle = whenIdle(run);
  };
  window.addEventListener('load', onLoad, { once: true });
  return () => {
    window.removeEventListener('load', onLoad);
    cancelIdle?.();
  };
}
