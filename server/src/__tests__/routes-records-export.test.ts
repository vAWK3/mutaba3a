import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { decodeTagged, HOSTED_EXPORT_ORIGIN, RECORDS_FILE_KIND } from '../records-file/codec.js';
import { EXPORT_PAGE_SIZE } from '../records-file/export.js';
import { LOCAL_PERSON_EMAIL } from '../records-file/local-person.js';
import { CURRENT_STORE_SNAPSHOT_VERSION, MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-325: GET /v1/records-export and its file route — a signed-in person's own profile, as a local-mode records file. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

function harness(storage: MemoryAttachmentStorage | null = new MemoryAttachmentStorage()) {
  const store = new MemoryLedgerStore();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => new Date('2026-10-20T09:00:00Z'),
    attachments: storage,
    attachmentUrlTtlSeconds: 900,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, storage };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const idem = () => ({ 'idempotency-key': `key-${++seq}-${Math.random().toString(36).slice(2, 8)}` });

async function firm(h: Harness) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  return { id: org.id as string, key: { authorization: `Bearer ${key.secret}` } };
}

async function person(h: Harness, organizationId: string) {
  const email = `partner${++seq}@firm.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId, locale: 'en' });
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile: string | null, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, ...(profile ? { 'x-mutaba3a-profile': profile } : {}), ...SAME_ORIGIN, ...extra });
  return { as, userId: created.user.id as string, email };
}

async function expenseWithReceipt(h: Harness, headers: Record<string, string>) {
  const expense = await read(await h.app.request('/v1/expenses', json({ amount: '12.00', currency: 'ILS', occurredOn: '2026-10-05', title: 'Paper' }, { ...headers, ...idem() })));
  const started = await read(await h.app.request(`/v1/expenses/${expense.id}/receipts`, json({ filename: 'r.png', mimeType: 'image/png', sizeBytes: PNG.byteLength }, headers)));
  const storageKey = new URL(started.upload.url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
  h.storage!.put(storageKey, { sizeBytes: PNG.byteLength, contentType: 'image/png' }, PNG);
  await h.app.request(`/v1/expenses/${expense.id}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers });
  return { expenseId: expense.id as string, receiptId: started.receipt.id as string, storageKey };
}

async function setup() {
  const h = harness();
  const a = await firm(h);
  const b = await firm(h);
  const p = await person(h, a.id);
  return { h, a, b, p };
}

const recordsOf = async (res: Response) => {
  const file = (await res.json()) as Record<string, unknown>;
  return { file, maps: decodeTagged(file.maps) as Record<string, Map<string, Loose>> };
};

