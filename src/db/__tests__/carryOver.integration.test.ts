import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../database';
import { serializeAllTables } from '../backup';
import { importCsvRows } from '../csvImport';
import { seedDemoData } from '../../demo';
import { parseFreeAppBackupValue } from '../../hosted/local/carryOver/freeAppBackup';
import { prepareFromBackup } from '../../hosted/local/carryOver';
import { snapshotTotals, totalsByCurrency } from '../../hosted/local/carryOver/totals';
import { IndexedDbBlobStore } from '../../hosted/local/blobStore';
import { LocalLock } from '../../hosted/local/locks';
import { IndexedDbPersistence } from '../../hosted/local/persistence';
import { applyRestore } from '../../hosted/local/restore';
import { MemoryLedgerStore } from '../../../server/src/repositories/memory.js';

/**
 * MUT-291 T-I1, the ticket's first acceptance criterion: a real free-app
 * dataset arrives with matching record counts and per-currency totals. The
 * data is made by the free app's own code (the demo seed, and a CSV import
 * with JOD and paid rows), read back with its own `serializeAllTables`,
 * carried, and written into a fresh signed-out portal store with the same
 * `applyRestore` the receiver uses. Both halves share fake-indexeddb, as they
 * would share a browser, under their own database names.
 */

class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

const NOW = new Date('2026-03-20T10:00:00.000Z');
const OPTIONS = { now: () => NOW, timezone: 'Asia/Jerusalem', locale: 'en' as const, labels: { noClient: 'No client', defaultBusiness: 'My business' } };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await Promise.all(db.tables.map((t) => t.clear()));
  Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

async function freeAppData() {
  await seedDemoData({ announceFeatures: false });
  const [profile] = await db.businessProfiles.toArray();
  await importCsvRows(
    [
      { type: 'client', name: 'Amman Studio' },
      { type: 'income', name: 'Logo', client: 'Amman Studio', amount: '5.250', currency: 'JOD', status: 'paid', date: '2026-02-03', paidAt: '2026-02-05' },
      { type: 'income', name: 'Retainer', client: 'Amman Studio', amount: '400', currency: 'USD', status: 'unpaid', date: '2026-02-10' },
      { type: 'conversion', amount: '100', currency: 'USD', toAmount: '365', toCurrency: 'ILS', date: '2026-02-11' },
    ],
    { selectedProfileId: profile!.id, language: 'en' },
  );
  return JSON.parse(JSON.stringify(await serializeAllTables())) as unknown;
}

describe('a real free-app dataset carried to local mode (T-I1)', () => {
  it('arrives with matching counts and per-currency totals', async () => {
    const backup = parseFreeAppBackupValue(await freeAppData());
    // prepareFromBackup throws CarryOverCheckFailed unless every carried row's money matches the records, per profile and currency.
    const prepared = await prepareFromBackup(backup, OPTIONS);

    const liveIncome = backup.tables.transactions.filter((t) => t.kind === 'income' && !t.deletedAt && !t.archivedAt);
    const liveExpenses = backup.tables.expenses.filter((e) => !e.deletedAt).length + backup.tables.transactions.filter((t) => t.kind === 'expense' && !t.deletedAt && !t.archivedAt).length;
    const liveConversions = backup.tables.transactions.filter((t) => t.kind === 'conversion' && !t.deletedAt && !t.archivedAt).length;
    expect(liveIncome.length).toBeGreaterThan(5);
    expect(prepared.report.notCarried.filter((l) => l.code === 'refused' || l.code === 'parent-not-carried')).toEqual([]);
    expect(prepared.counts.businesses).toBe(backup.tables.businessProfiles.length);
    expect(prepared.counts.expenses).toBe(liveExpenses);
    expect(prepared.counts.conversions).toBe(liveConversions);
    const carriedClientNames = new Set([...prepared.snapshot.maps.custs.values()].map((c) => c.name));
    for (const client of backup.tables.clients) expect(carriedClientNames).toContain(client.name);
    expect(prepared.report.jodEntries).toBeGreaterThanOrEqual(1);

    // Written the way the receiver writes it, then read back as this device will next load it.
    const persistence = new IndexedDbPersistence();
    await applyRestore({ lock: new LocalLock(persistence), persistence, store: new MemoryLedgerStore(), blobs: new IndexedDbBlobStore(), now: () => NOW }, prepared.snapshot, prepared.files);
    const loaded = await persistence.load();
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(totalsByCurrency(snapshotTotals(loaded.snapshot.maps))).toEqual(prepared.totals);
    expect(Object.keys(prepared.totals).sort()).toEqual(expect.arrayContaining(['JOD', 'USD']));
  }, 60_000);

  it('carrying the same backup twice leaves the same records (a carry-over replaces, T-I5)', async () => {
    const raw = await freeAppData();
    const first = await prepareFromBackup(parseFreeAppBackupValue(raw), OPTIONS);
    const second = await prepareFromBackup(parseFreeAppBackupValue(raw), OPTIONS);
    const persistence = new IndexedDbPersistence();
    const deps = { lock: new LocalLock(persistence), persistence, store: new MemoryLedgerStore(), blobs: new IndexedDbBlobStore(), now: () => NOW };
    await applyRestore(deps, first.snapshot, first.files);
    await applyRestore(deps, second.snapshot, second.files);
    const loaded = await persistence.load();
    if (loaded.kind !== 'ok') throw new Error('nothing saved');
    expect(totalsByCurrency(snapshotTotals(loaded.snapshot.maps))).toEqual(first.totals);
    expect(loaded.snapshot.maps.exps.size).toBe(first.snapshot.maps.exps.size);
  }, 60_000);
});
