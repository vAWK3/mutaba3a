import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import { db } from '../../../db/database';
import { settingsRepo } from '../../../db/repository';
import { DEFAULT_FEATURES, reconcileFeaturesWithData } from '../features';
import { readFeatureFlags } from '../useFeatures';
import { requireFeature } from '../routeGuard';

const now = new Date().toISOString();

async function clearAll() {
  await Promise.all([db.documents.clear(), db.documentSequences.clear(), db.retainerAgreements.clear(), db.settings.clear()]);
}

describe('gating never touches documents, sequences or retainers (MUT-13)', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  it('flipping invoices and retainers off → on → off leaves every row intact', async () => {
    await db.documents.bulkAdd([
      { id: 'd1', number: 'INV-0001', createdAt: now, updatedAt: now },
      { id: 'd2', number: 'INV-0002', createdAt: now, updatedAt: now },
    ] as never[]);
    await db.documentSequences.add({ id: 'seq-1', businessProfileId: 'p1', type: 'invoice', nextNumber: 3 } as never);
    await db.retainerAgreements.add({ id: 'r1', status: 'active', createdAt: now } as never);
    const sequenceBefore = await db.documentSequences.get('seq-1');

    for (const on of [true, false, true, false]) {
      await settingsRepo.update({ features: { ...DEFAULT_FEATURES, invoices: on, retainers: on } });
      const flags = await readFeatureFlags();
      expect(flags.invoices).toBe(on);
      expect(flags.retainers).toBe(on);
    }

    expect(await db.documents.count()).toBe(2);
    expect(await db.retainerAgreements.count()).toBe(1);
    expect(await db.documentSequences.get('seq-1')).toEqual(sequenceBefore);
  });

  it('a database with a document resolves invoices on and the guard admits /documents (auto-enable end to end)', async () => {
    await db.documents.add({ id: 'd1', number: 'INV-0001', createdAt: now, updatedAt: now } as never);

    // Before reconcile: off, guard bounces
    let bounced: unknown;
    try {
      await requireFeature('invoices')();
    } catch (error) {
      bounced = error;
    }
    expect(isRedirect(bounced)).toBe(true);

    // The v20 upgrade / restore / import path
    expect(await reconcileFeaturesWithData(db)).toEqual(['invoices']);
    expect((await readFeatureFlags()).invoices).toBe(true);
    await expect(requireFeature('invoices')()).resolves.toBeUndefined();
  });
});
