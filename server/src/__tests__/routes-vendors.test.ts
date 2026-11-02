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
    // What saves as this vendor says so, however it is written.
    expect((await suggest('SUPER DEAL, inc.'))[0]).toMatchObject({ id: first.vendorId, exact: true });
    expect(await suggest('super')).toEqual([{ id: first.vendorId, name: 'Super Deal Ltd', matchedName: 'Super Deal Ltd', exact: false, registrationNo: null, phone: null, email: null, lastCategoryId: null, lastCurrency: 'ILS', lastVat: null }]);
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

  it('a failed touch never fails the saved expense (a 5xx would release the Idempotency-Key and a retry duplicate it)', async () => {
    const { store, create } = await setup();
    store.vendors.touch = async () => {
      throw new Error('lock timeout');
    };
    const saved = await create({ vendor: 'Cafe' });
    expect(saved.vendorId).toEqual(expect.any(String));
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

/** MUT-303 (ADR-099 §6.2): a vendor learns the currency and VAT of its expenses, and offers them back. */
describe('vendor defaults: currency and VAT (MUT-303)', () => {
  const vat16 = { treatment: 'STANDARD_RATED', rateBasisPoints: 1600 };
  const firmOn = async (s: Awaited<ReturnType<typeof setup>>) =>
    s.store.organizations.setFirm(s.a.id, { enabled: true, ownerUserIds: [s.userId] }, s.clock.now, { actorId: null, requestId: null });

  it('a new expense teaches its vendor the currency and the VAT; the typeahead offers them', async () => {
    const s = await setup();
    await firmOn(s);
    await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '116.00', vat: vat16 });
    expect((await s.suggest('bezeq'))[0]).toMatchObject({ lastCurrency: 'EUR', lastVat: vat16 });
  });

  it('a vendor never saved with a currency or VAT offers neither', async () => {
    const s = await setup();
    await s.store.vendors.resolve({ organizationId: s.a.id, name: 'Fresh Vendor' }, s.clock.now);
    expect((await s.suggest('fresh'))[0]).toMatchObject({ lastCurrency: null, lastVat: null });
  });

  it('AC2: a changed value on the next expense becomes the new default', async () => {
    const s = await setup();
    await firmOn(s);
    await s.create({ vendor: 'Bezeq', currency: 'ILS', amount: '117.00', vat: { treatment: 'STANDARD_RATED', rateBasisPoints: 1700 } });
    await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '116.00', vat: vat16 });
    expect((await s.suggest('bezeq'))[0]).toMatchObject({ lastCurrency: 'EUR', lastVat: vat16 });
  });

  it('D1: a save without VAT keeps the vendor’s VAT default', async () => {
    const s = await setup();
    await firmOn(s);
    await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '116.00', vat: vat16 });
    await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '20.00' });
    expect((await s.suggest('bezeq'))[0].lastVat).toEqual(vat16);
  });

  it('D1: removing VAT clears the default only while it is still that VAT', async () => {
    const s = await setup();
    await firmOn(s);
    const old = await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '117.00', vat: { treatment: 'STANDARD_RATED', rateBasisPoints: 1700 } });
    const latest = await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '116.00', vat: vat16 });
    expect((await s.patch(old, { vat: null })).status).toBe(200);
    expect((await s.suggest('bezeq'))[0].lastVat).toEqual(vat16);
    expect((await s.patch(latest, { vat: null })).status).toBe(200);
    expect((await s.suggest('bezeq'))[0].lastVat).toBeNull();
  });

  it('R8: an edit that resends the vendor but changes no currency leaves the currency default alone', async () => {
    const s = await setup();
    const old = await s.create({ vendor: 'Bezeq', currency: 'ILS' });
    await s.create({ vendor: 'Bezeq', currency: 'EUR' });
    expect((await s.patch(old, { title: 'Fixed typo', vendor: 'Bezeq' })).status).toBe(200);
    expect((await s.suggest('bezeq'))[0].lastCurrency).toBe('EUR');
  });

  it('D2: a PATCH that changes the currency teaches it', async () => {
    const s = await setup();
    const expense = await s.create({ vendor: 'Bezeq', currency: 'ILS' });
    expect((await s.patch(expense, { currency: 'USD', amount: '12.00' })).status).toBe(200);
    expect((await s.suggest('bezeq'))[0].lastCurrency).toBe('USD');
  });

  it('review: a PATCH that resends an unchanged VAT teaches nothing', async () => {
    const s = await setup();
    await firmOn(s);
    const old = await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '117.00', vat: { treatment: 'STANDARD_RATED', rateBasisPoints: 1700 } });
    await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '116.00', vat: vat16 });
    expect((await s.patch(old, { vat: { treatment: 'STANDARD_RATED', rateBasisPoints: 1700 }, title: 'Same VAT' })).status).toBe(200);
    expect((await s.suggest('bezeq'))[0].lastVat).toEqual(vat16);
  });

  it('R10 (review): off firm profiles the typeahead offers the currency but never VAT', async () => {
    const s = await setup();
    await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '116.00', vat: vat16 });
    expect((await s.suggest('bezeq'))[0]).toMatchObject({ lastCurrency: 'EUR', lastVat: null });
  });

  it('AC3: one profile’s vendor never offers its defaults to another profile', async () => {
    const s = await setup();
    await s.create({ vendor: 'Bezeq', currency: 'EUR' });
    await s.create({ vendor: 'Bezeq', currency: 'USD' }, s.b.id);
    expect((await s.suggest('bezeq'))[0].lastCurrency).toBe('EUR');
    expect((await s.suggest('bezeq', s.b.id))[0].lastCurrency).toBe('USD');
  });

  describe('GET /v1/receipts/{id}: vendorDefaults (D6)', () => {
    const toReview = async (s: Awaited<ReturnType<typeof setup>>, suggested: Loose = null, profile = s.a.id) => {
      const receipt = await s.store.expenseReceipts.create({ organizationId: profile, expenseId: null, filename: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 10, receivedOn: '2026-10-24', suggested, uploadedByUserId: s.userId, requestId: null }, s.clock.now);
      await s.store.expenseReceipts.setKey(profile, receipt.id, `org/${profile}/expense-receipts/${receipt.id}`);
      await s.store.expenseReceipts.complete(profile, receipt.id, s.clock.now);
      return receipt;
    };
    const getReceipt = async (s: Awaited<ReturnType<typeof setup>>, id: string, profile = s.a.id) => read(await s.app.request(`/v1/receipts/${id}`, { headers: s.as(profile) }));
    const regNo = (value: string) => ({ value, source: 'ocr', confidence: 0.9 });

    it('AC1: after two approved receipts from one registration no., the third opens with that vendor’s currency and VAT', async () => {
      const s = await setup();
      await firmOn(s);
      for (const amount of ['116.00', '232.00']) {
        const r = await toReview(s);
        const res = await s.app.request(`/v1/receipts/${r.id}/approve`, json({ occurredOn: '2026-10-22', amount, currency: 'EUR', vendor: 'Bezeq', vendorDetails: { registrationNo: '520031931' }, vat: vat16 }, { ...s.as(), ...idem() }));
        expect(res.status).toBe(201);
      }
      const third = await toReview(s, { readerVersion: 'test', registrationNo: regNo('52-003193-1') });
      expect((await getReceipt(s, third.id)).vendorDefaults).toMatchObject({ vendorId: expect.any(String), currency: 'EUR', vat: vat16 });
    });

    it('matches by the exact vendor name when no registration no. was read', async () => {
      const s = await setup();
      await s.create({ vendor: 'مخبز الأقصى', currency: 'JOD', amount: '1.250' });
      const r = await toReview(s, { readerVersion: 'test', vendorName: { value: 'مخبز الاقصى', source: 'ocr', confidence: 0.8 } });
      expect((await getReceipt(s, r.id)).vendorDefaults).toMatchObject({ currency: 'JOD', vat: null });
    });

    it('is null when nothing was read, or nothing matches', async () => {
      const s = await setup();
      await s.create({ vendor: 'Bezeq', currency: 'EUR' });
      expect((await getReceipt(s, (await toReview(s)).id)).vendorDefaults).toBeNull();
      const unknown = await toReview(s, { readerVersion: 'test', vendorName: { value: 'Somebody Else', source: 'ocr', confidence: 0.8 } });
      expect((await getReceipt(s, unknown.id)).vendorDefaults).toBeNull();
    });

    it('R10: a profile without firm features gets the currency but never the VAT', async () => {
      const s = await setup();
      await firmOn(s);
      await s.create({ vendor: 'Bezeq', currency: 'EUR', amount: '116.00', vat: vat16 });
      await s.store.organizations.setFirm(s.a.id, { enabled: false }, s.clock.now, { actorId: null, requestId: null });
      const r = await toReview(s, { readerVersion: 'test', vendorName: { value: 'Bezeq', source: 'ocr', confidence: 0.8 } });
      expect((await getReceipt(s, r.id)).vendorDefaults).toMatchObject({ currency: 'EUR', vat: null });
    });

    it('never writes the vendor’s values into what the reader read (R1)', async () => {
      const s = await setup();
      await s.create({ vendor: 'Bezeq', currency: 'EUR' });
      const suggested = { readerVersion: 'test', vendorName: { value: 'Bezeq', source: 'ocr', confidence: 0.8 }, totalMinor: { value: '1234', source: 'ocr', confidence: 0.7 } };
      const r = await toReview(s, suggested);
      const got = await getReceipt(s, r.id);
      expect(got.suggested.currency).toBeUndefined();
      expect(got.suggested.totalMinor.value).toBe('1234');
    });
  });
});
