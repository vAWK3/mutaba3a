import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../db/database';
import { settingsRepo } from '../../db/repository';
import { DEMO_ID_PREFIX } from '../constants';
import {
  countSessionAdditions,
  enterVisitorSample,
  leaveVisitorSample,
  readSampleSession,
} from '../visitorSample';

async function clearDatabase() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

async function demoRowCount(): Promise<number> {
  const counts = await Promise.all(
    db.tables.map((table) =>
      table.schema.primKey.name === 'id'
        ? table.where('id').startsWith(DEMO_ID_PREFIX).count()
        : Promise.resolve(0)
    )
  );
  return counts.reduce((sum, n) => sum + n, 0);
}

const LONG_AGO = '2024-01-01T00:00:00.000Z';

beforeEach(async () => {
  await clearDatabase();
  localStorage.clear();
});

describe('enterVisitorSample', () => {
  it('seeds the sample into an empty database and opens on the business with clients owing', async () => {
    const result = await enterVisitorSample();

    expect(result.kind).toBe('sample');
    if (result.kind !== 'sample') return;
    expect(result.profileId.startsWith(DEMO_ID_PREFIX)).toBe(true);

    const owing = await db.transactions
      .filter((tx) => tx.profileId === result.profileId && tx.kind === 'income' && tx.status === 'unpaid')
      .count();
    expect(owing).toBeGreaterThan(0);
    expect(readSampleSession()?.profileId).toBe(result.profileId);
  });

  it('does not seed twice: a second visit reuses the sample', async () => {
    const first = await enterVisitorSample();
    const rows = await demoRowCount();

    const second = await enterVisitorSample();

    expect(second).toEqual(first);
    expect(await demoRowCount()).toBe(rows);
  });

  it("never touches a database that holds the person's own data", async () => {
    await db.clients.add({
      id: 'client-real',
      name: 'Real Client',
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
    } as never);

    const result = await enterVisitorSample();

    expect(result).toEqual({ kind: 'own-data' });
    expect(await demoRowCount()).toBe(0);
    expect(readSampleSession()).toBeNull();
  });

  it('switches areas on quietly, and remembers which ones', async () => {
    await enterVisitorSample();

    const settings = await settingsRepo.get();
    expect(settings.featureNotice ?? []).toEqual([]);
    const session = readSampleSession();
    expect(session?.enabledFeatures.length).toBeGreaterThan(0);
    for (const key of session!.enabledFeatures) {
      expect(settings.features[key]).toBe(true);
    }
  });

  it('seeds again when the session outlived its sample rows', async () => {
    await enterVisitorSample();
    await Promise.all(db.tables.map((table) => table.clear()));

    const result = await enterVisitorSample();

    expect(result.kind).toBe('sample');
    expect(await demoRowCount()).toBeGreaterThan(0);
  });
});

describe('leaveVisitorSample', () => {
  it('removes the sample and what was added during the session, and switches the areas back off', async () => {
    const entry = await enterVisitorSample();
    if (entry.kind !== 'sample') throw new Error('expected a sample');
    const enabled = readSampleSession()!.enabledFeatures;

    // The visitor looks around and adds a client and an entry to the sample business.
    const now = new Date().toISOString();
    await db.clients.add({ id: 'visitor-client', name: 'Tried it', createdAt: now, updatedAt: now } as never);
    await db.transactions.add({
      id: 'visitor-tx',
      kind: 'income',
      status: 'unpaid',
      title: 'Trying it out',
      amountMinor: 1000,
      currency: 'ILS',
      occurredAt: now.slice(0, 10),
      profileId: entry.profileId,
      clientId: 'visitor-client',
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.paymentRecords.add({
      id: 'visitor-payment',
      transactionId: 'visitor-tx',
      amountMinor: 500,
      paidAt: now,
      createdAt: now,
      updatedAt: now,
    } as never);

    await leaveVisitorSample();

    expect(await demoRowCount()).toBe(0);
    expect(await db.clients.get('visitor-client')).toBeUndefined();
    expect(await db.transactions.get('visitor-tx')).toBeUndefined();
    expect(await db.paymentRecords.get('visitor-payment')).toBeUndefined();
    expect(await db.businessProfiles.count()).toBe(0);

    const settings = await settingsRepo.get();
    for (const key of enabled) expect(settings.features[key]).toBe(false);
    expect(readSampleSession()).toBeNull();
  });

  it('keeps rows that are older than the session, such as a restored backup', async () => {
    await enterVisitorSample();
    await db.clients.add({ id: 'restored-client', name: 'From a backup', createdAt: LONG_AGO, updatedAt: LONG_AGO } as never);

    await leaveVisitorSample();

    expect(await db.clients.get('restored-client')).toBeDefined();
  });
});

describe('countSessionAdditions', () => {
  it('counts only what the visitor added during the session', async () => {
    await enterVisitorSample();
    expect(await countSessionAdditions()).toBe(0);

    const now = new Date().toISOString();
    await db.clients.add({ id: 'visitor-client', name: 'Tried it', createdAt: now, updatedAt: now } as never);
    await db.clients.add({ id: 'restored-client', name: 'Old', createdAt: LONG_AGO, updatedAt: LONG_AGO } as never);

    expect(await countSessionAdditions()).toBe(1);
  });
});
