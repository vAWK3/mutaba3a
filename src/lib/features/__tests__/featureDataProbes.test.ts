import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db/database';
import { detectFeaturesWithData, PROBED_TABLES } from '../features';

const now = new Date().toISOString();

async function clearProbedTables() {
  await Promise.all(PROBED_TABLES.map((name) => db.table(name).clear()));
}

describe('detectFeaturesWithData', () => {
  beforeEach(clearProbedTables);
  afterEach(clearProbedTables);

  it('returns nothing for an empty database', async () => {
    expect(await detectFeaturesWithData(db)).toEqual([]);
  });

  it('reports invoices when a live document exists', async () => {
    await db.documents.add({ id: 'd1', createdAt: now, updatedAt: now } as never);
    expect(await detectFeaturesWithData(db)).toEqual(['invoices']);
  });

  it('ignores soft-deleted rows', async () => {
    await db.documents.add({ id: 'd1', deletedAt: now, createdAt: now, updatedAt: now } as never);
    await db.expenses.add({ id: 'e1', deletedAt: now, createdAt: now, updatedAt: now } as never);
    await db.projects.add({ id: 'p1', name: 'P', createdAt: now, updatedAt: now } as never);
    expect(await detectFeaturesWithData(db)).toEqual(['projects']);
  });

  it('reports tables without soft delete when any row exists, in FEATURE_KEYS order', async () => {
    await db.plans.add({ id: 'pl1', createdAt: now } as never);
    await db.retainerAgreements.add({ id: 'r1', createdAt: now } as never);
    expect(await detectFeaturesWithData(db)).toEqual(['retainers', 'planning']);
  });

  it('counts a vendor as expenses data (vendors belong to the expenses module)', async () => {
    await db.vendors.add({ id: 'v1', createdAt: now } as never);
    expect(await detectFeaturesWithData(db)).toEqual(['expenses']);
  });

  it('counts an archived project as data (projects have no soft delete)', async () => {
    await db.projects.add({ id: 'p1', name: 'P', archivedAt: now, createdAt: now, updatedAt: now } as never);
    expect(await detectFeaturesWithData(db)).toEqual(['projects']);
  });

  it('never reports insights, which owns no data', async () => {
    await db.documents.add({ id: 'd1', createdAt: now, updatedAt: now } as never);
    await db.projects.add({ id: 'p1', name: 'P', createdAt: now, updatedAt: now } as never);
    await db.expenses.add({ id: 'e1', createdAt: now, updatedAt: now } as never);
    await db.vendors.add({ id: 'v1', createdAt: now } as never);
    await db.plans.add({ id: 'pl1', createdAt: now } as never);
    await db.retainerAgreements.add({ id: 'r1', createdAt: now } as never);
    const found = await detectFeaturesWithData(db);
    expect(found).not.toContain('insights');
    expect(found).toHaveLength(5);
  });

  it('gives the same answer through a Dexie transaction as through db', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: now, updatedAt: now } as never);
    const viaDb = await detectFeaturesWithData(db);
    const viaTx = await db.transaction('r', PROBED_TABLES, (tx) => detectFeaturesWithData(tx));
    expect(viaTx).toEqual(viaDb);
    expect(viaTx).toEqual(['projects']);
  });
});
