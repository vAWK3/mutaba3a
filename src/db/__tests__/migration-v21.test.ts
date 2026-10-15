import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import Dexie from 'dexie';
import { db, MiniCrmDatabase } from '../database';
import { restoreFromBackup } from '../backup';
import { completeMigrationSafety, getLatestBackup } from '../migration-safety';
import { DEFAULT_FEATURES } from '../../lib/features/features';

/**
 * MUT-73 / ADR-053: device sync is retired and v21 drops its eight
 * bookkeeping tables. ADR-053 overrides ADR-029 for these tables only: the
 * rows are sync state (device identity, peers, the op-log, LWW clocks,
 * conflict snapshots no shipped screen could open), and every user record
 * lives in a table v21 does not touch.
 */

const SYNC_TABLES = [
  'localDevice',
  'trustedPeers',
  'opLog',
  'peerCursors',
  'entityFieldMeta',
  'moneyEventVersions',
  'conflictQueue',
  'syncHistory',
] as const;

/** The full schema a v20 build left on disk (v16's stores plus v17–v19's changes). */
const V20_SCHEMA = {
  clients: 'id, name, profileId, createdAt, updatedAt, archivedAt',
  projects: 'id, name, profileId, clientId, field, createdAt, updatedAt, archivedAt',
  transactions:
    'id, kind, status, profileId, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId, linkedProjectedIncomeId, lockedAt, archivedAt, needsReview',
  categories: 'id, kind, name',
  fxRates: 'id, baseCurrency, quoteCurrency, effectiveDate, createdAt, [baseCurrency+quoteCurrency]',
  settings: 'id',
  localDevice: 'id',
  trustedPeers: 'id, pairingCode, status, pairedAt',
  opLog: 'id, hlc, [entityType+entityId], createdBy, appliedAt',
  peerCursors: 'peerId',
  entityFieldMeta: '[entityType+entityId+field], hlc',
  moneyEventVersions: 'id, transactionId, hlc, isActive, createdBy',
  conflictQueue: 'id, entityType, entityId, status, detectedAt',
  syncHistory: 'id, peerId, method, status, completedAt',
  businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
  documents:
    'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt, [businessProfileId+type+number], lockedAt, archivedAt',
  documentSequences: 'id, [businessProfileId+documentType]',
  expenses:
    'id, profileId, clientId, projectId, categoryId, vendorId, currency, occurredAt, recurringRuleId, recurringOccurrenceId, createdAt, deletedAt',
  recurringRules:
    'id, profileId, categoryId, vendorId, frequency, dayOfMonth, monthOfYear, scope, startDate, isPaused, createdAt, deletedAt',
  recurringOccurrences:
    'id, ruleId, profileId, expectedDate, status, fulfilledExpenseId, snoozeUntil, [ruleId+expectedDate], [profileId+status]',
  receipts: 'id, profileId, expenseId, vendorId, monthKey, createdAt',
  expenseCategories: 'id, profileId, name',
  vendors: 'id, profileId, canonicalName, createdAt',
  monthCloseStatuses: 'id, profileId, monthKey, isClosed',
  retainerAgreements: 'id, profileId, clientId, projectId, status, currency, startDate, createdAt, archivedAt',
  projectedIncome: 'id, profileId, sourceId, clientId, expectedDate, state, currency, [sourceId+periodStart+periodEnd]',
  engagements:
    'id, profileId, clientId, projectId, type, category, status, primaryLanguage, createdAt, updatedAt, archivedAt',
  engagementVersions: 'id, engagementId, versionNumber, status, createdAt',
  plans: 'id, profileId, status, startMonth, createdAt, archivedAt',
  planAssumptions: 'id, planId, profileId, category, type, confidence, startMonth, scenarioId, [planId+category]',
  planScenarios: 'id, planId, profileId, isDefault, [planId+isDefault]',
  paymentRecords: 'id, transactionId, paidAt, deletedAt',
};

const now = '2026-10-01T09:00:00.000Z';