describe('GET /v1/records-export', () => {
  it("answers the profile's records file, labelled as a hosted export, re-homed to the device's person", async () => {
    const { h, a, p } = await setup();
    await h.app.request('/v1/customers', json({ name: 'Ramallah Bakery' }, { ...p.as(a.id), ...idem() }));

    const res = await h.app.request('/v1/records-export', { headers: p.as(a.id) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const { file, maps } = await recordsOf(res);
    expect(file).toMatchObject({ kind: RECORDS_FILE_KIND, formatVersion: CURRENT_STORE_SNAPSHOT_VERSION, origin: HOSTED_EXPORT_ORIGIN });
    expect([...maps.custs!.values()].map((c) => c.name)).toEqual(['Ramallah Bakery']);
    expect([...maps.orgs!.keys()]).toEqual([a.id]);
    expect([...maps.people!.values()].map((u) => [u.id, u.email, u.passwordHash])).toEqual([[p.userId, LOCAL_PERSON_EMAIL, null]]);
    expect(JSON.stringify(file)).not.toContain(p.email);
  });

  it('is audited on the profile, as the person', async () => {
    const { h, a, p } = await setup();

    await (await h.app.request('/v1/records-export', { headers: p.as(a.id) })).text();

    const events = await h.store.audit.list(a.id, {}, { limit: 50, cursor: null });
    expect(events.items.find((e) => e.action === 'records.exported')).toMatchObject({ actorType: 'USER', actorId: p.userId, entityType: 'organization', entityId: a.id });
  });

  it("refuses a profile the person doesn't belong to, a request naming none, and an API key", async () => {
    const { h, a, b, p } = await setup();

    expect((await h.app.request('/v1/records-export', { headers: p.as(b.id) })).status).toBe(404);
    expect((await h.app.request('/v1/records-export', { headers: p.as(null) })).status).toBe(422);
    expect((await h.app.request('/v1/records-export', { headers: a.key })).status).toBe(403);
  });

  it('posts due items first, so the file holds what any read would show (ADR-037 decision 8)', async () => {
    const { h, a, p } = await setup();
    const at = new Date('2026-10-01T08:00:00Z');
    const customer = await h.store.customers.create({ organizationId: a.id, name: 'Bakery', email: null, phone: null, notes: null }, at);
    const project = await h.store.projects.create({ organizationId: a.id, customerId: customer.id, name: 'Menu', currency: 'ILS' }, at);
    await h.store.agreements.create(
      {
        organizationId: a.id, projectId: project.id, customerId: customer.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'OUT_OF_SCOPE',
        vatRateBasisPoints: 0, amountMinor: 1000n, netMinor: 1000n, vatMinor: 0n, grossMinor: 1000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'IMMEDIATE',
        startMonth: null, billingDay: null, endMonth: null,
        installments: [{ position: 1, label: 'All', amountMinor: 1000n, netMinor: 1000n, vatMinor: 0n, grossMinor: 1000n, vatTreatment: 'OUT_OF_SCOPE', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: 'IMMEDIATE', dueDateOverride: null }],
      },
      at,
    );

    const { maps } = await recordsOf(await h.app.request('/v1/records-export', { headers: p.as(a.id) }));

    expect(maps.recs!.size).toBe(1);
    expect([...maps.insts!.values()][0].receivableId).toBe([...maps.recs!.keys()][0]);
  });

  it('gzips the file when the browser accepts it', async () => {
    const { h, a, p } = await setup();

    const res = await h.app.request('/v1/records-export', { headers: p.as(a.id, { 'accept-encoding': 'gzip, br' }) });

    expect(res.headers.get('content-encoding')).toBe('gzip');
    const file = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8')) as Record<string, unknown>;
    expect(file.kind).toBe(RECORDS_FILE_KIND);
  });

  it('streams a large profile a page of rows at a time', async () => {
    const { h, a, p } = await setup();
    for (let i = 0; i < EXPORT_PAGE_SIZE * 2 + 1; i++) await h.store.customers.create({ organizationId: a.id, name: `Client ${i}`, email: null, phone: null, notes: null }, new Date('2026-10-01T08:00:00Z'));
    const profilePage = vi.spyOn(h.store.recordsExport, 'profilePage');

    const res = await h.app.request('/v1/records-export', { headers: p.as(a.id) });
    const { maps } = await recordsOf(res);

    expect(maps.custs!.size).toBe(EXPORT_PAGE_SIZE * 2 + 1);
    expect(profilePage.mock.calls.every(([, , , limit]) => limit === EXPORT_PAGE_SIZE)).toBe(true);
    expect(profilePage.mock.calls.filter(([, field]) => field === 'custs')).toHaveLength(3);
  });
});

describe('GET /v1/records-export, mid-stream failure', () => {
  it('aborts the response instead of ending it as if whole, and logs it', async () => {
    const { h, a, p } = await setup();
    vi.spyOn(h.store.recordsExport, 'profilePage').mockRejectedValueOnce(new Error('connection lost'));

    const res = await h.app.request('/v1/records-export', { headers: p.as(a.id) });

    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
  });
});

describe('GET /v1/records-export/receipts/{receiptId}', () => {
  it("streams a READY receipt's bytes", async () => {
    const { h, a, p } = await setup();
    const { receiptId } = await expenseWithReceipt(h, p.as(a.id));

    const res = await h.app.request(`/v1/records-export/receipts/${receiptId}`, { headers: p.as(a.id) });

    expect(res.status).toBe(200);
    // ADR-028: a download, never rendered in place.
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("answers 404 for another profile's receipt, a pending upload, a deleted one, and an unknown id", async () => {
    const { h, a, b, p } = await setup();
    const { receiptId, expenseId } = await expenseWithReceipt(h, p.as(a.id));
    const pending = await read(await h.app.request(`/v1/expenses/${expenseId}/receipts`, json({ filename: 'p.png', mimeType: 'image/png', sizeBytes: 3 }, p.as(a.id))));
    const member = await person(h, b.id);

    expect((await h.app.request(`/v1/records-export/receipts/${receiptId}`, { headers: member.as(b.id) })).status).toBe(404);
    expect((await h.app.request(`/v1/records-export/receipts/${pending.receipt.id}`, { headers: p.as(a.id) })).status).toBe(404);
    expect((await h.app.request('/v1/records-export/receipts/00000000-0000-4000-8000-000000000001', { headers: p.as(a.id) })).status).toBe(404);
    await h.app.request(`/v1/expenses/${expenseId}/receipts/${receiptId}`, { method: 'DELETE', headers: p.as(a.id) });
    expect((await h.app.request(`/v1/records-export/receipts/${receiptId}`, { headers: p.as(a.id) })).status).toBe(404);
  });

  it('answers 503 where the deployment has no bucket', async () => {
    const h = harness(null);
    const a = await firm(h);
    const p = await person(h, a.id);

    const res = await h.app.request('/v1/records-export/receipts/00000000-0000-4000-8000-000000000001', { headers: p.as(a.id) });

    expect(res.status).toBe(503);
  });
});
