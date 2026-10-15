import { describe, it, expect, afterEach } from 'vitest';
import Dexie from 'dexie';
import { db, MiniCrmDatabase } from '../database';
import { DEFAULT_SETTINGS } from '../defaultSettings';
import { DEFAULT_FEATURES } from '../../lib/features/features';
import type { Settings } from '../../types';

const now = new Date().toISOString();

/**
 * A database as a v19 build would have left it: only the tables the v20
 * upgrade reads, with their v19 index strings. Dexie runs the upgrade when
 * `MiniCrmDatabase` later opens the same name at v20.
 */
async function createV19Database(name: string, seed: (v19: Dexie) => Promise<void>) {
  const v19 = new Dexie(name);
  v19.version(19).stores({
    settings: 'id',
    documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt, [businessProfileId+type+number], lockedAt, archivedAt',
    retainerAgreements: 'id, profileId, clientId, projectId, status, currency, startDate, createdAt, archivedAt',
    expenses: 'id, profileId, clientId, projectId, categoryId, vendorId, currency, occurredAt, recurringRuleId, recurringOccurrenceId, createdAt, deletedAt',
    plans: 'id, profileId, status, startMonth, createdAt, archivedAt',
    vendors: 'id, profileId, canonicalName, createdAt',
    projects: 'id, name, profileId, clientId, field, createdAt, updatedAt, archivedAt',
  });
  await v19.open();
  expect(v19.verno).toBe(19);
  await seed(v19);
  v19.close();
}

const opened: MiniCrmDatabase[] = [];
let counter = 0;
const uniqueName = () => `mutaba3a-v20-test-${Date.now()}-${counter++}`;

async function openAtV20(name: string): Promise<MiniCrmDatabase> {
  const upgraded = new MiniCrmDatabase(name);
  await upgraded.open();
  opened.push(upgraded);
  return upgraded;
}

afterEach(async () => {
  for (const d of opened.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

describe('Migration v20 — auto-enable optional areas that have data', () => {
  it('bumps the singleton past v20 without changing the settings index', () => {
    // v21 (MUT-73) and v24 (MUT-226) only drop tables, so the settings index is v20's.
    expect(db.verno).toBe(24);
    expect(db.settings.schema.primKey.name).toBe('id');
    expect(db.settings.schema.indexes).toHaveLength(0);
  });

  it('switches on the areas with live data, records a notice, and keeps the other fields', async () => {
    const name = uniqueName();
    await createV19Database(name, async (v19) => {
      await v19.table('settings').put({
        id: 'default',
        enabledCurrencies: ['USD', 'EUR'],
        defaultCurrency: 'EUR',
        defaultBaseCurrency: 'USD',
      });
      await v19.table('projects').bulkAdd([
        { id: 'p1', name: 'A', createdAt: now, updatedAt: now },
        { id: 'p2', name: 'B', createdAt: now, updatedAt: now },
      ]);
      await v19.table('documents').add({ id: 'd1', createdAt: now, updatedAt: now });
      await v19.table('expenses').add({ id: 'e1', deletedAt: now, createdAt: now, updatedAt: now });
    });

    const upgraded = await openAtV20(name);
    expect(upgraded.verno).toBe(24); // the v20 upgrade runs on the way to the current version

    const row = (await upgraded.settings.get('default')) as Settings;
    // MUT-145: the document row no longer switches anything on (invoices is
    // retired), but it survives the upgrade untouched (ADR-029).
    expect(row.features).toEqual({ ...DEFAULT_FEATURES, projects: true });
    expect(row.featureNotice).toEqual(['projects']);
    expect(await upgraded.table('documents').count()).toBe(1);
    expect(row.enabledCurrencies).toEqual(['USD', 'EUR']);
    expect(row.defaultCurrency).toBe('EUR');
  });

  it('creates the settings row from the defaults when a v19 database had data but no row', async () => {
    const name = uniqueName();
    await createV19Database(name, async (v19) => {
      await v19.table('projects').add({ id: 'p1', name: 'A', createdAt: now, updatedAt: now });
    });

    const upgraded = await openAtV20(name);
    const row = (await upgraded.settings.get('default')) as Settings;
    expect(row.defaultCurrency).toBe(DEFAULT_SETTINGS.defaultCurrency);
    expect(row.enabledCurrencies).toEqual(DEFAULT_SETTINGS.enabledCurrencies);
    expect(row.features).toEqual({ ...DEFAULT_FEATURES, projects: true });
    expect(row.featureNotice).toEqual(['projects']);
  });

  it('leaves the settings row untouched when no optional area has data', async () => {
    const name = uniqueName();
    const stored = {
      id: 'default',
      enabledCurrencies: ['USD', 'ILS'],
      defaultCurrency: 'USD',
      defaultBaseCurrency: 'ILS',
    };
    await createV19Database(name, async (v19) => {
      await v19.table('settings').put(stored);
    });

    const upgraded = await openAtV20(name);
    expect(await upgraded.settings.get('default')).toEqual(stored);
  });

  it('starts a fresh database at v20 with everything off and no notice', async () => {
    const fresh = await openAtV20(uniqueName());
    expect(fresh.verno).toBe(24);
    expect(await fresh.settings.get('default')).toBeUndefined();
    expect(await fresh.settings.count()).toBe(0);
  });
});