/** What a person has: a profile, a client, paid and owed income, a payment, an expense. */
const USER_ROWS: Record<string, object[]> = {
  businessProfiles: [{ id: 'bp1', name: 'Studio', isDefault: true, createdAt: now }],
  clients: [{ id: 'c1', name: 'Acme', profileId: 'bp1', createdAt: now, updatedAt: now }],
  projects: [{ id: 'pj1', name: 'Site', profileId: 'bp1', clientId: 'c1', createdAt: now, updatedAt: now }],
  transactions: [
    {
      id: 't1', kind: 'income', status: 'paid', profileId: 'bp1', clientId: 'c1', currency: 'USD',
      amountMinor: 50000, receivedAmountMinor: 50000, occurredAt: '2026-09-20', paidAt: '2026-09-25',
      createdAt: now, updatedAt: now,
    },
    {
      id: 't2', kind: 'income', status: 'unpaid', profileId: 'bp1', clientId: 'c1', currency: 'ILS',
      amountMinor: 120000, receivedAmountMinor: 40000, occurredAt: '2026-09-28', dueDate: '2026-10-15',
      createdAt: now, updatedAt: now,
    },
  ],
  paymentRecords: [
    { id: 'pr1', transactionId: 't1', amountMinor: 50000, paidAt: '2026-09-25', createdAt: now, updatedAt: now },
    { id: 'pr2', transactionId: 't2', amountMinor: 40000, paidAt: '2026-09-30', createdAt: now, updatedAt: now },
  ],
  expenses: [
    { id: 'e1', profileId: 'bp1', amountMinor: 2500, currency: 'USD', occurredAt: '2026-09-02', createdAt: now, updatedAt: now },
  ],
  settings: [
    {
      id: 'default', enabledCurrencies: ['USD', 'ILS'], defaultCurrency: 'USD',
      features: { ...DEFAULT_FEATURES, expenses: true },
    },
  ],
};

/** A device that synced: its identity, a paired phone, the op-log and every bit of sync bookkeeping. */
const SYNC_ROWS: Record<(typeof SYNC_TABLES)[number], object[]> = {
  localDevice: [{ id: 'dev-laptop', name: 'Laptop', type: 'web', publicKey: '', privateKey: '', createdAt: now }],
  trustedPeers: [
    { id: 'dev-phone', name: 'Phone', pairingCode: '123456', status: 'active', pairedAt: now, token: 'bearer-secret' },
  ],
  opLog: [
    { id: 'op1', hlc: '0001', entityType: 'client', entityId: 'c1', opType: 'create', value: { id: 'c1' }, createdBy: 'dev-laptop', createdAt: now, appliedAt: now },
    { id: 'op2', hlc: '0002', entityType: 'transaction', entityId: 't1', opType: 'mark_paid', value: '2026-09-25', createdBy: 'dev-laptop', createdAt: now, appliedAt: now },
    // received from the phone, never applied (MUT-55): the record exists only on the phone
    { id: 'op3', hlc: '0003', entityType: 'paymentRecord', entityId: 'pr-phone', opType: 'create', value: { id: 'pr-phone' }, createdBy: 'dev-phone', createdAt: now, appliedAt: now },
  ],
  peerCursors: [{ peerId: 'dev-phone', lastHlc: '0003' }],
  entityFieldMeta: [{ entityType: 'client', entityId: 'c1', field: 'name', hlc: '0001', updatedBy: 'dev-laptop' }],
  moneyEventVersions: [
    { id: 'v1', transactionId: 't2', hlc: '0002', isActive: false, createdBy: 'dev-phone', data: { id: 't2', amountMinor: 99900 } },
  ],
  conflictQueue: [{ id: 'cf1', entityType: 'transaction', entityId: 't2', status: 'open', detectedAt: now }],
  syncHistory: [{ id: 'h1', peerId: 'dev-phone', method: 'bundle', status: 'completed', completedAt: now }],
};

/** v24 (MUT-226) later drops the planning and local retainer tables; they are not v21's concern. */
const DROPPED_BY_V24 = ['plans', 'planAssumptions', 'planScenarios', 'retainerAgreements', 'projectedIncome'];

const USER_TABLES = Object.keys(V20_SCHEMA).filter(
  (name) => !(SYNC_TABLES as readonly string[]).includes(name) && !DROPPED_BY_V24.includes(name)
);

let counter = 0;
const uniqueName = () => `mutaba3a-v21-test-${Date.now()}-${counter++}`;
const opened: Dexie[] = [];

