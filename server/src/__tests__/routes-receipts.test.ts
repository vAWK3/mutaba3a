import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { MAX_PENDING_LIBRARY_UPLOADS, RECEIPT_UPLOAD_POLICY } from '../routes/receipts.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-255: the receipts library — To-review uploads, the list and counts, approval into an expense, limits. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

function harness(opts: { bucket?: boolean; uploadsPerMinute?: number } = {}) {
  const store = new MemoryLedgerStore();
  const storage = new MemoryAttachmentStorage();
  const clock = { now: new Date('2026-10-22T21:30:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    attachments: opts.bucket === false ? null : storage,
    attachmentUrlTtlSeconds: 600,
    receiptUploadLimiter: new SlidingWindowRateLimiter(opts.uploadsPerMinute ?? 1_000),
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, storage, clock };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function setup(opts: { bucket?: boolean; uploadsPerMinute?: number } = {}) {
  const h = harness(opts);
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const other = await read(await h.app.request('/admin/v1/organizations', json({ name: `Other ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const email = `nour${++seq}@firm.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: org.id, locale: 'en' });
  await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId: other.id }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile: string = org.id, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });
  return { h, org: org as { id: string }, other: other as { id: string }, as, apiKey: { authorization: `Bearer ${key.secret}` }, userId: created.user.id as string };
}

const FILE = { filename: 'cafe.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 };
const SUGGESTION = {
  readerVersion: 'phone-1.0',
  date: { value: '2026-10-22', source: 'ocr', confidence: 0.9 },
  totalMinor: { value: '1500', source: 'ocr', confidence: 0.8 },
  currency: { value: 'ILS', source: 'qr', confidence: 1 },
};
const keyOf = (url: string) => new URL(url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');

/** Start, upload and complete a library receipt. */
async function upload(h: Harness, headers: Record<string, string>, body: object = FILE) {
  const started = await h.app.request('/v1/receipts/uploads', json(body, { ...headers, ...idem() }));
  expect(started.status).toBe(201);
  const s = await read(started);
  const file = body as { sizeBytes: number; mimeType: string };
  h.storage.put(keyOf(s.upload.url), { sizeBytes: file.sizeBytes, contentType: file.mimeType });
  const done = await h.app.request(`/v1/receipts/${s.receipt.id}/complete`, { method: 'POST', headers });
  expect(done.status).toBe(200);
  return read(done);
}

const approveBody = { occurredOn: '2026-10-22', amount: '15.00', currency: 'ILS', vendor: 'Cafe' };

describe('POST /v1/receipts/uploads → complete → GET /v1/receipts (AC1)', () => {
  it('a receipt uploaded with no expense appears under To review on its profile, with its upload day in the profile timezone', async () => {
    const { h, org, other, as } = await setup();
    const started = await read(await h.app.request('/v1/receipts/uploads', json({ ...FILE, suggested: SUGGESTION }, { ...as(), ...idem() })));
    // 21:30 UTC on 22 Oct is already 23 Oct in Jerusalem.
    expect(started.receipt).toMatchObject({ expenseId: null, filingStatus: 'TO_REVIEW', status: 'PENDING_UPLOAD', receivedOn: '2026-10-23', suggested: SUGGESTION, approved: null, version: 1 });
    expect(started.upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } });
    expect(keyOf(started.upload.url)).toBe(`org/${org.id}/expense-receipts/${started.receipt.id}`);
    expect((await read(await h.app.request('/v1/receipts', { headers: as() }))).items).toEqual([]);

    h.storage.put(keyOf(started.upload.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType });
    expect((await h.app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: as() })).status).toBe(200);

    const list = await read(await h.app.request('/v1/receipts?filingStatus=TO_REVIEW', { headers: as() }));
    expect(list.items.map((r: Loose) => r.id)).toEqual([started.receipt.id]);
    expect(await read(await h.app.request('/v1/receipts/counts', { headers: as() }))).toEqual({ toReview: 1, filed: 0 });
    expect((await read(await h.app.request('/v1/receipts', { headers: as(other.id) }))).items).toEqual([]);
    expect((await h.app.request(`/v1/receipts/${started.receipt.id}`, { headers: as(other.id) })).status).toBe(404);
  });

  it('drops unknown suggestion fields and refuses a malformed known one', async () => {
    const { h, as } = await setup();
    const started = await read(await h.app.request('/v1/receipts/uploads', json({ ...FILE, suggested: { ...SUGGESTION, lineItems: [{ name: 'x' }], date: { ...SUGGESTION.date, extra: 1 } } }, { ...as(), ...idem() })));
    expect(started.receipt.suggested).toEqual(SUGGESTION);
    const bad = await h.app.request('/v1/receipts/uploads', json({ ...FILE, suggested: { ...SUGGESTION, totalMinor: { value: '15.00', source: 'ocr', confidence: 1.5 } } }, { ...as(), ...idem() }));
    expect(bad.status).toBe(422);
  });

  it('pages newest first and filters by upload day and status', async () => {
    const { h, org, userId, as } = await setup();
    // An older receipt, received two days earlier (seeded: a real two-day wait would outlive the test session).
    const older = await h.store.expenseReceipts.create({ organizationId: org.id, expenseId: null, filename: 'old.pdf', mimeType: 'application/pdf', sizeBytes: 10, receivedOn: '2026-10-21', uploadedByUserId: userId, requestId: null }, new Date('2026-10-21T08:00:00Z'));
    await h.store.expenseReceipts.complete(org.id, older.id, new Date('2026-10-21T08:00:00Z'));
    const first = await upload(h, as());
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    const second = await upload(h, as());
    const page1 = await read(await h.app.request('/v1/receipts?limit=2', { headers: as() }));
    const page2 = await read(await h.app.request(`/v1/receipts?limit=2&cursor=${page1.nextCursor}`, { headers: as() }));
    expect([...page1.items, ...page2.items].map((r: Loose) => r.id)).toEqual([second.id, first.id, older.id]);
    expect(page2.nextCursor).toBeNull();
    expect((await read(await h.app.request('/v1/receipts?from=2026-10-21&to=2026-10-22', { headers: as() }))).items.map((r: Loose) => r.id)).toEqual([older.id]);
    expect((await read(await h.app.request('/v1/receipts?filingStatus=FILED', { headers: as() }))).items).toEqual([]);
    expect((await h.app.request('/v1/receipts?from=2026-10-25&to=2026-10-24', { headers: as() })).status).toBe(422);
    expect((await h.app.request('/v1/receipts?cursor=nonsense', { headers: as() })).status).toBe(422);
  });

  it('re-signs an unfinished upload, and refuses once READY', async () => {
    const { h, as } = await setup();
    const started = await read(await h.app.request('/v1/receipts/uploads', json(FILE, { ...as(), ...idem() })));
    h.clock.now = new Date(h.clock.now.getTime() + 60 * 60 * 1000);
    const fresh = await read(await h.app.request(`/v1/receipts/${started.receipt.id}/upload-url`, { method: 'POST', headers: as() }));
    expect(new Date(fresh.expiresAt).getTime()).toBeGreaterThan(new Date(started.upload.expiresAt).getTime());
    h.storage.put(keyOf(fresh.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType });
    await h.app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: as() });
    const again = await h.app.request(`/v1/receipts/${started.receipt.id}/upload-url`, { method: 'POST', headers: as() });
    expect(again.status).toBe(422);
    expect((await read(again)).error.details.reason).toBe('UPLOAD_ALREADY_COMPLETE');
  });
});

