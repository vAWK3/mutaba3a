import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../db/database';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import { reconcileFeaturesWithData, reconcileFeaturesAfterDataLoad, PROBED_TABLES } from '../features';
import type { Settings } from '../../../types';

const now = new Date().toISOString();

async function clearAll() {
  await Promise.all([...PROBED_TABLES.map((name) => db.table(name).clear()), db.settings.clear()]);
}

const readRow = () => db.settings.get('default') as Promise<Settings | undefined>;

describe('reconcileFeaturesWithData', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  it('enables the areas that have data and records a notice', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, features: {} });
    await db.projects.add({ id: 'p1', name: 'P', createdAt: now, updatedAt: now } as never);

    const result = await reconcileFeaturesWithData(db);

    expect(result).toEqual(['projects']);
    const row = await readRow();
    expect(row?.features?.projects).toBe(true);
    expect(row?.features?.invoices).toBe(false);
    expect(row?.featureNotice).toEqual(['projects']);
    expect(row?.enabledCurrencies).toEqual(DEFAULT_SETTINGS.enabledCurrencies);
  });

  it('is enabling-only: a user-set off is overridden when data for that area is present', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, features: { expenses: false } });
    await db.expenses.add({ id: 'e1', createdAt: now, updatedAt: now } as never);

    expect(await reconcileFeaturesWithData(db)).toEqual(['expenses']);
    expect((await readRow())?.features?.expenses).toBe(true);
  });

  it('never turns a flag off and writes nothing when nothing is new', async () => {
    const stored: Settings = {
      ...DEFAULT_SETTINGS,
      features: { projects: true, planning: true },
    };
    await db.settings.put(stored);
    await db.projects.add({ id: 'p1', name: 'P', createdAt: now, updatedAt: now } as never);

    expect(await reconcileFeaturesWithData(db)).toEqual([]);
    expect(await readRow()).toEqual(stored);
  });

  it('merges a newly enabled key into a pending notice, ordered and without duplicates', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, features: { invoices: true }, featureNotice: ['invoices'] });
    await db.documents.add({ id: 'd1', createdAt: now, updatedAt: now } as never);
    await db.projects.add({ id: 'p1', name: 'P', createdAt: now, updatedAt: now } as never);

    expect(await reconcileFeaturesWithData(db)).toEqual(['projects']);
    expect((await readRow())?.featureNotice).toEqual(['invoices', 'projects']);
  });

  it('creates the settings row from the defaults when none exists', async () => {
    await db.vendors.add({ id: 'v1', createdAt: now } as never);

    expect(await reconcileFeaturesWithData(db)).toEqual(['expenses']);
    const row = await readRow();
    expect(row?.id).toBe('default');
    expect(row?.defaultCurrency).toBe(DEFAULT_SETTINGS.defaultCurrency);
    expect(row?.features?.expenses).toBe(true);
    expect(row?.featureNotice).toEqual(['expenses']);
  });

  it('does nothing on an empty database with no settings row', async () => {
    expect(await reconcileFeaturesWithData(db)).toEqual([]);
    expect(await readRow()).toBeUndefined();
  });

  it('after a data load, swallows and logs a failure instead of failing the import', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      table: () => {
        throw new Error('boom');
      },
    };

    expect(await reconcileFeaturesAfterDataLoad('import', broken)).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('import');
    error.mockRestore();
  });

  it('after a data load, enables exactly like the plain reconcile when nothing fails', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: now, updatedAt: now } as never);
    expect(await reconcileFeaturesAfterDataLoad('restore', db)).toEqual(['projects']);
    expect((await readRow())?.features?.projects).toBe(true);
  });

  it('works inside a Dexie transaction', async () => {
    await db.retainerAgreements.add({ id: 'r1', createdAt: now } as never);
    const result = await db.transaction('rw', [...PROBED_TABLES, 'settings'], (tx) =>
      reconcileFeaturesWithData(tx),
    );
    expect(result).toEqual(['retainers']);
    expect((await readRow())?.features?.retainers).toBe(true);
  });
});
