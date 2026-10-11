import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SCOPES } from '../auth/scopes.js';
import { GENERAL_PRESET, LAW_FIRM_PRESET } from '../expenses/presets.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/** MUT-42: expenses on hosted profiles — session-only routes, receipts, categories, summary. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const TTL = 600;

function harness(opts: { bucket?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  const storage = new MemoryAttachmentStorage();
  const clock = { now: new Date('2026-10-20T09:00:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    attachments: opts.bucket === false ? null : storage,
    attachmentUrlTtlSeconds: TTL,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, storage, clock };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function firm(h: Harness, opts: { malafat: boolean }) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const auth = { authorization: `Bearer ${key.secret}` };
  if (opts.malafat) {
    await h.store.integrations.connect({ organizationId: org.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: org.name, connectedByApiKeyId: key.apiKey.id, at: h.clock.now });
  }
  const customer = await read(await h.app.request('/v1/customers', json({ name: `Haddad ${seq}` }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Sale', currency: 'USD' }, { ...auth, ...idem() })));
  return { org: org as { id: string }, auth, customer, project };
}

async function partner(h: Harness, organizationIds: string[], locale: 'en' | 'ar' = 'en') {
  const [first, ...rest] = organizationIds;
  const email = `partner${++seq}@firm.ps`;
  const created = await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId: first, locale }, admin)));
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.initialPassword }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile: string, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });
  return { as, userId: created.user.id as string };
}

async function setup(opts: { bucket?: boolean; locale?: 'en' | 'ar' } = {}) {
  const h = harness(opts);
  const a = await firm(h, { malafat: true });
  const b = await firm(h, { malafat: false });
  const p = await partner(h, [a.org.id, b.org.id], opts.locale ?? 'en');
  const create = async (body: Record<string, unknown>, profile = a.org.id) => h.app.request('/v1/expenses', json({ occurredOn: '2026-10-05', amount: '120.50', currency: 'ILS', ...body }, { ...p.as(profile), ...idem() }));
  return { h, a, b, p, create };
}