describe('POST /v1/receipts/{id}/approve (AC2, AC3)', () => {
  it('creates exactly one expense and files the receipt; a replay creates no duplicate; a new key gets 409 RECEIPT_ALREADY_FILED', async () => {
    const { h, org, as } = await setup();
    const receipt = await upload(h, as(), { ...FILE, suggested: SUGGESTION });
    const key = idem();
    const approve = (headers: Record<string, string>) => h.app.request(`/v1/receipts/${receipt.id}/approve`, json(approveBody, { ...as(), ...headers }));

    const first = await approve(key);
    expect(first.status).toBe(201);
    const body = await read(first);
    expect(body.expense).toMatchObject({ amount: '15.00', currency: 'ILS', occurredOn: '2026-10-22', vendor: 'Cafe' });
    expect(body.receipt).toMatchObject({ expenseId: body.expense.id, filingStatus: 'FILED', suggested: SUGGESTION, approved: { occurredOn: '2026-10-22', amountMinor: '1500', currency: 'ILS', vendor: 'Cafe', categoryId: null } });

    const replay = await approve(key);
    expect(replay.status).toBe(201);
    expect((await read(replay)).expense.id).toBe(body.expense.id);
    const conflict = await approve(idem());
    expect(conflict.status).toBe(409);
    expect((await read(conflict)).error.details.reason).toBe('RECEIPT_ALREADY_FILED');

    expect((await read(await h.app.request('/v1/expenses', { headers: as() }))).items).toHaveLength(1);
    expect((await read(await h.app.request(`/v1/expenses/${body.expense.id}`, { headers: as() }))).receipts.map((r: Loose) => r.id)).toEqual([receipt.id]);
    expect(await read(await h.app.request('/v1/receipts/counts', { headers: as() }))).toEqual({ toReview: 0, filed: 1 });
    const audit = (await h.store.audit.list(org.id, { action: 'expense_receipt.filed' }, { limit: 10, cursor: null })).items;
    expect(audit.map((a) => a.entityId)).toEqual([receipt.id]);
  });

  it('refuses where POST /v1/expenses refuses, before anything is filed', async () => {
    const { h, as } = await setup();
    const receipt = await upload(h, as());
    const tooOld = await h.app.request(`/v1/receipts/${receipt.id}/approve`, json({ ...approveBody, occurredOn: '2010-01-01' }, { ...as(), ...idem() }));
    expect(tooOld.status).toBe(422);
    const badCategory = await h.app.request(`/v1/receipts/${receipt.id}/approve`, json({ ...approveBody, categoryId: '00000000-0000-4000-8000-0000000000ca' }, { ...as(), ...idem() }));
    expect((await read(badCategory)).error.details.reason).toBe('CATEGORY_NOT_FOUND');
    expect((await read(await h.app.request(`/v1/receipts/${receipt.id}`, { headers: as() }))).filingStatus).toBe('TO_REVIEW');
    expect((await read(await h.app.request('/v1/expenses', { headers: as() }))).items).toEqual([]);
  });

  it('answers 422 ATTACHMENT_NOT_READY before the upload completes, and 404 for another profile', async () => {
    const { h, other, as } = await setup();
    const started = await read(await h.app.request('/v1/receipts/uploads', json(FILE, { ...as(), ...idem() })));
    const early = await h.app.request(`/v1/receipts/${started.receipt.id}/approve`, json(approveBody, { ...as(), ...idem() }));
    expect((await read(early)).error.details.reason).toBe('ATTACHMENT_NOT_READY');
    expect((await h.app.request(`/v1/receipts/${started.receipt.id}/approve`, json(approveBody, { ...as(other.id), ...idem() }))).status).toBe(404);
  });

  it('stores the suggestion sent with the approval; the operator edit rate counts it, numbers only', async () => {
    const { h, as } = await setup();
    const receipt = await upload(h, as());
    await h.app.request(`/v1/receipts/${receipt.id}/approve`, json({ ...approveBody, amount: '16.00', suggested: SUGGESTION }, { ...as(), ...idem() }));
    const rates = await read(await h.app.request('/admin/v1/receipts/edit-rates?from=2026-10-22&to=2026-10-22', { headers: admin }));
    expect(rates).toEqual({
      from: '2026-10-22',
      to: '2026-10-22',
      approved: 1,
      fields: { date: { suggested: 1, edited: 0 }, amount: { suggested: 1, edited: 1 }, currency: { suggested: 1, edited: 0 }, vendor: { suggested: 0, edited: 0 } },
      amountAndDate: { suggested: 1, unedited: 0 },
    });
    expect((await h.app.request('/admin/v1/receipts/edit-rates?from=2026-10-22&to=2026-10-22', { headers: as() })).status).toBe(401);
  });
});

