import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/src/app.js';
import { MemoryAttachmentStorage } from '../../../../server/src/attachments/storage.js';
import { generateDeviceSessionToken, sessionDigest } from '../../../../server/src/auth/sessions.js';
import { SlidingWindowRateLimiter } from '../../../../server/src/rate-limit.js';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { ApiError } from '../../api/client';
import type { RecordsExportTransport } from '../../session/recordsExportContract';
import { exportHostedRecords } from '../hostedExport';
import { LocalAttachmentStorage } from '../attachments.js';
import { IndexedDbBlobStore, readBytes } from '../blobStore.js';
import { createLocalApp } from '../createLocalApp.js';
import { LOCAL_PEPPER, mintLocalSession } from '../mintLocalSession.js';
import { decodeRecordsArchive } from '../recordsArchive.js';

/**
 * MUT-325 AC1: a signed-in person's export restores, signed out, into an
 * identical set of records. The hosted side is the real `createApp` over a
 * memory store; the person keeps a personal profile with income, payments,
 * expenses with a receipt file, a trip group and a conversion, and belongs
 * to a Malafat-fed firm. Their export (the portal's own `exportHostedRecords`
 * over the export routes) is restored into a fresh local store, and every
 * read the portal makes is compared, field for field. Ids are kept by the
 * export, so nothing is renumbered. The only differences are the ones the
 * re-homing promises (ADR-156): the firm has no Malafat writer and is the
 * person's own on the device, and the device's person has no email.
 */

const NOW = new Date('2026-10-20T09:00:00.000Z');
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 9, 8, 7, 6, 5, 4, 3, 2]);

type Logger = Parameters<typeof createApp>[0]['logger'];
function silentLogger(): Logger {
  const noop = () => undefined;
  const logger: Record<string, unknown> = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop };
  logger.child = () => logger;
  return logger as unknown as Logger;
}

type FetchLike = { fetch(request: Request): Response | Promise<Response> };

