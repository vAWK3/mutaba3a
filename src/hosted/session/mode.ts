import { useSyncExternalStore } from 'react';

/**
 * Which backend the portal talks to (MUT-286, brief §2.6): `local` runs the
 * server's own routes in this page over IndexedDB; `remote` is the hosted
 * account. The hint is one localStorage key, a per-viewer convenience
 * (hosted-portal.md §8 as amended by ADR-097): set on sign-in, sign-out and
 * the session-expired choice.
 *
 * With no hint at all (first visit, or someone signed in before local mode
 * shipped), `client.ts` asks the server once: 200 means a live session, so
 * `remote`, saved. 401 means nobody is signed in, but this browser hasn't
 * chosen yet: `undecided`, held for this page only, and the welcome asks
 * (MUT-513, ADR-230). A network failure saves nothing either, so an offline
 * first visit never strands a signed-in person in an empty local app.
 */

export type PortalMode = 'local' | 'remote';
/**
 * What a missing hint means: ask the server once (`probe`), nobody signed in and no choice made yet (`undecided`), or
 * a fixed mode (tests pin `remote`, src/test/setup.ts; Try after an unreachable server holds `local` for this page).
 */
export type UnhintedMode = PortalMode | 'probe' | 'undecided';

export const MODE_KEY = 'mut-mode';

let unhinted: UnhintedMode = 'probe';
const listeners = new Set<() => void>();

function isMode(value: unknown): value is PortalMode {
  return value === 'local' || value === 'remote';
}

/** The stored hint, or null when there is none or storage is unreadable. */
export function readModeHint(): PortalMode | null {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    return isMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The hint, else what an unhinted visit resolves to; `probe` until the server has answered. */
export function currentMode(): UnhintedMode {
  return readModeHint() ?? unhinted;
}

/** True only once the portal is known to be signed out on this device. */
export function isLocalMode(): boolean {
  return currentMode() === 'local';
}

export function setMode(mode: PortalMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage blocked: this page still knows; the next load asks the server again.
    unhinted = mode;
  }
  listeners.forEach((listener) => listener());
}

/** What a missing hint resolves to. Production leaves it at `probe`; the test setup pins `remote`. */
export function setUnhintedMode(mode: UnhintedMode): void {
  unhinted = mode;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called after every mode change in this tab, and in another one while `onModeChangedElsewhere` listens (MUT-149). */
export const subscribeMode = subscribe;

/**
 * Another tab changed the mode (MUT-286 review): it signed in, or continued
 * on this device. This tab's requests follow the hint at once, so its screen
 * must too; returns the unsubscribe function. A `storage` event only ever
 * reaches the *other* tabs, never the one that wrote.
 */
export function onModeChangedElsewhere(handler: (mode: PortalMode) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MODE_KEY || event.newValue === event.oldValue || !isMode(event.newValue)) return;
    listeners.forEach((listener) => listener());
    handler(event.newValue);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** The mode, re-read when it changes in this tab. */
export function useMode(): UnhintedMode {
  return useSyncExternalStore(subscribe, currentMode, currentMode);
}

/** Signed-out-on-this-device, for gating account-only UI. */
export function useIsLocalMode(): boolean {
  return useMode() === 'local';
}
