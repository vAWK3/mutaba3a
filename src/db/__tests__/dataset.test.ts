import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../database';
import { getRepositories } from '../provider';

// MUT-47 (T5): whole-database operations behind the `dataset` slot. Each
// behaviour here was in a component or page before; the tests pin what it did
// so the move cannot change it. The one intended change (D8) is that a legacy
// import is all or nothing.

const now = '2024-01-01T00:00:00.000Z';
const dataset = () => getRepositories().base.dataset;

async function clearAll() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(clearAll);
afterEach(async () => {
  vi.restoreAllMocks();
  await clearAll();
});

describe('dataset.importLegacyV1', () => {
  const file = {
    clients: [{ id: 'c-new', name: 'New Co', createdAt: now, updatedAt: now }],
    projects: [{ id: 'p-new', name: 'New Project', clientId: 'c-new', createdAt: now, updatedAt: now }],
    categories: [{ id: 'cat-new', name: 'Cat', kind: 'income' }],
    transactions: [
      { id: 't-new', kind: 'income', status: 'paid', amountMinor: 100, currency: 'USD', occurredAt: '2024-01-01', createdAt: now, updatedAt: now },
    ],
    fxRates: [{ id: 'fx-new', baseCurrency: 'USD', quoteCurrency: 'ILS', rate: 3.7, effectiveDate: '2024-01-01', createdAt: now }],
    settings: [{ id: 'default', enabledCurrencies: ['USD'], defaultCurrency: 'USD' }],
  };

  beforeEach(async () => {
    await db.clients.add({ id: 'c-old', name: 'Old Co', createdAt: now, updatedAt: now });
    await db.transactions.add({ id: 't-old', kind: 'income', status: 'unpaid', amountMinor: 5, currency: 'USD', occurredAt: '2023-01-01', createdAt: now, updatedAt: now });
  });

  it('replaces the six legacy tables with the file and counts transactions', async () => {
    const result = await dataset().importLegacyV1(file);

    expect(result).toEqual({ transactions: 1 });
    expect((await db.clients.toArray()).map((c) => c.id)).toEqual(['c-new']);
    expect((await db.projects.toArray()).map((p) => p.id)).toEqual(['p-new']);
    expect((await db.categories.toArray()).map((c) => c.id)).toEqual(['cat-new']);
    expect((await db.transactions.toArray()).map((t) => t.id)).toEqual(['t-new']);
    expect((await db.fxRates.toArray()).map((f) => f.id)).toEqual(['fx-new']);
    expect(await db.settings.count()).toBe(1);
  });

  it('changes nothing when a write fails part-way (D8: all or nothing)', async () => {
    const broken = {
      ...file,
      // Same primary key twice: bulkAdd rejects after clients and projects were written.
      transactions: [file.transactions[0], file.transactions[0]],
    };

    await expect(dataset().importLegacyV1(broken)).rejects.toThrow();

    expect((await db.clients.toArray()).map((c) => c.id)).toEqual(['c-old']);
    expect((await db.transactions.toArray()).map((t) => t.id)).toEqual(['t-old']);
    expect(await db.projects.count()).toBe(0);
  });
});

describe('dataset.exportCoreTables and wipeAllData', () => {
  beforeEach(async () => {
    await db.clients.add({ id: 'c-1', name: 'A', archivedAt: now, createdAt: now, updatedAt: now });
    await db.projects.add({ id: 'p-1', name: 'P', createdAt: now, updatedAt: now });
    await db.transactions.bulkAdd([
      { id: 't-live', kind: 'income', status: 'paid', amountMinor: 1, currency: 'USD', occurredAt: '2024-01-01', createdAt: now, updatedAt: now },
      { id: 't-gone', kind: 'income', status: 'paid', amountMinor: 1, currency: 'USD', occurredAt: '2024-01-01', deletedAt: now, createdAt: now, updatedAt: now },
    ]);
    await db.categories.add({ id: 'cat-1', name: 'C', kind: 'income' });
    await db.fxRates.add({ id: 'fx-1', baseCurrency: 'USD', quoteCurrency: 'ILS', rate: 3.7, effectiveDate: '2024-01-01', createdAt: now });
    await db.businessProfiles.add({ id: 'bp-1', name: 'Biz', isDefault: true, defaultCurrency: 'USD', createdAt: now, updatedAt: now });
    await db.expenses.add({ id: 'e-1', profileId: 'bp-1', amountMinor: 1, currency: 'USD', occurredAt: '2024-01-01', createdAt: now, updatedAt: now });
  });

  it('exports raw client, project and transaction rows, archived and deleted included', async () => {
    const { clients, projects, transactions } = await dataset().exportCoreTables();

    expect(clients.map((c) => c.id)).toEqual(['c-1']);
    expect(projects.map((p) => p.id)).toEqual(['p-1']);
    expect(transactions.map((t) => t.id).sort()).toEqual(['t-gone', 't-live']);
  });

  it('empties every table except settings (MUT-164)', async () => {
    await db.settings.add({ id: 'default', enabledCurrencies: ['USD'], defaultCurrency: 'USD', defaultBaseCurrency: 'USD' });
    // One row in every table, so a table added later can't be missed silently.
    for (const table of db.tables) {
      if (table.name === 'settings') continue;
      if ((await table.count()) === 0) await table.put({ id: `${table.name}-1` });
    }

    await dataset().wipeAllData();

    const leftovers = [];
    for (const table of db.tables) {
      if (table.name !== 'settings' && (await table.count()) > 0) leftovers.push(table.name);
    }
    expect(leftovers).toEqual([]);
  });

  it('keeps the settings preferences but turns the optional areas back off (MUT-164)', async () => {
    await db.settings.add({
      id: 'default',
      enabledCurrencies: ['USD', 'ILS'],
      defaultCurrency: 'ILS',
      defaultBaseCurrency: 'USD',
      lastBackupAt: now,
      features: { expenses: true, projects: true },
      featureNotice: ['expenses'],
      malafatSuggestions: { off: true },
    });

    await dataset().wipeAllData();

    const settings = await db.settings.get('default');
    expect(settings).toMatchObject({
      enabledCurrencies: ['USD', 'ILS'],
      defaultCurrency: 'ILS',
      defaultBaseCurrency: 'USD',
      lastBackupAt: now,
      malafatSuggestions: { off: true },
      features: {},
      featureNotice: [],
    });
  });
});

describe('dataset.csvValidationContext', () => {
  it('lists every client and project name across all businesses', async () => {
    await db.clients.bulkAdd([
      { id: 'c-1', name: 'One', profileId: 'bp-1', createdAt: now, updatedAt: now },
      { id: 'c-2', name: 'Two', profileId: 'bp-2', archivedAt: now, createdAt: now, updatedAt: now },
    ]);
    await db.projects.add({ id: 'p-1', name: 'Proj', createdAt: now, updatedAt: now });

    const context = await dataset().csvValidationContext();

    expect(context.clientNames.sort()).toEqual(['One', 'Two']);
    expect(context.projectNames).toEqual(['Proj']);
  });
});
