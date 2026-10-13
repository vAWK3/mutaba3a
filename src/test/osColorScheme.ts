import { vi } from 'vitest';

/**
 * A controllable `prefers-color-scheme: dark` for tests of the System theme:
 * `install(dark)` replaces the static matchMedia mock from setup.ts, and
 * `set(dark)` flips the OS scheme and fires the change listeners the way a
 * browser does.
 */
export function fakeOsColorScheme() {
  let dark = false;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  };
  return {
    install(initiallyDark: boolean) {
      dark = initiallyDark;
      vi.spyOn(window, 'matchMedia').mockImplementation(() => query as unknown as MediaQueryList);
    },
    set(nextDark: boolean) {
      dark = nextDark;
      for (const listener of listeners) listener({ matches: dark } as MediaQueryListEvent);
    },
  };
}