function client(app: FetchLike, token: string) {
  let key = 0;
  return async (method: string, path: string, profileId: string | null, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(profileId ? { 'X-Mutaba3a-Profile': profileId } : {}), ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method === 'POST') headers['Idempotency-Key'] = `export-parity-${++key}`;
    return app.fetch(new Request(`http://local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  };
}

async function hostedAccount() {
  const store = new MemoryLedgerStore();
  const storage = new MemoryAttachmentStorage();
  const app = createApp({
    store, logger: silentLogger(), rateLimiter: new SlidingWindowRateLimiter(1_000_000), adminToken: 'parity-admin-token-with-at-least-32-characters',
    keyEnvironment: 'test', version: '0.1.0-test', now: () => NOW, attachments: storage,
    sessions: { pepper: LOCAL_PEPPER, idleMinutes: 60, absoluteHours: 24, secureCookie: true, trustedProxyHops: 1 },
  });
  const { user } = await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana Saleh', passwordHash: 'argon2-hash', locale: 'en', personal: { name: 'Personal', slug: 'personal-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: NOW });
  const personal = (await store.memberships.listByUser(user.id))[0]!.organizationId;
  const token = generateDeviceSessionToken();
  const far = new Date(NOW.getTime() + 24 * 3600 * 1000);
  await store.sessions.create({ userId: user.id, tokenDigest: sessionDigest(LOCAL_PEPPER, token), kind: 'device', at: NOW, idleExpiresAt: far, absoluteExpiresAt: far, userAgent: null });

  // A Malafat-fed firm the person belongs to: its income is Malafat's, read-only to them.
  const firm = await store.organizations.create({ name: 'Haddad Law', slug: 'haddad-law', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  await store.memberships.grant(user.id, firm.id, NOW);
  await store.integrations.connect({ organizationId: firm.id, provider: 'MALAFAT', externalTenantId: 'tenant-1', displayName: 'Haddad Law', connectedByApiKeyId: 'key-1', at: NOW });
  const client1 = await store.customers.create({ organizationId: firm.id, name: 'Nablus Trading', email: null, phone: null, notes: null }, NOW);
  await store.externalReferences.link({ organizationId: firm.id, provider: 'MALAFAT', externalId: 'mal-c-1', entityType: 'CUSTOMER', entityId: client1.id }, NOW);
  const owed = await store.receivables.createAdjustment({ organizationId: firm.id, customerId: client1.id, projectId: null, currency: 'ILS', netMinor: 500_000n, vatMinor: 0n, grossMinor: 500_000n, vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: 'Retainer', dueDate: '2026-10-01', postingDate: '2026-09-01', postedAt: NOW, createdByUserId: null, requestId: null }, NOW);
  await store.payments.create({ organizationId: firm.id, customerId: client1.id, projectId: null, currency: 'ILS', amountMinor: 200_000n, receivedOn: '2026-10-05', method: 'BANK', reference: 'TR-1', notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'MALAFAT', captureSource: null, allocations: [{ receivableId: owed.id, amountMinor: 200_000n }] } as never, NOW);

  const call = client(app, token);
  const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
  // The personal profile, through the routes the portal uses.
  const customer = await json(await call('POST', '/v1/customers', personal, { name: 'Ramallah Bakery' }));
  const income = await json(await call('POST', '/v1/income', personal, { kind: 'owed', amount: '1000.00', currency: 'ILS', occurredOn: '2026-09-01', customerId: customer.id, title: 'Logo', dueDate: '2026-09-15' }));
  await call('POST', `/v1/receivables/${String(income.id)}/settle`, personal, { amount: '400.00', paidAt: '2026-10-01', method: 'BANK' });
  await call('POST', '/v1/income', personal, { kind: 'received', amount: '250.50', currency: 'USD', occurredOn: '2026-10-10' });
  const categories = (await json(await call('GET', '/v1/expense-categories', personal))) as { items: Array<{ id: string }> };
  const taxi = await json(await call('POST', '/v1/expenses', personal, { occurredOn: '2026-10-02', amount: '40.00', currency: 'USD', title: 'Taxi', categoryId: categories.items[0]!.id }));
  await call('POST', '/v1/expenses', personal, { occurredOn: '2026-10-03', amount: '120.00', currency: 'ILS', title: 'Hotel', vendor: 'Seaside' });
  const started = (await json(await call('POST', `/v1/expenses/${String(taxi.id)}/receipts`, personal, { filename: 'taxi.pdf', mimeType: 'application/pdf', sizeBytes: PDF.byteLength }))) as { receipt: { id: string }; upload: { url: string } };
  const storageKey = new URL(started.upload.url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
  storage.put(storageKey, { sizeBytes: PDF.byteLength, contentType: 'application/pdf' }, PDF);
  await call('POST', `/v1/expenses/${String(taxi.id)}/receipts/${started.receipt.id}/complete`, personal);
  const group = await json(await call('POST', '/v1/expense-groups', personal, { name: 'Amman trip', startOn: '2026-10-01', endOn: '2026-10-05' }));
  await call('PUT', `/v1/expense-groups/${String(group.id)}/expenses/${String(taxi.id)}`, personal, { mode: 'excluded' });
  await call('POST', '/v1/conversions', personal, { occurredOn: '2026-10-04', amount: '100.00', currency: 'USD', toAmount: '365.00', toCurrency: 'ILS' });
  // The person has opened the firm before (its expense categories are seeded on first read, MUT-42).
  await call('GET', '/v1/expense-categories', firm.id);
  await store.inboxEntries.create({ userId: user.id, kind: 'EXPENSE', amountMinor: 1_200n, currency: 'ILS', occurredOn: '2026-10-04', note: 'Parking', captureSource: null }, NOW);

  const transport: RecordsExportTransport = {
    async records(profileId) {
      const res = await call('GET', '/v1/records-export', profileId);
      if (!res.ok) throw new ApiError(res.status, 'UNKNOWN', `HTTP ${res.status}`);
      return res;
    },
    async receipt(profileId, receiptId) {
      const res = await call('GET', `/v1/records-export/receipts/${receiptId}`, profileId);
      if (!res.ok) throw new ApiError(res.status, 'UNKNOWN', `HTTP ${res.status}`);
      return res;
    },
  };
  return { store, app, call, user, personal, firm: firm.id, customerId: String(customer.id), groupId: String(group.id), taxiId: String(taxi.id), receiptId: started.receipt.id, transport };
}

async function restoredDevice(blob: Blob) {
  const decoded = await decodeRecordsArchive(blob);
  const { files } = await decoded.readFiles();
  const store = new MemoryLedgerStore();
  const blobs = new IndexedDbBlobStore();
  await blobs.putFiles(files);
  store.restore(decoded.snapshot);
  const { token, user } = await mintLocalSession(store, () => NOW, 'en');
  const app = createLocalApp({ store, now: () => NOW, attachments: new LocalAttachmentStorage(blobs) });
  return { store, blobs, user, call: client(app, token), decoded };
}

/** Every portal read of a profile, by path. */
function readsOf(h: { customerId: string; groupId: string; taxiId: string }, profile: 'personal' | 'firm') {
  const shared = ['/v1/summaries/organization', '/v1/customers', '/v1/receivables', '/v1/payments', '/v1/expenses', '/v1/expense-categories', '/v1/expense-groups', '/v1/conversions', '/v1/summaries/expenses', '/v1/attachments'];
  return profile === 'firm' ? shared : [...shared, `/v1/summaries/customers/${h.customerId}`, `/v1/expense-groups/${h.groupId}`, `/v1/expense-groups/${h.groupId}/summary`, `/v1/expenses/${h.taxiId}`];
}

/** A receipt's download link is a bucket URL hosted and `local-blob:` on the device, by design (MUT-287). */
const withoutLinks = (value: unknown) => JSON.parse(JSON.stringify(value, (k, v: unknown) => (k === 'url' || k === 'expiresAt' ? '<link>' : v)));

describe('hosted export → local restore parity (MUT-325 AC1)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('every profile read answers the same signed in and, after restoring the export, signed out', async () => {
    const hosted = await hostedAccount();
    const { blob, missingReceipts } = await exportHostedRecords({ profileIds: [hosted.personal, hosted.firm], transport: hosted.transport });
    expect(missingReceipts).toBe(0);
    const device = await restoredDevice(blob);

    expect(device.user.id).toBe(hosted.user.id);
    for (const [profile, id] of [['personal', hosted.personal], ['firm', hosted.firm]] as const) {
      for (const path of readsOf(hosted, profile)) {
        const there = await hosted.call('GET', path, id);
        const here = await device.call('GET', path, id);
        expect({ path, status: here.status }).toEqual({ path, status: there.status });
        expect(withoutLinks(await here.json()), `${profile} ${path}`).toEqual(withoutLinks(await there.json()));
      }
    }
  });

  it('the inbox comes back whole (local mode serves no inbox route, so compared row for row)', async () => {
    const hosted = await hostedAccount();
    const { blob } = await exportHostedRecords({ profileIds: [hosted.personal, hosted.firm], transport: hosted.transport });
    const device = await restoredDevice(blob);

    const notes = (s: MemoryLedgerStore) => [...s.snapshot().maps.inbox.values()].map((e) => [e.id, e.note, e.amountMinor]);
    expect(notes(device.store)).toEqual(notes(hosted.store));
  });

  it("the receipt's file comes back byte for byte", async () => {
    const hosted = await hostedAccount();
    const { blob } = await exportHostedRecords({ profileIds: [hosted.personal], transport: hosted.transport });
    const device = await restoredDevice(blob);

    const receipt = device.store.snapshot().maps.expReceipts.get(hosted.receiptId)!;
    expect(new Uint8Array(await readBytes((await device.blobs.get(receipt.storageKey))!))).toEqual(PDF);
  });

  it('differs only where the re-homing says: no Malafat writer, the firm is the person\'s own, the person has no email, no billing', async () => {
    const hosted = await hostedAccount();
    const { blob } = await exportHostedRecords({ profileIds: [hosted.personal, hosted.firm], transport: hosted.transport });
    const device = await restoredDevice(blob);

    const there = (await (await hosted.call('GET', '/v1/me', null)).json()) as { user: Record<string, unknown>; profiles: Array<Record<string, unknown>> };
    const here = (await (await device.call('GET', '/v1/me', null)).json()) as typeof there;
    const firmThere = there.profiles.find((p) => p.id === hosted.firm)!;
    const firmHere = here.profiles.find((p) => p.id === hosted.firm)!;
    expect(firmThere).toMatchObject({ writerOfRecord: 'MALAFAT', owned: false });
    expect(firmHere).toMatchObject({ writerOfRecord: null, owned: true, type: 'BUSINESS', name: 'Haddad Law' });
    // MUT-358: billing is a hosted account's alone; on this device every profile reports `billing: null`.
    // MUT-373: `owners` names the person by email, and the device has none (the re-homing above), so emails differ too.
    const withoutBilling = (p: Record<string, unknown> | undefined) => ({
      ...p,
      billing: undefined,
      owners: (p?.owners as Array<Record<string, unknown>> | null | undefined)?.map((o) => ({ ...o, email: undefined })),
    });
    expect(here.profiles.every((p) => p.billing === null)).toBe(true);
    expect(withoutBilling(here.profiles.find((p) => p.id === hosted.personal))).toEqual(withoutBilling(there.profiles.find((p) => p.id === hosted.personal)));
    expect(JSON.stringify(device.store.snapshot().maps.people)).not.toContain('rana@studio.ps');
    expect(device.store.snapshot().maps.ints.size).toBe(0);
    expect(device.decoded.fromAccount).toBe(true);
  });
});