describe('MUT-42 carries MUT-39’s expense criteria', () => {
  it('a session writes an expense on a Malafat-fed profile', async () => {
    const { create } = await setup();
    expect((await create({})).status).toBe(201);
  });

  it('Malafat’s key is refused on every expense operation', async () => {
    const { h, a } = await setup();
    const doc = (await read(await h.app.request('/openapi.json'))) as { paths: Record<string, Record<string, unknown>> };
    const ops = Object.entries(doc.paths)
      .filter(([path]) => /^\/v1\/(expenses|expense-categories|summaries\/expenses)/.test(path))
      .flatMap(([path, item]) => ['get', 'post', 'patch', 'delete'].filter((m) => item[m]).map((m) => [m.toUpperCase(), path] as const));
    expect(ops).toHaveLength(13);
    for (const [method, path] of ops) {
      const res = await h.app.request(path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-0000000000aa'), { method, headers: { ...a.auth, 'content-type': 'application/json', ...idem(), 'if-match': '1' }, ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }) });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await read(res)).error.code, `${method} ${path}`).toBe('PRINCIPAL_NOT_ACCEPTED');
    }
  });
});

describe('POST /v1/expenses', () => {
  it('stores the original amount and currency and answers the full shape', async () => {
    const { a, p, create } = await setup();
    const res = await create({ title: 'Court fee', vendor: 'Magistrate court', notes: 'Stamp duty', projectId: a.project.id });
    expect(res.status).toBe(201);
    expect(await read(res)).toEqual({
      id: expect.any(String),
      occurredOn: '2026-10-05',
      amount: '120.50',
      currency: 'ILS',
      title: 'Court fee',
      vendor: 'Magistrate court',
      categoryId: null,
      customerId: a.customer.id,
      projectId: a.project.id,
      notes: 'Stamp duty',
      createdByUserId: p.userId,
      version: 1,
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
    });
  });

  it('replays an Idempotency-Key and refuses it for a different body', async () => {
    const { h, a, p } = await setup();
    const key = { ...p.as(a.org.id), 'idempotency-key': 'expense-key-0001' };
    const first = await h.app.request('/v1/expenses', json({ occurredOn: '2026-10-05', amount: '10.00', currency: 'ILS' }, key));
    const again = await h.app.request('/v1/expenses', json({ occurredOn: '2026-10-05', amount: '10.00', currency: 'ILS' }, key));
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await read(again)).toEqual(await read(first));
    const other = await h.app.request('/v1/expenses', json({ occurredOn: '2026-10-05', amount: '11.00', currency: 'ILS' }, key));
    expect((await read(other)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await read(await h.app.request('/v1/expenses', { headers: p.as(a.org.id) }))).items).toHaveLength(1);
  });

  it.each([
    ['a zero amount', { amount: '0.00' }, 'AMOUNT_INVALID'],
    ['a negative amount', { amount: '-5.00' }, 'AMOUNT_INVALID'],
    ['too many decimals', { amount: '1.234' }, 'AMOUNT_INVALID'],
    ['an impossible date', { occurredOn: '2026-02-30' }, 'DATE_INVALID'],
    ['an unknown customer', { customerId: '00000000-0000-4000-8000-0000000000c1' }, 'CUSTOMER_NOT_FOUND'],
    ['an unknown project', { projectId: '00000000-0000-4000-8000-0000000000c2' }, 'PROJECT_NOT_FOUND'],
    ['an unknown category', { categoryId: '00000000-0000-4000-8000-0000000000c3' }, 'CATEGORY_NOT_FOUND'],
  ])('refuses %s with 422 %s', async (_label, body, reason) => {
    const { create } = await setup();
    const res = await create(body);
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.reason).toBe(reason);
  });

  it('refuses an unsupported currency at the schema', async () => {
    const { create } = await setup();
    const res = await create({ currency: 'GBP' });
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('VALIDATION_FAILED');
  });

  it('keeps an ILS expense on a USD matter in ILS, derives the client from the matter, and refuses a mismatch', async () => {
    const { h, a, create } = await setup();
    const onMatter = await read(await create({ projectId: a.project.id, currency: 'ILS', amount: '75.00' }));
    expect(onMatter).toMatchObject({ currency: 'ILS', amount: '75.00', customerId: a.customer.id, projectId: a.project.id });
    const other = await read(await h.app.request('/v1/customers', json({ name: 'Other client' }, { ...a.auth, ...idem() })));
    const res = await create({ projectId: a.project.id, customerId: other.id });
    expect((await read(res)).error.details.reason).toBe('PROJECT_CUSTOMER_MISMATCH');
  });

  it('does not reach another profile’s client, and says nothing about it', async () => {
    const { b, create } = await setup();
    const res = await create({ customerId: b.customer.id });
    expect(res.status).toBe(422);
    const body = await read(res);
    expect(body.error.details.reason).toBe('CUSTOMER_NOT_FOUND');
    expect(JSON.stringify(body)).not.toContain(b.org.id);
  });

  it('may link an archived client (an old expense on a closed relationship)', async () => {
    const { h, a, create } = await setup();
    const old = await read(await h.app.request('/v1/customers', json({ name: 'Former client' }, { ...a.auth, ...idem() })));
    expect((await h.app.request(`/v1/customers/${old.id}/archive`, { method: 'POST', headers: { ...a.auth, ...idem() } })).status).toBe(200);
    expect((await create({ customerId: old.id })).status).toBe(201);
  });
});

