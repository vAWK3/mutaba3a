import { describe, expect, it, vi } from 'vitest';
import { HOSTED_EXPORT_ORIGIN, recordsFileChunks } from '../../../../server/src/records-file/codec.js';
import { profileExportPages } from '../../../../server/src/records-file/export.js';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { ApiError } from '../../api/client';
import type { ExportProgress, RecordsExportTransport } from '../../session/recordsExportContract';
import { exportHostedRecords } from '../hostedExport';
import { decodeRecordsArchive } from '../recordsArchive';

/**
 * MUT-325: the signed-in Download builds the local-mode records file from the
 * server's per-profile files and receipt bytes. These run it over a fake
 * transport serving what GET /v1/records-export would.
 */

const AT = new Date('2026-10-01T08:00:00.000Z');
const PNG = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7) % 256));

async function hosted() {
  const store = new MemoryLedgerStore();
  const { user } = await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'en', personal: { name: 'Personal', slug: 'p', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
  const firm = await store.organizations.create({ name: 'Haddad Law', slug: 'haddad', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  await store.memberships.grant(user.id, firm.id, AT);
  const personal = (await store.memberships.listByUser(user.id)).find((m) => m.organizationId !== firm.id)!.organizationId;
  const bytes = new Map<string, Uint8Array>();
  for (const [org, n] of [[personal, 3], [firm.id, 2]] as const) {
    await store.customers.create({ organizationId: org, name: `Client of ${org.slice(0, 4)}`, email: null, phone: null, notes: null }, AT);
    for (let i = 0; i < n; i++) {
      const expense = await store.expenses.create({ organizationId: org, occurredOn: '2026-10-02', amountMinor: 100n, currency: 'ILS', title: `E${i}`, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, AT);
      const file = PNG(10 + i);
      const receipt = await store.expenseReceipts.create({ organizationId: org, expenseId: expense.id, filename: 'r.png', mimeType: 'image/png', sizeBytes: file.byteLength, uploadedByUserId: user.id, requestId: null }, AT);
      await store.expenseReceipts.setKey(org, receipt.id, `org/${org}/expense-receipts/${receipt.id}`);
      await store.expenseReceipts.complete(org, receipt.id, AT);
      bytes.set(receipt.id, file);
    }
  }
  await store.inboxEntries.create({ userId: user.id, kind: 'EXPENSE', amountMinor: 1n, currency: 'ILS', occurredOn: '2026-10-01', note: 'once', captureSource: null }, AT);

  async function recordsText(profileId: string): Promise<string> {
    const organization = (await store.organizations.getById(profileId))!;
    const membership = (await store.memberships.find(user.id, profileId))!;
    let text = '';
    for await (const chunk of recordsFileChunks({ formatVersion: 1, savedAt: AT, origin: HOSTED_EXPORT_ORIGIN }, profileExportPages(store, { person: user, organization, membership }))) text += chunk;
    return text;
  }

  const transport: RecordsExportTransport & { calls: string[] } = {
    calls: [],
    async records(profileId) {
      this.calls.push(`records:${profileId}`);
      return new Response(await recordsText(profileId));
    },
    async receipt(profileId, receiptId) {
      this.calls.push(`receipt:${receiptId}`);
      return new Response(bytes.get(receiptId)!);
    },
  };
  return { store, user, personal, firm: firm.id, bytes, transport };
}

const noSleep = () => Promise.resolve();

describe('exportHostedRecords', () => {
  it('puts every chosen profile, one person and every receipt file in one records file local mode restores', async () => {
    const { personal, firm, bytes, transport, user } = await hosted();

    const { blob, missingReceipts } = await exportHostedRecords({ profileIds: [personal, firm], transport, sleep: noSleep });

    expect(missingReceipts).toBe(0);
    const decoded = await decodeRecordsArchive(blob);
    expect([...decoded.snapshot.maps.orgs.keys()].sort()).toEqual([personal, firm].sort());
    expect([...decoded.snapshot.maps.people.keys()]).toEqual([user.id]);
    expect([...decoded.snapshot.maps.inbox.values()].map((e) => e.note)).toEqual(['once']);
    expect(decoded.missing).toEqual([]);
    const { files } = await decoded.readFiles();
    expect(files).toHaveLength(5);
    for (const receipt of decoded.snapshot.maps.expReceipts.values()) {
      expect(new Uint8Array(files.find((f) => f.key === receipt.storageKey)!.bytes)).toEqual(bytes.get(receipt.id));
    }
  });

  it('labels the file as an export from the account', async () => {
    const { personal, transport } = await hosted();
    const { blob } = await exportHostedRecords({ profileIds: [personal], transport, sleep: noSleep });
    const JSZip = (await import('jszip')).default;
    const records = JSON.parse(await (await JSZip.loadAsync(blob)).file('records.json')!.async('string')) as { origin: string };
    expect(records.origin).toBe(HOSTED_EXPORT_ORIGIN);
  });

  it('reports progress: each profile, then each receipt, up to the total', async () => {
    const { personal, firm, transport } = await hosted();
    const seen: ExportProgress[] = [];

    await exportHostedRecords({ profileIds: [personal, firm], transport, sleep: noSleep, onProgress: (p) => seen.push(p) });

    expect(seen.filter((p) => p.phase === 'records').map((p) => `${p.done}/${p.total}`)).toEqual(['0/2', '1/2']);
    const receipts = seen.filter((p) => p.phase === 'receipts').map((p) => p.done);
    expect(receipts).toEqual([0, 1, 2, 3, 4, 5]);
    expect(seen.at(-1)).toMatchObject({ phase: 'receipts', done: 5, total: 5 });
  });

  it('waits out a rate limit and carries on, rather than losing the file', async () => {
    const { personal, transport } = await hosted();
    const real = transport.receipt.bind(transport);
    let refused = false;
    transport.receipt = async (profileId, receiptId, signal) => {
      if (!refused) {
        refused = true;
        throw new ApiError(429, 'RATE_LIMITED', 'slow down', null, null, 7);
      }
      return real(profileId, receiptId, signal);
    };
    const sleep = vi.fn(noSleep);

    const { missingReceipts } = await exportHostedRecords({ profileIds: [personal], transport, sleep });

    expect(missingReceipts).toBe(0);
    expect(sleep).toHaveBeenCalledWith(7000, undefined);
  });

  it('leaves out a file that fails twice or comes back the wrong size, and says how many', async () => {
    const { personal, transport, bytes } = await hosted();
    let n = 0;
    transport.receipt = async (_profileId, receiptId) => {
      n += 1;
      if (n <= 2) throw new ApiError(0, 'NETWORK', 'offline'); // the first receipt, twice
      if (n === 3) return new Response(new Uint8Array([1, 2])); // the second, too short
      return new Response(bytes.get(receiptId)!);
    };

    const { blob, missingReceipts } = await exportHostedRecords({ profileIds: [personal], transport, sleep: noSleep, concurrency: 1 });

    expect(missingReceipts).toBe(2);
    expect((await decodeRecordsArchive(blob)).missing).toHaveLength(2);
  });

  it('stops when cancelled: the in-flight request is aborted and nothing is returned', async () => {
    const { personal, transport } = await hosted();
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    transport.receipt = (_p, _r, signal) => {
      seenSignal = signal;
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    };

    await expect(exportHostedRecords({ profileIds: [personal], transport, sleep: noSleep, signal: controller.signal })).rejects.toThrow(/abort/i);
    expect(seenSignal?.aborted).toBe(true);
  });

  it('refuses a cut-off records file instead of saving it', async () => {
    const { personal, transport } = await hosted();
    transport.records = async () => new Response('{"kind":"mutaba3a-local-records","formatVersion":1,"savedAt":"2026-10-01T08:00:00.000Z","maps":{"orgs":{"$map":[');

    await expect(exportHostedRecords({ profileIds: [personal], transport, sleep: noSleep })).rejects.toMatchObject({ reason: 'not-a-records-file' });
  });
});
