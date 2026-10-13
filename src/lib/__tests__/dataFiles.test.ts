import { describe, it, expect } from 'vitest';
import { classifyDataFile, setPendingImport, takePendingImport } from '../dataFiles';

/**
 * MUT-88 (ADR-072): Settings › Your data has one Restore. It reads the file
 * once and decides where it goes: a full backup replaces everything (after a
 * confirmation), a one-business export or a CSV opens the import page.
 */

const fullBackup = {
  version: 21,
  timestamp: '2026-09-01T08:00:00.000Z',
  tables: { clients: [{ id: 'c1' }, { id: 'c2' }], transactions: [{ id: 't1' }], settings: [] },
};

describe('classifyDataFile', () => {
  it('recognises a full backup and reports its date, app version and record count', () => {
    expect(classifyDataFile('mutaba3a-backup-v21.json', JSON.stringify(fullBackup))).toEqual({
      kind: 'fullBackup',
      timestamp: '2026-09-01T08:00:00.000Z',
      version: 21,
      records: 3,
    });
  });

  it('recognises a one-business export (v2)', () => {
    const file = { version: 2, profileId: 'p', profile: { id: 'p', name: 'Studio' }, clients: [] };
    expect(classifyDataFile('studio.json', JSON.stringify(file))).toEqual({ kind: 'businessExport' });
  });

  it('treats a legacy export with rows as a business export', () => {
    expect(classifyDataFile('old.json', JSON.stringify({ clients: [{ id: 'c1' }] }))).toEqual({ kind: 'businessExport' });
  });

  it('sends a CSV to the import page without parsing it', () => {
    expect(classifyDataFile('ledger.CSV', 'type,name\nclient,Acme')).toEqual({ kind: 'csv' });
  });

  it('calls anything else unknown: broken JSON, an empty export, a non-object', () => {
    expect(classifyDataFile('x.json', '{not json')).toEqual({ kind: 'unknown' });
    expect(classifyDataFile('x.json', JSON.stringify({ clients: [] }))).toEqual({ kind: 'unknown' });
    expect(classifyDataFile('x.json', '42')).toEqual({ kind: 'unknown' });
    expect(classifyDataFile('x.txt', 'hello')).toEqual({ kind: 'unknown' });
  });

  it('does not mistake a backup without a version for one', () => {
    expect(classifyDataFile('x.json', JSON.stringify({ tables: {} }))).toEqual({ kind: 'unknown' });
  });
});

describe('pending import handoff', () => {
  it('hands one file to the import page exactly once', () => {
    const file = new File(['a,b'], 'ledger.csv');
    setPendingImport(file);

    expect(takePendingImport()).toBe(file);
    expect(takePendingImport()).toBeUndefined();
  });

  it('keeps only the latest file', () => {
    const first = new File(['1'], 'one.csv');
    const second = new File(['2'], 'two.csv');
    setPendingImport(first);
    setPendingImport(second);

    expect(takePendingImport()).toBe(second);
  });
});