describe('PATCH /v1/expenses/{id}', () => {
  it('needs If-Match, refuses a stale version, clears with null, re-parses the amount in the row’s currency', async () => {
    const { h, a, p, create } = await setup();
    const e = await read(await create({ currency: 'USD', vendor: 'Courier', notes: 'keep' }));
    const url = `/v1/expenses/${e.id}`;
    expect((await read(await h.app.request(url, json({ vendor: null }, p.as(a.org.id), 'PATCH')))).error.code).toBe('VALIDATION_FAILED');
    const updated = await read(await h.app.request(url, json({ vendor: null, amount: '1.5' }, { ...p.as(a.org.id), 'if-match': '1' }, 'PATCH')));
    expect(updated).toMatchObject({ vendor: null, notes: 'keep', amount: '1.50', currency: 'USD', version: 2 });
    const stale = await h.app.request(url, json({ notes: 'x' }, { ...p.as(a.org.id), 'if-match': '1' }, 'PATCH'));
    expect(stale.status).toBe(409);
    expect((await read(stale)).error.details.reason).toBe('VERSION_MISMATCH');
  });

  it('never changes a row’s currency', async () => {
    const { h, a, p, create } = await setup();
    const e = await read(await create({}));
    const res = await h.app.request(`/v1/expenses/${e.id}`, json({ currency: 'USD' }, { ...p.as(a.org.id), 'if-match': '1' }, 'PATCH'));
    expect(res.status).toBe(422);
    expect((await read(await h.app.request(`/v1/expenses/${e.id}`, { headers: p.as(a.org.id) }))).currency).toBe('ILS');
  });

  it('keeps an archived category already on the row but refuses choosing it anew', async () => {
    const { h, a, p, create } = await setup();
    const cats = (await read(await h.app.request('/v1/expense-categories', { headers: p.as(a.org.id) }))).items;
    const [first, second] = cats;
    const e = await read(await create({ categoryId: first.id }));
    const other = await read(await create({ categoryId: second.id }));
    await h.app.request(`/v1/expense-categories/${first.id}`, json({ archived: true }, { ...p.as(a.org.id), 'if-match': '1' }, 'PATCH'));
    const kept = await h.app.request(`/v1/expenses/${e.id}`, json({ notes: 'still filed' }, { ...p.as(a.org.id), 'if-match': '1' }, 'PATCH'));
    expect(kept.status).toBe(200);
    const moved = await h.app.request(`/v1/expenses/${other.id}`, json({ categoryId: first.id }, { ...p.as(a.org.id), 'if-match': '1' }, 'PATCH'));
    expect((await read(moved)).error.details.reason).toBe('CATEGORY_ARCHIVED');
    expect((await read(await create({ categoryId: first.id }))).error.details.reason).toBe('CATEGORY_ARCHIVED');
  });
});

describe('DELETE /v1/expenses/{id}', () => {
  it('soft-deletes once, removes receipts and their objects, answers 204 again and 404 for an unknown id', async () => {
    const { h, a, p, create } = await setup();
    const e = await read(await create({}));
    const receipt = await uploadReceipt(h, p.as(a.org.id), e.id);
    const del = () => h.app.request(`/v1/expenses/${e.id}`, { method: 'DELETE', headers: p.as(a.org.id) });
    expect((await del()).status).toBe(204);
    expect((await h.app.request(`/v1/expenses/${e.id}`, { headers: p.as(a.org.id) })).status).toBe(404);
    expect((await read(await h.app.request('/v1/expenses', { headers: p.as(a.org.id) }))).items).toEqual([]);
    expect(h.storage.objects.has(receipt.storageKey)).toBe(false);
    expect((await del()).status).toBe(204);
    const deletions = (await h.store.audit.list(a.org.id, { action: 'expense.deleted' }, { limit: 10, cursor: null })).items;
    expect(deletions).toHaveLength(1);
    expect((await h.app.request('/v1/expenses/00000000-0000-4000-8000-0000000000dd', { method: 'DELETE', headers: p.as(a.org.id) })).status).toBe(404);
  });
});