describe('PATCH /v1/receipts/{id}/suggestion', () => {
  it('replaces a To-review suggestion with If-Match; a stale version is 409, a filed receipt is 409 RECEIPT_ALREADY_FILED', async () => {
    const { h, as } = await setup();
    const receipt = await upload(h, as());
    const patch = (version: number) => h.app.request(`/v1/receipts/${receipt.id}/suggestion`, json(SUGGESTION, { ...as(), 'if-match': String(version) }, 'PATCH'));
    const ok = await patch(1);
    expect(ok.status).toBe(200);
    expect(await read(ok)).toMatchObject({ suggested: SUGGESTION, version: 2 });
    expect((await patch(1)).status).toBe(409);
    await h.app.request(`/v1/receipts/${receipt.id}/approve`, json(approveBody, { ...as(), ...idem() }));
    expect((await read(await patch(3))).error.details.reason).toBe('RECEIPT_ALREADY_FILED');
  });
});

describe('limits (decision P3)', () => {
  it(`refuses the ${MAX_PENDING_LIBRARY_UPLOADS + 1}th unfinished upload of the day; an older one doesn't count`, async () => {
    const { h, org, userId, as } = await setup();
    // An unfinished upload from 25 hours ago (seeded, as above) is outside the window.
    await h.store.expenseReceipts.create({ organizationId: org.id, expenseId: null, filename: 'old.pdf', mimeType: 'application/pdf', sizeBytes: 10, receivedOn: '2026-10-21', uploadedByUserId: userId, requestId: null }, new Date(h.clock.now.getTime() - 25 * 60 * 60 * 1000));
    for (let i = 0; i < MAX_PENDING_LIBRARY_UPLOADS; i++) expect((await h.app.request('/v1/receipts/uploads', json(FILE, { ...as(), ...idem() }))).status).toBe(201);
    const refused = await h.app.request('/v1/receipts/uploads', json(FILE, { ...as(), ...idem() }));
    expect(refused.status).toBe(422);
    expect((await read(refused)).error.details.reason).toBe('TOO_MANY_PENDING_UPLOADS');
  });

  it('rate-limits upload starts per person, with Retry-After', async () => {
    const { h, as } = await setup({ uploadsPerMinute: 2 });
    for (let i = 0; i < 2; i++) expect((await h.app.request('/v1/receipts/uploads', json(FILE, { ...as(), ...idem() }))).status).toBe(201);
    const limited = await h.app.request('/v1/receipts/uploads', json(FILE, { ...as(), ...idem() }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect(RECEIPT_UPLOAD_POLICY.perMinute).toBe(30);
  });
});

describe('access and configuration', () => {
  it('answers 503 ATTACHMENTS_NOT_CONFIGURED on every route with no bucket (AC5)', async () => {
    const { h, as } = await setup({ bucket: false });
    const id = '00000000-0000-4000-8000-0000000000aa';
    const calls: Array<[string, RequestInit]> = [
      ['/v1/receipts/uploads', json(FILE, { ...as(), ...idem() })],
      [`/v1/receipts/${id}/upload-url`, { method: 'POST', headers: as() }],
      [`/v1/receipts/${id}/complete`, { method: 'POST', headers: as() }],
      ['/v1/receipts', { headers: as() }],
      ['/v1/receipts/counts', { headers: as() }],
      [`/v1/receipts/${id}`, { headers: as() }],
      [`/v1/receipts/${id}/download`, { headers: as() }],
      [`/v1/receipts/${id}/suggestion`, json(SUGGESTION, { ...as(), 'if-match': '1' }, 'PATCH')],
      [`/v1/receipts/${id}/approve`, json(approveBody, { ...as(), ...idem() })],
      [`/v1/receipts/${id}`, { method: 'DELETE', headers: as() }],
    ];
    for (const [path, init] of calls) {
      const res = await h.app.request(path, init);
      expect(res.status, `${init.method ?? 'GET'} ${path}`).toBe(503);
      expect((await read(res)).error.code).toBe('ATTACHMENTS_NOT_CONFIGURED');
    }
  });

  it("refuses Malafat's API key", async () => {
    const { h, apiKey } = await setup();
    expect((await h.app.request('/v1/receipts', { headers: apiKey })).status).toBe(403);
  });

  it('downloads a READY receipt and deletes one, idempotently, removing its object', async () => {
    const { h, org, as } = await setup();
    const receipt = await upload(h, as());
    const dl = await read(await h.app.request(`/v1/receipts/${receipt.id}/download`, { headers: as() }));
    expect(dl).toMatchObject({ filename: 'cafe.jpg', mimeType: 'image/jpeg' });
    const del = () => h.app.request(`/v1/receipts/${receipt.id}`, { method: 'DELETE', headers: as() });
    expect((await del()).status).toBe(204);
    expect(h.storage.removed).toEqual([`org/${org.id}/expense-receipts/${receipt.id}`]);
    expect((await del()).status).toBe(204);
    expect((await h.app.request('/v1/receipts/00000000-0000-4000-8000-0000000000dd', { method: 'DELETE', headers: as() })).status).toBe(404);
  });

  it('keeps the MUT-44 flow: a receipt attached to an existing expense is FILED from the start (AC4)', async () => {
    const { h, as } = await setup();
    const expense = await read(await h.app.request('/v1/expenses', json(approveBody, { ...as(), ...idem() })));
    const started = await read(await h.app.request(`/v1/expenses/${expense.id}/receipts`, json(FILE, as())));
    expect(started.receipt).toMatchObject({ expenseId: expense.id, filingStatus: 'FILED' });
    h.storage.put(keyOf(started.upload.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType });
    expect((await h.app.request(`/v1/expenses/${expense.id}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: as() })).status).toBe(200);
    expect(await read(await h.app.request('/v1/receipts/counts', { headers: as() }))).toEqual({ toReview: 0, filed: 1 });
  });
});
