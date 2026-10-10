import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../database';
import { serializeAllTables, restoreFromBackup } from '../backup';
import type { Engagement, EngagementVersion } from '../retained/engagementSchema';

/**
 * MUT-10 / MUT-11 guardrail.
 *
 * The engagements UI was deleted but its Dexie tables are deliberately
 * retained so no user's local database is rewritten or truncated. These tests
 * fail if a later change drops the tables or stops backing them up, which is
 * the only way the removal could turn into data loss.
 */

const engagement: Engagement = {
  id: 'eng-1',
  profileId: 'profile-1',
  clientId: 'client-1',
  type: 'task',
  category: 'design',
  primaryLanguage: 'en',
  status: 'final',
  currentVersionId: 'engv-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const engagementVersion: EngagementVersion = {
  id: 'engv-1',
  engagementId: 'eng-1',
  versionNumber: 1,
  status: 'final',
  snapshot: { profileName: 'Acme', clientName: 'Globex', deliverables: [{ id: 'd1' }] },
  createdAt: '2026-01-02T00:00:00.000Z',
};

describe('retained engagement schema', () => {
  beforeEach(async () => {
    await db.engagements.clear();
    await db.engagementVersions.clear();
  });

  it('keeps the engagements tables in the Dexie schema', () => {
    const tableNames = db.tables.map((t) => t.name);
    expect(tableNames).toContain('engagements');
    expect(tableNames).toContain('engagementVersions');
  });

  it('stores and reads back pre-existing engagement rows', async () => {
    await db.engagements.add(engagement);
    await db.engagementVersions.add(engagementVersion);

    expect(await db.engagements.get('eng-1')).toEqual(engagement);
    expect(await db.engagementVersions.get('engv-1')).toEqual(engagementVersion);
  });

  it('includes engagement rows in a full backup', async () => {
    await db.engagements.add(engagement);
    await db.engagementVersions.add(engagementVersion);

    const backup = await serializeAllTables();

    expect(backup.tables.engagements).toEqual([engagement]);
    expect(backup.tables.engagementVersions).toEqual([engagementVersion]);
  });

  it('round-trips engagement rows through backup and restore, snapshot intact', async () => {
    await db.engagements.add(engagement);
    await db.engagementVersions.add(engagementVersion);

    const backup = await serializeAllTables();
    await db.engagements.clear();
    await db.engagementVersions.clear();

    await restoreFromBackup(JSON.stringify(backup));

    expect(await db.engagements.get('eng-1')).toEqual(engagement);
    const restoredVersion = await db.engagementVersions.get('engv-1');
    expect(restoredVersion?.snapshot).toEqual(engagementVersion.snapshot);
  });
});
