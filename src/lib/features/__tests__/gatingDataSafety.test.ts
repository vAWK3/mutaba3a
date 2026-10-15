import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import { db } from '../../../db/database';
import { settingsRepo } from '../../../db/repository';
import { DEFAULT_FEATURES, reconcileFeaturesWithData } from '../features';
import { readFeatureFlags } from '../useFeatures';
import { requireFeature } from '../routeGuard';

const now = new Date().toISOString();

async function clearAll() {
  await Promise.all([db.documents.clear(), db.documentSequences.clear(), db.projects.clear(), db.settings.clear()]);
}

describe('gating never touches documents, sequences or area rows (MUT-13, MUT-145; retainers retired, MUT-226)', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  it('flipping projects off → on → off leaves retained documents, sequences and projects intact', async () => {
    await db.documents.bulkAdd([
      { id: 'd1', number: 'INV-0001', createdAt: now, updatedAt: now },
      { id: 'd2', number: 'INV-0002', createdAt: now, updatedAt: now },
    ] as never[]);
    await db.documentSequences.add({ id: 'seq-1', businessProfileId: 'p1', type: 'invoice', nextNumber: 3 } as never);
    await db.projects.add({ id: 'p1', name: 'Site', createdAt: now, updatedAt: now } as never);
    const sequenceBefore = await db.documentSequences.get('seq-1');

    for (const on of [true, false, true, false]) {
      await settingsRepo.update({ features: { ...DEFAULT_FEATURES, projects: on } });
      expect((await readFeatureFlags()).projects).toBe(on);
    }

    expect(await db.documents.count()).toBe(2);
    expect(await db.projects.count()).toBe(1);
    expect(await db.documentSequences.get('seq-1')).toEqual(sequenceBefore);
  });

  it('a stored invoices switch and retained documents enable nothing and lose nothing (MUT-145)', async () => {
    await db.documents.add({ id: 'd1', number: 'INV-0001', createdAt: now, updatedAt: now } as never);
    await settingsRepo.update({ features: { invoices: true } as never });

    expect(await reconcileFeaturesWithData(db)).toEqual([]);
    expect(await readFeatureFlags()).not.toHaveProperty('invoices');
    expect(await db.documents.count()).toBe(1);
  });

  it('a database with a project resolves projects on and the guard admits (auto-enable end to end)', async () => {
    await db.projects.add({ id: 'p1', name: 'Site', createdAt: now, updatedAt: now } as never);

    let bounced: unknown;
    try {
      await requireFeature('projects')();
    } catch (error) {
      bounced = error;
    }
    expect(isRedirect(bounced)).toBe(true);

    expect(await reconcileFeaturesWithData(db)).toEqual(['projects']);
    expect((await readFeatureFlags()).projects).toBe(true);
    await expect(requireFeature('projects')()).resolves.toBeUndefined();
  });
});
