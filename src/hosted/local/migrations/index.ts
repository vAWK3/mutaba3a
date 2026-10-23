import { CURRENT_STORE_SNAPSHOT_VERSION, type LocalSnapshotMaps } from '../../../../server/src/repositories/memory.js';
import type { ExpenseReceiptRecord, MembershipRecord, Organization, UserRecord } from '../../../../server/src/repositories/ports.js';

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
 * MUT-255, 2 → 3: receipts gain their place in the receipts library. Every
 * receipt saved before this had an expense, so it is FILED, never approved
 * through the library, at version 1; its upload day is its `createdAt` in its
 * profile's timezone, the same backfill the server's migration does.
 */
function addReceiptLibraryFields(snapshot: StoredSnapshot): StoredSnapshot {
  // `server/src/dates.ts` `todayIn` does the same; it isn't on the local backend's import allowlist (ADR-097 §9).
  const dayIn = (timeZone: string, at: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  type Stored = Omit<ExpenseReceiptRecord, 'filingStatus' | 'receivedOn' | 'suggested' | 'approved' | 'approvedAt' | 'approvedByUserId' | 'version'>;
  const receipts = snapshot.maps.expReceipts as Map<string, Stored>;
  const orgs = snapshot.maps.orgs as Map<string, Organization>;
  return {
    ...snapshot,
    maps: {
      ...snapshot.maps,
      expReceipts: new Map(
        [...receipts].map(([id, r]) => [
          id,
          {
            ...r,
            filingStatus: 'FILED' as const,
            receivedOn: dayIn(orgs.get(r.organizationId)?.timezone ?? 'UTC', r.createdAt),
            suggested: null,
            approved: null,
            approvedAt: null,
            approvedByUserId: null,
            version: 1,
          },
        ]),
      ),
    },
  };
}

/**
 * MUT-366, 3 → 4: people gain `emailVerifiedAt`. A device's person never proved an address by mail (local mode has
 * no mail), so it is null.
 */
function addEmailVerifiedAt(snapshot: StoredSnapshot): StoredSnapshot {
  const people = snapshot.maps.people as Map<string, Omit<UserRecord, 'emailVerifiedAt'>>;
  return {
    ...snapshot,
    maps: { ...snapshot.maps, people: new Map([...people].map(([id, person]) => [id, { ...person, emailVerifiedAt: null }])) },
  };
}

/**
 * Ordered `(from → to)` migrations run in sequence when a loaded snapshot's
 * `formatVersion` is older than `LOCAL_FORMAT_VERSION` (D1, brief §2.5). A
 * shape change adds a function here; the fingerprint test catches a
 * forgotten one (`__tests__/format-fingerprint.test.ts`).
 */
export const MIGRATIONS: readonly Migration[] = [
  { from: 1, to: 2, migrate: addFirmFields },
  { from: 2, to: 3, migrate: addReceiptLibraryFields },
  { from: 3, to: 4, migrate: addEmailVerifiedAt },
];

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
