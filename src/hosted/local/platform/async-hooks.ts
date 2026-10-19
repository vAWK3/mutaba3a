/**
 * Browser substitute for `node:async_hooks`'s `AsyncLocalStorage` (MUT-286
 * Phase B). Nothing in the portal's shared route modules uses it directly —
 * it exists only because `hono/context-storage` imports it at module scope,
 * and `auth/store-guard.ts` imports `tryGetContext` from there to read the
 * per-request store guard (`auth/middleware.ts` sets it; `createApp` wires
 * `contextStorage()` to carry it).
 *
 * `createLocalApp` never registers `contextStorage()` (ADR-097 §2.2: layer 3
 * is inactive locally, safely, because the single local person owns every
 * local profile). So `.run()` is never called here, and `.getStore()` always
 * answers `undefined` — the same "no context" shape `tryGetContext()` already
 * handles by no-op-ing the guard. This class only needs to not throw on
 * import and to behave correctly *if* something ever does call `.run()`
 * (e.g. a future test that wires `contextStorage()` against this shim); it is
 * not a spec-complete continuation-tracking implementation; a single-slot
 * save/restore around `.run()` is enough for in-page, non-worker JS.
 */
export class AsyncLocalStorage<T> {
  private store: T | undefined;

  run<R>(store: T, callback: () => R): R {
    const previous = this.store;
    this.store = store;
    try {
      return callback();
    } finally {
      this.store = previous;
    }
  }

  getStore(): T | undefined {
    return this.store;
  }

  enterWith(store: T): void {
    this.store = store;
  }

  exit<R>(callback: () => R): R {
    const previous = this.store;
    this.store = undefined;
    try {
      return callback();
    } finally {
      this.store = previous;
    }
  }

  disable(): void {
    this.store = undefined;
  }
}
