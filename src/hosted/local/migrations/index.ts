import { CURRENT_STORE_SNAPSHOT_VERSION, type LocalSnapshotMaps } from '../../../../server/src/repositories/memory.js';
import type { CreditRecord, ExpenseReceiptRecord, ExpenseRecord, FeeProposalRecord, MembershipRecord, Organization, PaymentRecord, ReceivableRecord, SupplementRecord, UserRecord } from '../../../../server/src/repositories/ports.js';
import { backfillReceivableNumbers } from '../../../../server/src/payments/numbering.js';

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
 * MUT-418, 4 → 5: people gain `trialPrompt`. A device has no trial, so nothing was ever answered: null.
 */
function addTrialPrompt(snapshot: StoredSnapshot): StoredSnapshot {
  const people = snapshot.maps.people as Map<string, Omit<UserRecord, 'trialPrompt'>>;
  return {
    ...snapshot,
    maps: { ...snapshot.maps, people: new Map([...people].map(([id, person]) => [id, { ...person, trialPrompt: null }])) },
  };
}

/**
 * MUT-254, 5 → 6: expenses gain `vendorId`, and the vendors and their names get maps of their own. Nothing saved
 * before had a vendor, so every expense's is null and both maps start empty; a typed vendor resolves on the next save.
 */
function addVendors(snapshot: StoredSnapshot): StoredSnapshot {
  const exps = snapshot.maps.exps as Map<string, Omit<ExpenseRecord, 'vendorId'>>;
  return {
    ...snapshot,
    maps: {
      ...snapshot.maps,
      exps: new Map([...exps].map(([id, expense]) => [id, { ...expense, vendorId: null }])),
      vendors: new Map(),
      vendorNames: new Map(),
    },
  };
}

/**
 * MUT-333, 6 → 7: people gain `closure`. Closing is the hosted account's; a device's person is never closing: null.
 */
function addClosure(snapshot: StoredSnapshot): StoredSnapshot {
  const people = snapshot.maps.people as Map<string, Omit<UserRecord, 'closure'>>;
  return {
    ...snapshot,
    maps: { ...snapshot.maps, people: new Map([...people].map(([id, person]) => [id, { ...person, closure: null }])) },
  };
}

/**
 * MUT-459, 7 → 8: people gain `operatorAt`. Operators are hosted accounts marked by the admin token; a device's person
 * is never one: null.
 */
function addOperatorAt(snapshot: StoredSnapshot): StoredSnapshot {
  const people = snapshot.maps.people as Map<string, Omit<UserRecord, 'operatorAt'>>;
  return {
    ...snapshot,
    maps: { ...snapshot.maps, people: new Map([...people].map(([id, person]) => [id, { ...person, operatorAt: null }])) },
  };
}

/**
 * MUT-478, 8 → 9: receivables gain `number` (CHG-YYYY-NNNN), backfilled in the order the server's migration uses, and
 * the counters resume after each organization-year's last number.
 */
function addReceivableNumbers(snapshot: StoredSnapshot): StoredSnapshot {
  const recs = snapshot.maps.recs as Map<string, Omit<ReceivableRecord, 'number'>>;
  const { numbers, counters } = backfillReceivableNumbers([...recs.values()]);
  return {
    ...snapshot,
    maps: {
      ...snapshot.maps,
      recs: new Map([...recs].map(([id, r]) => [id, { ...r, number: numbers.get(id)! }])),
      counters: new Map([...snapshot.maps.counters, ...counters]),
    },
  };
}

/**
 * MUT-480, 9 → 10: credits gain `reasonCode` and supplements gain `reasonCode`, `appliedGrossMinor` and `creditedMinor`,
 * set only by lowering a fee; every existing row reads as Postgres's defaults do (null, null, 0).
 */
function addReductionFields(snapshot: StoredSnapshot): StoredSnapshot {
  const credits = snapshot.maps.credits as Map<string, Omit<CreditRecord, 'reasonCode'>>;
  const supps = snapshot.maps.supps as Map<string, Omit<SupplementRecord, 'reasonCode' | 'appliedGrossMinor' | 'creditedMinor'>>;
  return {
    ...snapshot,
    maps: {
      ...snapshot.maps,
      credits: new Map([...credits].map(([id, c]) => [id, { ...c, reasonCode: null }])),
      supps: new Map([...supps].map(([id, s]) => [id, { ...s, reasonCode: null, appliedGrossMinor: null, creditedMinor: 0n }])),
    },
  };
}

/** MUT-481, 10 → 11: payments gain `receiptNumber`. A device's payments are a person's own, which never carry one: null. */
function addReceiptNumber(snapshot: StoredSnapshot): StoredSnapshot {
  const pays = snapshot.maps.pays as Map<string, Omit<PaymentRecord, 'receiptNumber'>>;
  return { ...snapshot, maps: { ...snapshot.maps, pays: new Map([...pays].map(([id, p]) => [id, { ...p, receiptNumber: null }])) } };
}

/**
 * MUT-479, 11 → 12: fee proposals gain `agreementType` and `draft`. As the SQL backfill: CONTINGENCY where contingency
 * terms are set, else FIXED; no proposal had a draft.
 */
function addProposalDrafts(snapshot: StoredSnapshot): StoredSnapshot {
  const props = snapshot.maps.props as Map<string, Omit<FeeProposalRecord, 'agreementType' | 'draft'>>;
  return {
    ...snapshot,
    maps: { ...snapshot.maps, props: new Map([...props].map(([id, p]) => [id, { ...p, agreementType: p.commissionRateBasisPoints === null ? 'FIXED' : 'CONTINGENCY', draft: null }])) },
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
  { from: 4, to: 5, migrate: addTrialPrompt },
  { from: 5, to: 6, migrate: addVendors },
  { from: 6, to: 7, migrate: addClosure },
  { from: 7, to: 8, migrate: addOperatorAt },
  { from: 8, to: 9, migrate: addReceivableNumbers },
  { from: 9, to: 10, migrate: addReductionFields },
  { from: 10, to: 11, migrate: addReceiptNumber },
  { from: 11, to: 12, migrate: addProposalDrafts },
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
