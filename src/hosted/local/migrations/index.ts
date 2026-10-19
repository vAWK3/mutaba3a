import { CURRENT_STORE_SNAPSHOT_VERSION, type LocalSnapshotMaps } from '../../../../server/src/repositories/memory.js';

/**
 * The portal's local-mode migrations key off `CURRENT_STORE_SNAPSHOT_VERSION`
 * (`memory.ts`'s own docblock: "the portal's local-mode migrations (Phase B)
 * key off it") rather than keeping a second counter here — one number for
 * "what shape is a `LocalSnapshot`," not two that could drift apart.
 */
export const LOCAL_FORMAT_VERSION = CURRENT_STORE_SNAPSHOT_VERSION;

/**
 * What `persistence.ts` stores in IndexedDB: `MemoryLedgerStore.snapshot()`'s
 * own shape (`formatVersion`, `maps`) plus the persistence layer's own
 * bookkeeping (D1, plan §2.5).
 */
export interface StoredSnapshot {
  formatVersion: number;
  /** Bumped by one on every write (`transport.ts`); lets a tab tell its own view from another tab's (`locks.ts`). */
  stateVersion: number;
  savedAt: Date;
  maps: LocalSnapshotMaps;
}

export interface Migration {
  from: number;
  to: number;
  migrate: (snapshot: StoredSnapshot) => StoredSnapshot;
}

/**
 * Ordered `(from → to)` migrations run in sequence when a loaded snapshot's
 * `formatVersion` is older than `LOCAL_FORMAT_VERSION` (D1, brief §2.5).
 * Empty at first ship (version 1, nothing to migrate yet) — the mechanism
 * exists before it is needed, so the first real shape change only has to add
 * a function here, never invent the runner or the fingerprint test that
 * catches a forgotten one (`__tests__/format-fingerprint.test.ts`).
 */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Applies every migration in order starting from `snapshot.formatVersion`
 * until it reaches `LOCAL_FORMAT_VERSION`. A missing step in the chain is a
 * bug (a shape changed without a matching migration), not a recoverable
 * runtime state, so it throws rather than silently stopping short.
 */
export function migrate(snapshot: StoredSnapshot): StoredSnapshot {
  let current = snapshot;
  while (current.formatVersion < LOCAL_FORMAT_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === current.formatVersion);
    if (!step) {
      throw new Error(`No local-mode migration from format version ${current.formatVersion} to ${LOCAL_FORMAT_VERSION}`);
    }
    current = { ...step.migrate(current), formatVersion: step.to };
  }
  return current;
}
