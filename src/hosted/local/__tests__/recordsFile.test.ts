import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { LocalRecordsFileRefused } from '../../session/localBackendContract.js';
import { LOCAL_FORMAT_VERSION } from '../migrations/index.js';
import { countRecords, decodeRecordsFile, encodeRecordsFile, RECORDS_FILE_KIND } from '../recordsFile.js';

/** D2's download file (MUT-286): Maps, Dates and bigints come back as themselves; anything else is refused whole. */

async function seededSnapshot() {
  const store = new MemoryLedgerStore();
  const at = new Date('2026-10-01T08:30:00.000Z');
  const org = await store.organizations.create({ name: 'Me', slug: 'me', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const customer = await store.customers.create({ organizationId: org.id, name: 'Client', email: null, phone: null, notes: null }, at);
  await store.receivables.createAdjustment(
    {
      organizationId: org.id, customerId: customer.id, projectId: null, currency: 'JOD', netMinor: 1_234_567_890_123n, vatMinor: 0n,
      grossMinor: 1_234_567_890_123n, vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: 'Big', dueDate: '2026-10-15',
      postingDate: '2026-10-01', postedAt: at, createdByUserId: 'someone', requestId: null,
    },
    at,
  );
  const { maps } = store.snapshot();
  return { formatVersion: LOCAL_FORMAT_VERSION, stateVersion: 7, savedAt: at, maps };
}

function refusal(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof LocalRecordsFileRefused ? error.reason : 'other';
  }
}

describe('records file', () => {
  it('round-trips a snapshot: Maps, Dates and bigints come back as themselves', async () => {
    const snapshot = await seededSnapshot();

    const decoded = decodeRecordsFile(encodeRecordsFile(snapshot));

    expect(decoded.formatVersion).toBe(LOCAL_FORMAT_VERSION);
    expect(decoded.savedAt).toEqual(snapshot.savedAt);
    expect(decoded.maps).toEqual(snapshot.maps);
    const [receivable] = [...decoded.maps.recs.values()];
    expect(receivable?.grossMinor).toBe(1_234_567_890_123n);
    expect(receivable?.postedAt).toBeInstanceOf(Date);
  });

  it('a restored store answers like the one that was downloaded', async () => {
    const snapshot = await seededSnapshot();
    const restored = new MemoryLedgerStore();

    restored.restore(decodeRecordsFile(encodeRecordsFile(snapshot)));

    const [org] = [...snapshot.maps.orgs.values()];
    const page = await restored.customers.list(org!.id, {}, { limit: 10 });
    expect(page.items.map((c) => c.name)).toEqual(['Client']);
  });

  it('counts the person\'s records, not bookkeeping rows', async () => {
    const snapshot = await seededSnapshot();
    expect(countRecords(snapshot.maps)).toBe(2); // one client, one receivable; the organization isn't a record
  });

  it('refuses text that is not JSON, or JSON that is not a records file', () => {
    expect(refusal(() => decodeRecordsFile('not json'))).toBe('not-a-records-file');
    expect(refusal(() => decodeRecordsFile(JSON.stringify({ hello: 'world' })))).toBe('not-a-records-file');
  });

  it('refuses a file missing one of the snapshot maps, rather than half-restoring it', async () => {
    const file = JSON.parse(encodeRecordsFile(await seededSnapshot())) as { maps: Record<string, unknown> };
    delete file.maps.custs;
    expect(refusal(() => decodeRecordsFile(JSON.stringify(file)))).toBe('not-a-records-file');
  });

  it('refuses a file from a newer format', () => {
    const file = { kind: RECORDS_FILE_KIND, formatVersion: LOCAL_FORMAT_VERSION + 1, savedAt: new Date().toISOString(), maps: {} };
    expect(refusal(() => decodeRecordsFile(JSON.stringify(file)))).toBe('too-new');
  });
});
