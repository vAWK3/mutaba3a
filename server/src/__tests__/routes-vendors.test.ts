import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-254 (ADR-183): every expense writer links the typed vendor; GET /v1/vendors suggests the profile's vendors. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function setup() {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-24T09:00:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    attachments: new MemoryAttachmentStorage(),
    attachmentUrlTtlSeconds: 600,
    receiptsLibrary: true,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  const firm = async () => {
    const org = await read(await app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
    const key = await read(await app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
    return { id: org.id as string, auth: { authorization: `Bearer ${key.secret}` } };
  };
  const a = await firm();
  const b = await firm();
  const email = `vendor${++seq}@firm.ps`;
  const created = await provisionUser(app, { email, displayName: 'Nour Haddad', organizationId: a.id });
  await app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId: b.id }, admin));
  const res = await app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile = a.id) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN });
  const userId = created.user.id as string;

  const create = async (body: Record<string, unknown>, profile = a.id) => {
    const r = await app.request('/v1/expenses', json({ occurredOn: '2026-10-20', amount: '12.00', currency: 'ILS', ...body }, { ...as(profile), ...idem() }));
    expect(r.status).toBe(201);
    return read(r);
  };
  const patch = (expense: Loose, body: Record<string, unknown>) => app.request(`/v1/expenses/${expense.id}`, json(body, { ...as(), 'if-match': String(expense.version) }, 'PATCH'));
  const category = async (name: string, profile = a.id) => read(await app.request('/v1/expense-categories', json({ name }, { ...as(profile), ...idem() })));
  const suggest = async (q: string, profile = a.id) => (await read(await app.request(`/v1/vendors?q=${encodeURIComponent(q)}`, { headers: as(profile) }))).items as Loose[];
  return { app, store, clock, a, b, as, userId, create, patch, category, suggest };
}

describe('the expense writers link the typed vendor (MUT-254)', () => {
  it('POST /v1/expenses: a new vendor is created once; another spelling of it reuses it; the vendor text stays as typed', async () => {
    const { create, suggest } = await setup();
    const first = await create({ vendor: 'Super Deal Ltd' });
    const second = await create({ vendor: 'super  deal' });
    expect(first.vendorId).toEqual(expect.any(String));
    expect(second.vendorId).toBe(first.vendorId);
    expect(second.vendor).toBe('super  deal');
    expect((await create({})).vendorId).toBeNull();
    expect(await suggest('super')).toEqual([{ id: first.vendorId, name: 'Super Deal Ltd', matchedName: 'Super Deal Ltd', registrationNo: null, phone: null, email: null, lastCategoryId: null }]);
  });

  it('vendorDetails: a matching registration number reuses the vendor under another name, which becomes an alias', async () => {
    const { create, suggest } = await setup();
    const cab = await create({ vendor: 'Yellow Cab', vendorDetails: { registrationNo: '516667276', phone: '+970 2 555 0100' } });
    const taxi = await create({ vendor: 'Yellow Taxi', vendorDetails: { registrationNo: '51-666-7276' } });
    expect(taxi.vendorId).toBe(cab.vendorId);
    expect(await suggest('taxi')).toEqual([expect.objectContaining({ id: cab.vendorId, name: 'Yellow Cab', matchedName: 'Yellow Taxi', registrationNo: '516667276', phone: '+970 2 555 0100' })]);
  });

  it('PATCH: a new vendor re-links, null unlinks, and a patch that names neither vendor nor category leaves the link and the default alone', async () => {
    const { create, patch, category, suggest } = await setup();
    const travel = await category('Travel');
    const expense = await create({ vendor: 'Cafe' });
    const moved = await read(await patch(expense, { vendor: 'Bakery' }));
    expect(moved.vendorId).not.toBe(expense.vendorId);
    expect(moved.vendorId).toEqual(expect.any(String));
    const categorised = await read(await patch(moved, { categoryId: travel.id }));
    expect(categorised.vendorId).toBe(moved.vendorId);
    expect((await suggest('bakery'))[0].lastCategoryId).toBe(travel.id);
    const noted = await read(await patch(categorised, { notes: 'x' }));
    expect(noted.vendorId).toBe(moved.vendorId);
    const cleared = await read(await patch(noted, { vendor: null }));
    expect(cleared).toMatchObject({ vendor: null, vendorId: null });
  });

  it('a refused write moves no default: a stale PATCH and an archived category leave lastCategoryId as it was', async () => {
    const { app, as, create, patch, category, suggest } = await setup();
    const travel = await category('Travel');
    const food = await category('Food');
    const expense = await create({ vendor: 'Cafe', categoryId: travel.id });
    expect((await suggest('cafe'))[0].lastCategoryId).toBe(travel.id);
    expect((await patch({ ...expense, version: 99 }, { categoryId: food.id })).status).toBe(409);
    await app.request(`/v1/expense-categories/${food.id}`, json({ archived: true }, { ...as(), 'if-match': String(food.version) }, 'PATCH'));
    expect((await create({ vendor: 'Cafe', categoryId: food.id }).catch(() => null))).toBeNull();
    expect((await suggest('cafe'))[0].lastCategoryId).toBe(travel.id);
  });

  it('the automatic Other never becomes a vendor’s default', async () => {
    const { create, category, suggest } = await setup();
    const travel = await category('Travel');
    const other = await category('Other');
    await create({ vendor: 'Cafe', categoryId: travel.id });
    await create({ vendor: 'Cafe', categoryId: other.id });
    expect((await suggest('cafe'))[0].lastCategoryId).toBe(travel.id);
  });

  it('inbox file-as-expense links the vendor', async () => {
    const { app, store, clock, as, userId, category, suggest } = await setup();
    const travel = await category('Travel');
    const entry = await store.inboxEntries.create({ userId, kind: 'EXPENSE', amountMinor: 1_200n, currency: 'ILS', occurredOn: '2026-10-20', note: 'Parking', captureSource: null }, clock.now);
    const res = await app.request(`/v1/inbox/${entry.id}/file-as-expense`, json({ vendor: 'City Parking', categoryId: travel.id, vendorDetails: { email: 'pay@parking.test' } }, { ...as(), ...idem() }));
    expect(res.status).toBe(201);
    const filed = await read(res);
    expect(filed.vendorId).toEqual(expect.any(String));
    expect((await suggest('parking'))[0]).toMatchObject({ id: filed.vendorId, email: 'pay@parking.test', lastCategoryId: travel.id });
  });

  it('receipt approve links the vendor, and a replay finds the same one', async () => {
    const { app, store, clock, a, as, userId, suggest } = await setup();
    const receipt = await store.expenseReceipts.create({ organizationId: a.id, expenseId: null, filename: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 10, receivedOn: '2026-10-24', uploadedByUserId: userId, requestId: null }, clock.now);
    await store.expenseReceipts.setKey(a.id, receipt.id, `org/${a.id}/expense-receipts/${receipt.id}`);
    await store.expenseReceipts.complete(a.id, receipt.id, clock.now);
    const key = idem();
    const body = { occurredOn: '2026-10-22', amount: '15.00', currency: 'ILS', vendor: 'مخبز الأقصى', vendorDetails: { registrationNo: '٥١٦٦٦٧٢٧٦' } };
    const first = await read(await app.request(`/v1/receipts/${receipt.id}/approve`, json(body, { ...as(), ...key })));
    expect(first.expense.vendorId).toEqual(expect.any(String));
    const replay = await read(await app.request(`/v1/receipts/${receipt.id}/approve`, json(body, { ...as(), ...key })));
    expect(replay.expense.vendorId).toBe(first.expense.vendorId);
    expect((await suggest('مخبز الاقصى')).map((s) => s.id)).toEqual([first.expense.vendorId]);
  });
});

