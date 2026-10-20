import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/src/app.js';
import { MemoryAttachmentStorage } from '../../../../server/src/attachments/storage.js';
import { generateDeviceSessionToken, sessionDigest } from '../../../../server/src/auth/sessions.js';
import { SlidingWindowRateLimiter } from '../../../../server/src/rate-limit.js';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { ApiError } from '../../api/client';
import type { ExportProgress, RecordsExportTransport } from '../../session/recordsExportContract';
import { exportHostedRecords } from '../hostedExport';
import { LOCAL_PEPPER } from '../mintLocalSession.js';
import { decodeRecordsArchive } from '../recordsArchive.js';

/**
 * MUT-325 AC2: a large profile — 10,000 entries and 200 receipts — exports
 * through the real routes without timing out, shows its progress to the end,
 * and can be cancelled partway. The server reads it 500 rows a query and each
 * receipt is its own short request, so no one request carries the profile.
 */

const NOW = new Date('2026-10-20T09:00:00.000Z');
const ENTRIES = 10_000;
const RECEIPTS = 200;
/** Generous: the run takes a few seconds; this only catches an export that has stopped scaling. */
const BUDGET_MS = 60_000;

type Logger = Parameters<typeof createApp>[0]['logger'];
function silentLogger(): Logger {
  const noop = () => undefined;
  const logger: Record<string, unknown> = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop };
  logger.child = () => logger;
  return logger as unknown as Logger;
}

async function largeAccount() {
  const store = new MemoryLedgerStore();
  const storage = new MemoryAttachmentStorage();
  const app = createApp({
    store, logger: silentLogger(), rateLimiter: new SlidingWindowRateLimiter(1_000_000), adminToken: 'parity-admin-token-with-at-least-32-characters',
    keyEnvironment: 'test', version: '0.1.0-test', now: () => NOW, attachments: storage,
    sessions: { pepper: LOCAL_PEPPER, idleMinutes: 60, absoluteHours: 24, secureCookie: true, trustedProxyHops: 1 },
  });
  const { user } = await store.users.create({ email: 'big@studio.ps', displayName: 'Big', passwordHash: null, locale: 'en', personal: { name: 'Personal', slug: 'big', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: NOW });
  const org = (await store.memberships.listByUser(user.id))[0]!.organizationId;
  const customer = await store.customers.create({ organizationId: org, name: 'Client', email: null, phone: null, notes: null }, NOW);
  for (let i = 0; i < ENTRIES / 2; i++) {
    await store.receivables.createAdjustment({ organizationId: org, customerId: customer.id, projectId: null, currency: 'ILS', netMinor: 1_000n, vatMinor: 0n, grossMinor: 1_000n, vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: `Owed ${i}`, dueDate: '2026-10-15', postingDate: '2026-10-01', postedAt: NOW, createdByUserId: user.id, requestId: null }, NOW);
  }
  for (let i = 0; i < ENTRIES / 2; i++) {
    const expense = await store.expenses.create({ organizationId: org, occurredOn: '2026-10-02', amountMinor: 500n, currency: 'ILS', title: `Expense ${i}`, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, NOW);
    if (i < RECEIPTS) {
      const bytes = new Uint8Array(2_048).fill(i % 256);
      const receipt = await store.expenseReceipts.create({ organizationId: org, expenseId: expense.id, filename: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.byteLength, uploadedByUserId: user.id, requestId: null }, NOW);
      const key = `org/${org}/expense-receipts/${receipt.id}`;
      await store.expenseReceipts.setKey(org, receipt.id, key);
      await store.expenseReceipts.complete(org, receipt.id, NOW);
      storage.put(key, { sizeBytes: bytes.byteLength, contentType: 'image/jpeg' }, bytes);
    }
  }
  const token = generateDeviceSessionToken();
  const far = new Date(NOW.getTime() + 24 * 3600 * 1000);
  await store.sessions.create({ userId: user.id, tokenDigest: sessionDigest(LOCAL_PEPPER, token), kind: 'device', at: NOW, idleExpiresAt: far, absoluteExpiresAt: far, userAgent: null });

  const get = async (path: string, profileId: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const res = await app.fetch(new Request(`http://local${path}`, { headers: { Authorization: `Bearer ${token}`, 'X-Mutaba3a-Profile': profileId }, signal }));
    if (!res.ok) throw new ApiError(res.status, 'UNKNOWN', `HTTP ${res.status}`);
    return res;
  };
  const transport: RecordsExportTransport = {
    records: (profileId, signal) => get('/v1/records-export', profileId, signal),
    receipt: (profileId, receiptId, signal) => get(`/v1/records-export/receipts/${receiptId}`, profileId, signal),
  };
  return { org, transport };
}

describe('a large profile export (MUT-325 AC2)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('exports 10,000 entries and 200 receipts, its progress reaching the end', { timeout: BUDGET_MS * 2 }, async () => {
    const { org, transport } = await largeAccount();
    const seen: ExportProgress[] = [];
    const started = Date.now();

    const { blob, missingReceipts } = await exportHostedRecords({ profileIds: [org], transport, onProgress: (p) => seen.push(p) });

    expect(Date.now() - started).toBeLessThan(BUDGET_MS);
    expect(missingReceipts).toBe(0);
    const receipts = seen.filter((p) => p.phase === 'receipts');
    expect(receipts.at(-1)).toEqual({ phase: 'receipts', done: RECEIPTS, total: RECEIPTS });
    expect(receipts.map((p) => p.done)).toEqual([...receipts.map((p) => p.done)].sort((a, b) => a - b));
    const decoded = await decodeRecordsArchive(blob);
    expect(decoded.snapshot.maps.recs.size + decoded.snapshot.maps.exps.size).toBe(ENTRIES);
    expect(decoded.missing).toEqual([]);
  });

  it('cancels partway through the receipts and returns nothing', { timeout: BUDGET_MS * 2 }, async () => {
    const { org, transport } = await largeAccount();
    const controller = new AbortController();
    let lastDone = 0;

    const run = exportHostedRecords({
      profileIds: [org], transport, signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'receipts') lastDone = p.done;
        if (p.phase === 'receipts' && p.done === 50) controller.abort();
      },
    });

    await expect(run).rejects.toThrow();
    expect(lastDone).toBeLessThan(RECEIPTS);
  });
});
