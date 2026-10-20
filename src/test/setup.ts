import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { configure } from '@testing-library/react';
import { setUnhintedMode } from '../hosted/session/mode';

// Page tests that render against fake-indexeddb take ~1 s each under the full
// suite's parallel load; the library's 1 s default for waitFor/findBy then
// flakes (seen on ExpensesLedgerPage after MUT-14). 3 s costs nothing when a
// test passes and only delays a genuine failure.
configure({ asyncUtilTimeout: 3000 });

// Browser shims, only where there is a browser: a few tests (scripts/, the
// Vite config) run in the node environment, where `window` doesn't exist.
if (typeof window !== 'undefined') {
  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock ResizeObserver
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // Mock URL.createObjectURL and URL.revokeObjectURL
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();

  // jsdom's Blob has no text() (every browser the portal targets has); the local backend's Restore reads a file with it.
  if (typeof Blob.prototype.text !== 'function') {
    Blob.prototype.text = function text(this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Blob read failed'));
        reader.readAsText(this);
      });
    };
  }
}

// Tests never reach the network. The top bar's exchange rate (MUT-79) renders
// in every page test, and its query would otherwise call the live FX API; a
// refused request takes the same cached/unavailable path as being offline.
// Tests that need responses stub `fetch` themselves (vi.stubGlobal).
globalThis.fetch = (input: RequestInfo | URL) =>
  Promise.reject(new TypeError(`Network disabled in tests: ${String(input)}`));

// The portal with no mode hint asks the server once whether anyone is signed in (MUT-286). Portal tests stub
// `fetch` for the requests they make and clear localStorage freely, so a missing hint means "the server" here;
// local-mode tests set the hint or call setUnhintedMode themselves.
setUnhintedMode('remote');

// Clean up after each test
afterEach(() => {
  setUnhintedMode('remote');
  vi.clearAllMocks();
});
