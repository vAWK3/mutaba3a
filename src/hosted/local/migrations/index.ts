import { CURRENT_STORE_SNAPSHOT_VERSION, type LocalSnapshotMaps } from '../../../../server/src/repositories/memory.js';
import type { MembershipRecord, Organization } from '../../../../server/src/repositories/ports.js';

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
 * MUT-300 (ADR-099), 1 → 2: profiles gain the firm switch and memberships a
 * role. A device has no operator, so firm features are off and nothing is
 * requested; its one person owns every profile (ADR-097 §2.2), so every
 * membership is OWNER, the column's own default. New maps, never edits in
 * place: a migration doesn't touch the snapshot it was given.
 */
function addFirmFields(snapshot: StoredSnapshot): StoredSnapshot {
  type Stored<T> = Omit<T, 'firmEnabledAt' | 'firmRequestedAt' | 'firmRequestedByUserId' | 'role'>;
  const orgs = snapshot.maps.orgs as Map<string, Stored<Organization>>;
  const members = snapshot.maps.members as Map<string, Stored<MembershipRecord>>;
  return {
    ...snapshot,
    maps: {
      ...snapshot.maps,
      orgs: new Map([...orgs].map(([id, org]) => [id, { ...org, firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null }])),
      members: new Map([...members].map(([key, membership]) => [key, { ...membership, role: 'OWNER' as const }])),
    },
  };
}

/**
 * Ordered `(from → to)` migrations run in sequence when a loaded snapshot's
 * `formatVersion` is older than `LOCAL_FORMAT_VERSION` (D1, brief §2.5). A
 * shape change adds a function here; the fingerprint test catches a
 * forgotten one (`__tests__/format-fingerprint.test.ts`).
 */
export const MIGRATIONS: readonly Migration[] = [{ from: 1, to: 2, migrate: addFirmFields }];

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