describe('GET /v1/expenses', () => {
  it('pages newest first and filters, on a personal profile the same as a firm’s', async () => {
    const { h, b, p, create } = await setup();
    for (const d of ['2026-10-01', '2026-10-09', '2026-10-04']) await create({ occurredOn: d }, b.org.id);
    await create({ occurredOn: '2026-10-06', currency: 'USD', customerId: b.customer.id }, b.org.id);
    const dates: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Loose = await read(await h.app.request(`/v1/expenses?limit=2${cursor ? `&cursor=${cursor}` : ''}`, { headers: p.as(b.org.id) }));
      dates.push(...page.items.map((x: Loose) => x.occurredOn));
      cursor = page.nextCursor;
    } while (cursor);
    expect(dates).toEqual(['2026-10-09', '2026-10-06', '2026-10-04', '2026-10-01']);
    const q = async (query: string) => (await read(await h.app.request(`/v1/expenses?${query}`, { headers: p.as(b.org.id) }))).items.map((x: Loose) => x.occurredOn);
    expect(await q('from=2026-10-04&to=2026-10-06')).toEqual(['2026-10-06', '2026-10-04']);
    expect(await q('currency=USD')).toEqual(['2026-10-06']);
    expect(await q(`customerId=${b.customer.id}`)).toEqual(['2026-10-06']);
    expect(await q('linked=none')).toEqual(['2026-10-09', '2026-10-04', '2026-10-01']);
  });
});

