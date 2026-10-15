import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import Dexie from 'dexie';
import { db, MiniCrmDatabase } from '../database';
import { restoreFromBackup } from '../backup';
import { completeMigrationSafety, getLatestBackup } from '../migration-safety';
import { DEFAULT_FEATURES } from '../../lib/features/features';

/**
 * MUT-226 / ADR-082: Financial Planning and the local Retainers area are
 * retired, and the owner chose to drop their data with them. v24 drops the
 * five tables, strips `linkedProjectedIncomeId` from transactions (and its
 * index), and removes the two areas' switches and notices from settings.
 * Every other user record is untouched.
 */

const DROPPED_TABLES = ['plans', 'planAssumptions', 'planScenarios', 'retainerAgreements', 'projectedIncome'] as const;

/** The full schema a v23 build left on disk (v20's stores less v21's eight sync tables). */
const V23_SCHEMA = {
  clients: 'id, name, profileId, createdAt, updatedAt, archivedAt',
  projects: 'id, name, profileId, clientId, field, createdAt, updatedAt, archivedAt',
  transactions:
    'id, kind, status, profileId, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId, linkedProjectedIncomeId, lockedAt, archivedAt, needsReview',
  categories: 'id, kind, name',
  fxRates: 'id, baseCurrency, quoteCurrency, effectiveDate, createdAt, [baseCurrency+quoteCurrency]',
  settings: 'id',
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

const matched = {
  id: 't1', kind: 'income', status: 'paid', profileId: 'bp1', clientId: 'c1', currency: 'USD',
  amountMinor: 50000, receivedAmountMinor: 50000, occurredAt: '2026-09-20', paidAt: '2026-09-25',
  linkedProjectedIncomeId: 'pi1', createdAt: now, updatedAt: now,
};
const { linkedProjectedIncomeId: _dropped, ...matchedAfter } = matched;
void _dropped;

/** A person who used both areas: a matched retainer payment, a plan, and both switches on. */
const USER_ROWS: Record<string, object[]> = {
  businessProfiles: [{ id: 'bp1', name: 'Studio', isDefault: true, createdAt: now }],
  clients: [{ id: 'c1', name: 'Acme', profileId: 'bp1', createdAt: now, updatedAt: now }],
  projects: [{ id: 'pj1', name: 'Site', profileId: 'bp1', clientId: 'c1', createdAt: now, updatedAt: now }],
  transactions: [
    matched,
    {
      id: 't2', kind: 'income', status: 'unpaid', profileId: 'bp1', clientId: 'c1', currency: 'ILS',
      amountMinor: 120000, occurredAt: '2026-09-28', dueDate: '2026-10-15', createdAt: now, updatedAt: now,
    },
  ],
  paymentRecords: [{ id: 'pr1', transactionId: 't1', amountMinor: 50000, paidAt: '2026-09-25', createdAt: now, updatedAt: now }],
  expenses: [{ id: 'e1', profileId: 'bp1', amountMinor: 2500, currency: 'USD', occurredAt: '2026-09-02', createdAt: now, updatedAt: now }],
  settings: [
    {
      id: 'default', enabledCurrencies: ['USD', 'ILS'], defaultCurrency: 'USD',
      features: { ...DEFAULT_FEATURES, expenses: true, planning: true, retainers: true },
      featureNotice: ['retainers', 'expenses', 'planning'],
    },
  ],
};

const RETIRED_ROWS: Record<(typeof DROPPED_TABLES)[number], object[]> = {
  plans: [{ id: 'p1', profileId: 'bp1', name: 'Runway', status: 'active', startMonth: '2026-10', createdAt: now }],
  planAssumptions: [{ id: 'pa1', planId: 'p1', profileId: 'bp1', category: 'revenue', type: 'recurring', confidence: 'likely', startMonth: '2026-10' }],
  planScenarios: [{ id: 'ps1', planId: 'p1', profileId: 'bp1', isDefault: 1 }],
  retainerAgreements: [{ id: 'r1', profileId: 'bp1', clientId: 'c1', status: 'active', currency: 'USD', startDate: '2026-09-01', createdAt: now }],
  projectedIncome: [{ id: 'pi1', profileId: 'bp1', sourceId: 'r1', clientId: 'c1', expectedDate: '2026-09-25', state: 'received', currency: 'USD', periodStart: '2026-09-01', periodEnd: '2026-09-30' }],
};

const KEPT_TABLES = Object.keys(V23_SCHEMA).filter((name) => !(DROPPED_TABLES as readonly string[]).includes(name));

let counter = 0;
const uniqueName = () => `mutaba3a-v24-test-${Date.now()}-${counter++}`;
const opened: Dexie[] = [];

/** Build a database exactly as a v23 build left it, seed it, and return a snapshot of the kept tables. */
async function createV23Database(name: string): Promise<Record<string, unknown[]>> {
  const v23 = new Dexie(name);
  v23.version(23).stores(V23_SCHEMA);
  await v23.open();
  for (const [table, rows] of Object.entries({ ...USER_ROWS, ...RETIRED_ROWS })) {
    await v23.table(table).bulkAdd(rows);
  }
  const snapshot: Record<string, unknown[]> = {};
  for (const table of KEPT_TABLES) snapshot[table] = await v23.table(table).toArray();
  v23.close();
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

describe('Migration v24 — planning and local retainer data is dropped (MUT-226, ADR-082)', () => {
  it('a v23 database holding plans and retainers opens at v24 without an error', async () => {
    const errors = vi.spyOn(console, 'error');
    const name = uniqueName();
    await createV23Database(name);

    const upgraded = await openCurrent(name);

    expect(upgraded.verno).toBe(24);
    expect(errors).not.toHaveBeenCalled();
  });

  it('leaves none of the five tables behind, on disk or in the schema', async () => {
    const name = uniqueName();
    await createV23Database(name);

    const upgraded = await openCurrent(name);

    expect(DROPPED_TABLES.filter((table) => storeNames(upgraded).includes(table))).toEqual([]);
    expect(DROPPED_TABLES.filter((table) => upgraded.tables.some((t) => t.name === table))).toEqual([]);
  });

  it('strips the projected-income link from transactions and drops its index', async () => {
    const name = uniqueName();
    await createV23Database(name);

    const upgraded = await openCurrent(name);

    expect(await upgraded.table('transactions').get('t1')).toEqual(matchedAfter);
    expect(upgraded.table('transactions').schema.indexes.map((i) => i.name)).not.toContain('linkedProjectedIncomeId');
  });

  it('removes the planning and retainers switches and notices, keeping the rest of settings', async () => {
    const name = uniqueName();
    await createV23Database(name);

    const upgraded = await openCurrent(name);

    const settings = await upgraded.table('settings').get('default');
    expect(settings.features).toEqual({ ...DEFAULT_FEATURES, expenses: true });
    expect(settings.features).not.toHaveProperty('planning');
    expect(settings.features).not.toHaveProperty('retainers');
    expect(settings.featureNotice).toEqual(['expenses']);
    expect(settings.enabledCurrencies).toEqual(['USD', 'ILS']);
  });

  it('keeps every other user row exactly as it was', async () => {
    const name = uniqueName();
    const before = await createV23Database(name);

    const upgraded = await openCurrent(name);

    for (const table of KEPT_TABLES.filter((t) => t !== 'transactions' && t !== 'settings')) {
      expect(await upgraded.table(table).toArray(), table).toEqual(before[table]);
    }
    expect(await upgraded.table('transactions').get('t2')).toEqual(before.transactions[1]);
  });

  it('a fresh install is created at v24 and never has the five tables', async () => {
    const fresh = await openCurrent(uniqueName());

    expect(fresh.verno).toBe(24);
    expect(DROPPED_TABLES.filter((table) => storeNames(fresh).includes(table))).toEqual([]);
    expect(storeNames(fresh)).toEqual(expect.arrayContaining(KEPT_TABLES));
  });
});

describe('Restoring a backup saved before v24 (MUT-226)', () => {
  const clearAll = () => Promise.all(db.tables.map((table) => table.clear()));
  beforeEach(clearAll);
  afterEach(clearAll);

  it('restores the kept tables and skips the dropped ones it carries', async () => {
    const { settings: _settings, ...rows } = USER_ROWS;
    void _settings;
    const oldBackup = { version: 23, timestamp: now, tables: { ...rows, ...RETIRED_ROWS } };
    const keptCount = Object.values(rows).reduce((sum, r) => sum + r.length, 0);

    const result = await restoreFromBackup(JSON.stringify(oldBackup));

    expect(result).toEqual({ recordsRestored: keptCount, backupVersion: 23 });
    expect(await db.clients.toArray()).toEqual(USER_ROWS.clients);
    expect(await db.paymentRecords.toArray()).toEqual(USER_ROWS.paymentRecords);
    expect(DROPPED_TABLES.filter((table) => db.tables.some((t) => t.name === table))).toEqual([]);
  });
});

describe('Migration safety after v23 → v24 (MUT-226)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('mutaba3a_backup');
  });

  it('validates the upgrade and writes a post-migration backup without the dropped tables', async () => {
    localStorage.setItem('mutaba3a_last_known_version', '23');

    const result = await completeMigrationSafety();

    expect(result?.success).toBe(true);
    const backup = await getLatestBackup();
    expect(backup?.version).toBe(24);
    expect(DROPPED_TABLES.filter((table) => table in (backup?.tables ?? {}))).toEqual([]);
  });
});