/** Build a database exactly as a v20 build left it, seed it, and return a snapshot of its user tables. */
async function createV20Database(name: string): Promise<Record<string, unknown[]>> {
  const v20 = new Dexie(name);
  v20.version(20).stores(V20_SCHEMA);
  await v20.open();
  expect(v20.verno).toBe(20);
  for (const [table, rows] of Object.entries({ ...USER_ROWS, ...SYNC_ROWS })) {
    await v20.table(table).bulkAdd(rows);
  }
  const snapshot: Record<string, unknown[]> = {};
  for (const table of USER_TABLES) snapshot[table] = await v20.table(table).toArray();
  v20.close();
  return snapshot;
}

async function openCurrent(name: string): Promise<MiniCrmDatabase> {
  const current = new MiniCrmDatabase(name);
  opened.push(current);
  await current.open();
  return current;
}

const storeNames = (d: Dexie) => [...d.backendDB().objectStoreNames];

afterEach(async () => {
  for (const d of opened.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
  vi.restoreAllMocks();
});

describe('Migration v21 — device sync tables are dropped (MUT-73, ADR-053)', () => {
  it('a v20 database with op-log rows and a paired device opens at v21 without an error', async () => {
    const errors = vi.spyOn(console, 'error');
    const name = uniqueName();
    await createV20Database(name);

    const upgraded = await openCurrent(name);

    expect(upgraded.verno).toBe(24);
    expect(errors).not.toHaveBeenCalled();
  });

  it('leaves none of the eight sync tables behind, on disk or in the schema', async () => {
    const name = uniqueName();
    await createV20Database(name);

    const upgraded = await openCurrent(name);

    expect(SYNC_TABLES.filter((table) => storeNames(upgraded).includes(table))).toEqual([]);
    expect(SYNC_TABLES.filter((table) => upgraded.tables.some((t) => t.name === table))).toEqual([]);
    expect((upgraded as unknown as Record<string, unknown>).opLog).toBeUndefined();
  });

  it('keeps every user row in every other table exactly as it was', async () => {
    const name = uniqueName();
    const before = await createV20Database(name);

    const upgraded = await openCurrent(name);

    for (const table of USER_TABLES) {
      expect(await upgraded.table(table).toArray(), table).toEqual(before[table]);
    }
  });

  it('a fresh install is created at v21 and never has the sync tables', async () => {
    const fresh = await openCurrent(uniqueName());

    expect(fresh.verno).toBe(24);
    expect(SYNC_TABLES.filter((table) => storeNames(fresh).includes(table))).toEqual([]);
    expect(storeNames(fresh)).toEqual(expect.arrayContaining(USER_TABLES));
  });

  it('the app database is past v21 (now v24: MUT-88, MUT-60, MUT-226)', () => {
    expect(db.verno).toBe(24);
  });
});

describe('Restoring a backup saved before the upgrade (MUT-73)', () => {
  const clearAll = () => Promise.all(db.tables.map((table) => table.clear()));
  beforeEach(clearAll);
  afterEach(clearAll);

  it('restores the user rows and skips the sync tables it carries', async () => {
    // What serializeAllTables() wrote on a v20 build: every table, sync ones included.
    const oldBackup = { version: 20, timestamp: now, tables: { ...USER_ROWS, ...SYNC_ROWS } };
    const userRowCount = Object.values(USER_ROWS).reduce((sum, rows) => sum + rows.length, 0);

    const result = await restoreFromBackup(JSON.stringify(oldBackup));

    expect(result).toEqual({ recordsRestored: userRowCount, backupVersion: 20 });
    expect(await db.transactions.toArray()).toEqual(USER_ROWS.transactions);
    expect(await db.paymentRecords.toArray()).toEqual(USER_ROWS.paymentRecords);
    expect(await db.clients.toArray()).toEqual(USER_ROWS.clients);
    expect(SYNC_TABLES.filter((table) => db.tables.some((t) => t.name === table))).toEqual([]);
  });
});

describe('Migration safety after v20 → v21 (MUT-73)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('mutaba3a_backup');
  });

  it('validates the upgrade and writes a post-migration backup with no sync tables', async () => {
    localStorage.setItem('mutaba3a_last_known_version', '20');

    const result = await completeMigrationSafety();

    expect(result?.success).toBe(true);
    const backup = await getLatestBackup();
    expect(backup?.version).toBe(24);
    expect(SYNC_TABLES.filter((table) => table in (backup?.tables ?? {}))).toEqual([]);
  });
});
