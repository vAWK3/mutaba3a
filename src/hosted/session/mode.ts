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
 * `remote`; 401 means nobody, so `local`. Only that answer is saved: a network
 * failure saves nothing, so an offline first visit never strands a signed-in
 * person in an empty local app.
 */

export type PortalMode = 'local' | 'remote';
/** What a missing hint means: ask the server once (`probe`), or a fixed mode (tests pin `remote`, src/test/setup.ts). */
export type UnhintedMode = PortalMode | 'probe';

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

/** The mode, re-read when it changes in this tab. */
export function useMode(): UnhintedMode {
  return useSyncExternalStore(subscribe, currentMode, currentMode);
}

/** Signed-out-on-this-device, for gating account-only UI. */
export function useIsLocalMode(): boolean {
  return useMode() === 'local';
}
