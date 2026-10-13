import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../database';
import { serializeAllTables, restoreFromBackup } from '../backup';
import type { Document, DocumentSequence } from '../retained/documentSchema';

/**
 * MUT-145 retired document generation. Its tables are retained (ADR-029,
 * eng-review D5): invoices a user issued before the removal must survive,
 * round-trip through backup and restore, and keep every field as written.
 */
const document: Document = {
  id: 'doc-1',
  number: 'INV-0007',
  type: 'invoice',
  status: 'issued',
  businessProfileId: 'p1',
  clientId: 'c1',
  issueDate: '2026-09-01',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
  lockedAt: '2026-09-02T09:00:00.000Z',
  items: [{ name: 'Design sprint', quantity: 1, unitPriceMinor: 50000 }],
  totalMinor: 50000,
  currency: 'USD',
};

const sequence: DocumentSequence = {
  id: 'p1:invoice',
  businessProfileId: 'p1',
  documentType: 'invoice',
  lastNumber: 7,
  prefix: 'INV',
  prefixEnabled: true,
};

describe('retained document schema', () => {
  beforeEach(async () => {
    await Promise.all([db.documents.clear(), db.documentSequences.clear()]);
  });

  it('keeps both tables in the Dexie schema at v22', () => {
    const names = db.tables.map((t) => t.name);
    expect(names).toContain('documents');
    expect(names).toContain('documentSequences');
    expect(db.verno).toBe(22);
  });

  it('stores and reads back pre-existing rows unchanged', async () => {
    await db.documents.add(document);
    await db.documentSequences.add(sequence);
    expect(await db.documents.get(document.id)).toEqual(document);
    expect(await db.documentSequences.get(sequence.id)).toEqual(sequence);
  });

  it('round-trips rows through backup and restore', async () => {
    await db.documents.add(document);
    await db.documentSequences.add(sequence);
    const backup = await serializeAllTables();
    expect(backup.tables.documents).toEqual([document]);
    expect(backup.tables.documentSequences).toEqual([sequence]);

    await Promise.all([db.documents.clear(), db.documentSequences.clear()]);
    await restoreFromBackup(JSON.stringify(backup));
    expect(await db.documents.get(document.id)).toEqual(document);
    expect(await db.documentSequences.get(sequence.id)).toEqual(sequence);
  });
});
