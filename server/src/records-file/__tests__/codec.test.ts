import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore, type LocalSnapshotMaps } from '../../repositories/memory.js';
import { decodeTagged, encodeRecordsFileText, RECORDS_FILE_KIND, SNAPSHOT_FIELDS, writeRecordsFile, type RecordsFilePage } from '../codec.js';

/**
 * MUT-325: the records file's text, shared by the portal's local mode and the
 * hosted export. The streaming writer must produce what the one-shot encoder
 * produces, page by page, so a hosted export reads back exactly like a
 * local download.
 */

const AT = new Date('2026-10-01T08:30:00.000Z');

async function seededMaps(): Promise<LocalSnapshotMaps> {
  const store = new MemoryLedgerStore();
  const org = await store.organizations.create({ name: 'Me', slug: 'me', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  for (const name of ['A', 'B', 'C']) await store.customers.create({ organizationId: org.id, name, email: null, phone: null, notes: null }, AT);
  return store.snapshot().maps;
}

/** Each map in pages of `size`, in SNAPSHOT_FIELDS order: what the export generator yields. */
async function* pagesOf(maps: LocalSnapshotMaps, size: number): AsyncGenerator<RecordsFilePage> {
  for (const field of SNAPSHOT_FIELDS) {
    const entries = [...(maps[field] as Map<string, unknown>)];
    for (let i = 0; i < entries.length; i += size) yield { field, entries: entries.slice(i, i + size) };
  }
}

async function written(pages: AsyncIterable<RecordsFilePage>, header = { formatVersion: 1, savedAt: AT }): Promise<string> {
  const chunks: string[] = [];
  await writeRecordsFile(async (chunk) => void chunks.push(chunk), header, pages);
  return chunks.join('');
}

describe('records file codec', () => {
  it('the streaming writer emits the same JSON as the one-shot encoder, whatever the page size', async () => {
    const maps = await seededMaps();
    const expected = JSON.parse(encodeRecordsFileText({ formatVersion: 1, savedAt: AT }, maps));

    for (const size of [1, 2, 500]) expect(JSON.parse(await written(pagesOf(maps, size)))).toEqual(expected);
  });

  it('writes an empty map for a field no page names, so the file is always whole', async () => {
    const text = await written((async function* () {})());
    const file = JSON.parse(text) as { kind: string; maps: Record<string, unknown> };

    expect(file.kind).toBe(RECORDS_FILE_KIND);
    expect(Object.keys(file.maps)).toEqual([...SNAPSHOT_FIELDS]);
    expect(file.maps.custs).toEqual({ $map: [] });
  });

  it('carries the export origin in the header when given, and nowhere else', async () => {
    const text = await written((async function* () {})(), { formatVersion: 1, savedAt: AT, origin: 'hosted-export' } as never);
    const file = JSON.parse(text) as Record<string, unknown>;

    expect(file.origin).toBe('hosted-export');
    expect(file.savedAt).toBe(AT.toISOString());
  });

  it('refuses pages out of field order: a field written twice would be a corrupt file', async () => {
    const pages = (async function* (): AsyncGenerator<RecordsFilePage> {
      yield { field: 'custs', entries: [] };
      yield { field: 'orgs', entries: [] };
    })();

    await expect(written(pages)).rejects.toThrow(/order/);
  });

  it('Maps, Dates and bigints survive the tags', () => {
    const value = { when: AT, amount: 12_345_678_901_234n, rows: new Map([['k', { at: AT }]]) };
    const decoded = decodeTagged(JSON.parse(encodeRecordsFileText({ formatVersion: 1, savedAt: AT }, { custs: new Map([['x', value]]) } as never)).maps.custs) as Map<string, typeof value>;

    expect(decoded.get('x')).toEqual(value);
  });
});