async function uploadReceipt(h: Harness, headers: Record<string, string>, expenseId: string, file = { filename: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 2048 }) {
  const started = await h.app.request(`/v1/expenses/${expenseId}/receipts`, json(file, headers));
  expect(started.status).toBe(201);
  const body = await read(started);
  const storageKey = new URL(body.upload.url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
  h.storage.put(storageKey, { sizeBytes: file.sizeBytes, contentType: file.mimeType });
  const done = await h.app.request(`/v1/expenses/${expenseId}/receipts/${body.receipt.id}/complete`, { method: 'POST', headers });
  expect(done.status).toBe(200);
  return { ...(await read(done)), storageKey };
}

describe('expense receipts', () => {
  it('uploads through the existing bucket and TTL, lists on the detail, downloads, deletes', async () => {
    const { h, a, p, create } = await setup();
    const e = await read(await create({}));
    const receipt = await uploadReceipt(h, p.as(a.org.id), e.id);
    expect(receipt.storageKey).toBe(`org/${a.org.id}/expense-receipts/${receipt.id}`);
    expect(receipt).toMatchObject({ status: 'READY', expenseId: e.id, filename: 'receipt.pdf', uploadedByUserId: p.userId });
    const detail = await read(await h.app.request(`/v1/expenses/${e.id}`, { headers: p.as(a.org.id) }));
    expect(detail.receipts.map((r: Loose) => r.id)).toEqual([receipt.id]);
    const download = await read(await h.app.request(`/v1/expenses/${e.id}/receipts/${receipt.id}/download`, { headers: p.as(a.org.id) }));
    expect(new Date(download.expiresAt).getTime() - h.clock.now.getTime()).toBe(TTL * 1000);
    expect(download).toMatchObject({ filename: 'receipt.pdf', mimeType: 'application/pdf' });
    expect((await h.app.request(`/v1/expenses/${e.id}/receipts/${receipt.id}`, { method: 'DELETE', headers: p.as(a.org.id) })).status).toBe(204);
    expect(h.storage.removed).toContain(receipt.storageKey);
    expect((await read(await h.app.request(`/v1/expenses/${e.id}`, { headers: p.as(a.org.id) }))).receipts).toEqual([]);
  });

  it('refuses completing before the bytes arrive, or with different bytes', async () => {
    const { h, a, p, create } = await setup();
    const e = await read(await create({}));
    const started = await read(await h.app.request(`/v1/expenses/${e.id}/receipts`, json({ filename: 'r.png', mimeType: 'image/png', sizeBytes: 100 }, p.as(a.org.id))));
    const complete = () => h.app.request(`/v1/expenses/${e.id}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: p.as(a.org.id) });
    expect((await read(await complete())).error.details.reason).toBe('UPLOAD_INCOMPLETE');
    h.storage.put(`org/${a.org.id}/expense-receipts/${started.receipt.id}`, { sizeBytes: 99, contentType: 'image/png' });
    expect((await read(await complete())).error.details.reason).toBe('UPLOAD_MISMATCH');
  });

  it.each([
    [{ filename: 'r.txt', mimeType: 'text/plain', sizeBytes: 10 }, 422],
    [{ filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10 * 1024 * 1024 + 1 }, 422],
  ])('refuses a file the M6 rules refuse (%o)', async (file, status) => {
    const { h, a, p, create } = await setup();
    const e = await read(await create({}));
    expect((await h.app.request(`/v1/expenses/${e.id}/receipts`, json(file, p.as(a.org.id)))).status).toBe(status);
  });

  it('holds at most ten receipts per expense', async () => {
    const { h, a, p, create } = await setup();
    const e = await read(await create({}));
    for (let i = 0; i < 10; i++) await uploadReceipt(h, p.as(a.org.id), e.id);
    const eleventh = await h.app.request(`/v1/expenses/${e.id}/receipts`, json({ filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10 }, p.as(a.org.id)));
    expect((await read(eleventh)).error.details.reason).toBe('TOO_MANY_RECEIPTS');
  });

  it('answers 503 when the deployment has no bucket', async () => {
    const { h, a, p, create } = await setup({ bucket: false });
    const e = await read(await create({}));
    const res = await h.app.request(`/v1/expenses/${e.id}/receipts`, json({ filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10 }, p.as(a.org.id)));
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('ATTACHMENTS_NOT_CONFIGURED');
  });
});

describe('expense categories', () => {
  it('seeds the law-firm preset on a Malafat-fed profile, in Arabic for an Arabic user, once, as SYSTEM', async () => {
    const { h, a, p } = await setup({ locale: 'ar' });
    const list = () => h.app.request('/v1/expense-categories', { headers: p.as(a.org.id) });
    const first = await read(await list());
    expect(first.items.map((c: Loose) => c.name)).toEqual(LAW_FIRM_PRESET.map((c) => c.nameAr));
    expect(first.items[0]).toEqual({ id: expect.any(String), name: LAW_FIRM_PRESET[0]!.nameAr, color: LAW_FIRM_PRESET[0]!.color, archived: false, version: 1, createdAt: expect.any(String), updatedAt: expect.any(String) });
    await list();
    const seeded = (await h.store.audit.list(a.org.id, { action: 'expense_category.seeded' }, { limit: 10, cursor: null })).items;
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ actorType: 'SYSTEM', actorId: null, metadata: { preset: 'lawFirm', count: LAW_FIRM_PRESET.length } });
  });

  it('seeds the general preset on a personal profile', async () => {
    const { h, b, p } = await setup();
    const items = (await read(await h.app.request('/v1/expense-categories', { headers: p.as(b.org.id) }))).items;
    expect(items.map((c: Loose) => c.name)).toEqual(GENERAL_PRESET.map((c) => c.name));
  });

  it('creates, refuses a duplicate in any case, renames, recolours and archives', async () => {
    const { h, a, p } = await setup();
    await h.app.request('/v1/expense-categories', { headers: p.as(a.org.id) });
    const created = await h.app.request('/v1/expense-categories', json({ name: 'Notary', color: '#123abc' }, { ...p.as(a.org.id), ...idem() }));
    expect(created.status).toBe(201);
    const cat = await read(created);
    const dup = await h.app.request('/v1/expense-categories', json({ name: '  notary ' }, { ...p.as(a.org.id), ...idem() }));
    expect(dup.status).toBe(409);
    expect((await read(dup)).error.details.reason).toBe('CATEGORY_NAME_TAKEN');
    const patched = await read(await h.app.request(`/v1/expense-categories/${cat.id}`, json({ name: 'Notary fees', color: null, archived: true }, { ...p.as(a.org.id), 'if-match': '1' }, 'PATCH')));
    expect(patched).toMatchObject({ name: 'Notary fees', color: null, archived: true, version: 2 });
    const visible = (await read(await h.app.request('/v1/expense-categories', { headers: p.as(a.org.id) }))).items.map((c: Loose) => c.id);
    expect(visible).not.toContain(cat.id);
    const all = (await read(await h.app.request('/v1/expense-categories?includeArchived=true', { headers: p.as(a.org.id) }))).items.map((c: Loose) => c.id);
    expect(all).toContain(cat.id);
  });
});

describe('GET /v1/summaries/expenses', () => {
  it('defaults to this month in the organization’s timezone and reports each currency on its own', async () => {
    const { h, a, p, create } = await setup();
    const cats = (await read(await h.app.request('/v1/expense-categories', { headers: p.as(a.org.id) }))).items;
    await create({ occurredOn: '2026-10-01', amount: '100.00', categoryId: cats[0].id, customerId: a.customer.id });
    await create({ occurredOn: '2026-10-31', amount: '50.00' });
    await create({ occurredOn: '2026-10-15', amount: '20.00', currency: 'USD' });
    await create({ occurredOn: '2026-09-30', amount: '999.00' });
    const gone = await read(await create({ occurredOn: '2026-10-02', amount: '500.00' }));
    await h.app.request(`/v1/expenses/${gone.id}`, { method: 'DELETE', headers: p.as(a.org.id) });

    const summary = await read(await h.app.request('/v1/summaries/expenses', { headers: p.as(a.org.id) }));
    expect(summary).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      currencies: [
        {
          currency: 'ILS',
          total: '150.00',
          count: 2,
          byCategory: [
            { categoryId: cats[0].id, total: '100.00', count: 1 },
            { categoryId: null, total: '50.00', count: 1 },
          ],
          byCustomer: [
            { customerId: a.customer.id, total: '100.00', count: 1 },
            { customerId: null, total: '50.00', count: 1 },
          ],
        },
        { currency: 'USD', total: '20.00', count: 1, byCategory: [{ categoryId: null, total: '20.00', count: 1 }], byCustomer: [{ customerId: null, total: '20.00', count: 1 }] },
      ],
    });
  });

  it('takes an inclusive range and refuses an inverted one', async () => {
    const { h, a, p, create } = await setup();
    await create({ occurredOn: '2026-09-30', amount: '1.00' });
    await create({ occurredOn: '2026-10-01', amount: '2.00' });
    const ranged = await read(await h.app.request('/v1/summaries/expenses?from=2026-09-30&to=2026-09-30', { headers: p.as(a.org.id) }));
    expect(ranged.currencies.map((c: Loose) => c.total)).toEqual(['1.00']);
    const inverted = await h.app.request('/v1/summaries/expenses?from=2026-10-02&to=2026-10-01', { headers: p.as(a.org.id) });
    expect((await read(inverted)).error.details.reason).toBe('END_BEFORE_START');
  });
});

describe('audit', () => {
  it('records the person as USER on every expense, receipt and category write', async () => {
    const { h, a, p, create } = await setup();
    const e = await read(await create({}));
    await h.app.request(`/v1/expenses/${e.id}`, json({ notes: 'n' }, { ...p.as(a.org.id), 'if-match': '1' }, 'PATCH'));
    const r = await uploadReceipt(h, p.as(a.org.id), e.id);
    await h.app.request(`/v1/expenses/${e.id}/receipts/${r.id}`, { method: 'DELETE', headers: p.as(a.org.id) });
    await h.app.request('/v1/expense-categories', json({ name: 'Couriers' }, { ...p.as(a.org.id), ...idem() }));
    await h.app.request(`/v1/expenses/${e.id}`, { method: 'DELETE', headers: p.as(a.org.id) });
    const rows = (await h.store.audit.list(a.org.id, {}, { limit: 200, cursor: null })).items.filter((x) => x.entityType.startsWith('expense'));
    // Same-millisecond audit rows have no defined order (TD-040), so compare as a set.
    expect(rows.filter((x) => x.actorType === 'USER').map((x) => x.action).sort()).toEqual(
      ['expense.created', 'expense.updated', 'expense_receipt.added', 'expense_receipt.deleted', 'expense_category.created', 'expense.deleted'].sort(),
    );
    for (const x of rows.filter((x) => x.actorType === 'USER')) expect(x.actorId).toBe(p.userId);
  });
});
