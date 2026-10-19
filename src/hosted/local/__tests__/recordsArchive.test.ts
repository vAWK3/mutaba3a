import { IDBFactory } from 'fake-indexeddb';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { isRecordsFileRefused } from '../../session/localBackendContract.js';
import { readBytes } from '../blobStore.js';
import { decodeRecordsArchive, encodeRecordsArchive } from '../recordsArchive.js';
import { encodeRecordsFile } from '../recordsFile.js';
import { deviceWithReceipt, PDF } from './helpers/device.js';

/**
 * MUT-287 eng review R2 (D3): "Download my records" is a zip holding
 * records.json (the MUT-286 records file, unchanged) and one binary entry per
 * receipt file, so a large backup has no text-size ceiling. Restore still
 * reads a MUT-286 .json file.
 */
describe('records archive', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('is a zip of records.json plus each receipt file as its own binary entry', async () => {
    const { blobs, key, snapshot } = await deviceWithReceipt();

    const archive = await encodeRecordsArchive(snapshot, blobs);
    const zip = await JSZip.loadAsync(await readBytes(archive));

    expect(archive.type).toBe('application/zip');
    expect(Object.keys(zip.files).filter((name) => !zip.files[name]!.dir).sort()).toEqual(['receipts/' + key, 'records.json'].sort());
    expect(await zip.file(`receipts/${key}`)!.async('string')).toBe(PDF);
    expect(JSON.parse(await zip.file('records.json')!.async('string')).kind).toBe('mutaba3a-local-records');
  });

  it('round-trips the records and every receipt file, typed from its receipt', async () => {
    const { blobs, key, snapshot } = await deviceWithReceipt();

    const decoded = await decodeRecordsArchive(await encodeRecordsArchive(snapshot, blobs));

    expect(decoded.snapshot.maps.exps.size).toBe(1);
    expect(decoded.snapshot.maps.expReceipts.size).toBe(1);
    expect(decoded.files.map((f) => f.key)).toEqual([key]);
    expect(decoded.files[0]!.type).toBe('application/pdf');
    expect(new TextDecoder().decode(decoded.files[0]!.bytes)).toBe(PDF);
    expect(decoded.missing).toEqual([]);
  });

  it('still restores a MUT-286 .json records file, with no receipt files', async () => {
    const { snapshot } = await deviceWithReceipt();
    const legacy = new Blob([encodeRecordsFile(snapshot)], { type: 'application/json' });

    const decoded = await decodeRecordsArchive(legacy);

    expect(decoded.snapshot.maps.exps.size).toBe(1);
    expect(decoded.files).toEqual([]);
  });

  it('restores the records when a receipt file is missing from the zip, and names the gap', async () => {
    const { blobs, key, snapshot } = await deviceWithReceipt();
    const zip = await JSZip.loadAsync(await readBytes(await encodeRecordsArchive(snapshot, blobs)));
    zip.remove(`receipts/${key}`);
    const trimmed = await zip.generateAsync({ type: 'blob' });

    const decoded = await decodeRecordsArchive(trimmed);

    expect(decoded.snapshot.maps.expReceipts.size).toBe(1);
    expect(decoded.files).toEqual([]);
    expect(decoded.missing).toEqual([key]);
  });

  it('ignores a zip entry no receipt names', async () => {
    const { blobs, snapshot } = await deviceWithReceipt();
    const zip = await JSZip.loadAsync(await readBytes(await encodeRecordsArchive(snapshot, blobs)));
    zip.file('receipts/org/x/expense-receipts/stranger', 'not mine');

    const decoded = await decodeRecordsArchive(await zip.generateAsync({ type: 'blob' }));

    expect(decoded.files.map((f) => f.key)).not.toContain('org/x/expense-receipts/stranger');
  });

  it('refuses a damaged zip (an interrupted download) as not a records file', async () => {
    const { blobs, snapshot } = await deviceWithReceipt();
    const bytes = new Uint8Array(await readBytes(await encodeRecordsArchive(snapshot, blobs)));

    const refused = await decodeRecordsArchive(new Blob([bytes.slice(0, Math.floor(bytes.length / 2))])).catch((error: unknown) => error);

    expect(isRecordsFileRefused(refused)).toBe(true);
  });

  it('refuses a zip without records.json, and a file that is neither zip nor records JSON', async () => {
    const empty = new JSZip();
    empty.file('photo.png', 'x');
    const noRecords = await empty.generateAsync({ type: 'blob' });

    const refused = await decodeRecordsArchive(noRecords).catch((error: unknown) => error);
    const garbage = await decodeRecordsArchive(new Blob(['hello'])).catch((error: unknown) => error);

    expect(isRecordsFileRefused(refused)).toBe(true);
    expect(isRecordsFileRefused(garbage)).toBe(true);
  });
});