describe('GET /v1/vendors (MUT-254)', () => {
  it('suggests in Arabic, Hebrew and Latin: prefix, then contains, then a near-miss', async () => {
    const { create, suggest } = await setup();
    const bakery = await create({ vendor: 'مخبز الأقصى' });
    const pharmacy = await create({ vendor: 'صيدلية المخبز' });
    const deal = await create({ vendor: 'סופר דיל בע״מ' });
    const dell = await create({ vendor: 'Supr Dell' });
    expect((await suggest('مخبز')).map((s) => s.id)).toEqual([bakery.vendorId, pharmacy.vendorId]);
    expect((await suggest('דיל')).map((s) => s.id)).toEqual([deal.vendorId]);
    expect((await suggest('Super Dell')).map((s) => s.id)).toContain(dell.vendorId);
  });

  it('an empty query lists the most recently used first', async () => {
    const { clock, create, suggest } = await setup();
    const older = await create({ vendor: 'Old Shop' });
    clock.now = new Date('2026-10-24T10:00:00Z');
    const newer = await create({ vendor: 'New Shop' });
    clock.now = new Date('2026-10-24T11:00:00Z');
    await create({ vendor: 'old shop' });
    expect((await suggest('')).map((s) => s.id)).toEqual([older.vendorId, newer.vendorId]);
  });

  it('never lists another profile’s vendors', async () => {
    const { b, create, suggest } = await setup();
    await create({ vendor: 'Secret Supplier' });
    expect(await suggest('secret', b.id)).toEqual([]);
    expect(await suggest('', b.id)).toEqual([]);
  });

  it('caps limit at 25 and refuses Malafat’s key', async () => {
    const { app, a, as } = await setup();
    expect((await app.request('/v1/vendors?limit=26', { headers: as() })).status).toBe(422);
    const keyed = await app.request('/v1/vendors', { headers: a.auth });
    expect(keyed.status).toBe(403);
    expect((await read(keyed)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });
});
