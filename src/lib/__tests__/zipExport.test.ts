import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../db/database';
import { buildAllReceiptsArchive, exportAllProfilesReceiptsAsZip } from '../zipExport';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

const now = '2026-10-01T00:00:00.000Z';
const png = btoa('not-really-a-png');

async function clearAll() {
  await Promise.all([db.receipts.clear(), db.businessProfiles.clear()]);
}

describe('receipts archive (MUT-14)', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  it('builds one folder per profile and month and keeps every file', async () => {
    await db.businessProfiles.bulkAdd([
      { id: 'p1', name: 'Studio A', isDefault: true, createdAt: now },
      { id: 'p2', name: 'Side: Gig', isDefault: false, createdAt: now, archivedAt: now },
    ] as never[]);
    await db.receipts.bulkAdd([
      { id: 'r1', profileId: 'p1', monthKey: '2026-09', fileName: 'taxi.png', mimeType: 'image/png', sizeBytes: 3, data: png, createdAt: now, updatedAt: now },
      { id: 'r2', profileId: 'p1', monthKey: '2026-09', fileName: 'taxi.png', mimeType: 'image/png', sizeBytes: 3, data: png, createdAt: now, updatedAt: now },
      { id: 'r3', profileId: 'p1', monthKey: '2026-10', fileName: 'lunch.jpg', mimeType: 'image/jpeg', sizeBytes: 3, data: png, createdAt: now, updatedAt: now },
      { id: 'r4', profileId: 'p2', monthKey: '2026-10', fileName: 'hosting.pdf', mimeType: 'application/pdf', sizeBytes: 3, data: png, createdAt: now, updatedAt: now },
    ] as never[]);

    const { zip, count } = await buildAllReceiptsArchive();

    expect(count).toBe(4);
    const files = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
    expect(files).toEqual([
      'Side_ Gig/2026-10/hosting.pdf',
      'Studio A/2026-09/taxi.png',
      'Studio A/2026-09/taxi_1.png',
      'Studio A/2026-10/lunch.jpg',
    ]);
    const content = await zip.file('Studio A/2026-10/lunch.jpg')!.async('string');
    expect(content).toBe('not-really-a-png');
  });

  it('falls back to the profile id when the profile row is gone', async () => {
    await db.receipts.add({ id: 'r1', profileId: 'ghost', monthKey: '2026-10', fileName: 'a.png', mimeType: 'image/png', sizeBytes: 3, data: png, createdAt: now, updatedAt: now } as never);
    const { zip } = await buildAllReceiptsArchive();
    expect(Object.keys(zip.files)).toContain('ghost/2026-10/a.png');
  });

  it('refuses to download an empty archive and otherwise returns the count', async () => {
    await expect(exportAllProfilesReceiptsAsZip()).rejects.toThrow(/No receipts/);

    await db.businessProfiles.add({ id: 'p1', name: 'Studio', isDefault: true, createdAt: now } as never);
    await db.receipts.add({ id: 'r1', profileId: 'p1', monthKey: '2026-10', fileName: 'a.png', mimeType: 'image/png', sizeBytes: 3, data: png, createdAt: now, updatedAt: now } as never);
    const { saveAs } = await import('file-saver');
    await expect(exportAllProfilesReceiptsAsZip()).resolves.toBe(1);
    expect(saveAs).toHaveBeenCalledTimes(1);
  });
});
