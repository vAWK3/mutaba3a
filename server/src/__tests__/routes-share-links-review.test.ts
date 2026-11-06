import { describe, expect, it } from 'vitest';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { SHARE_LINK_SUMMARY_POLICY } from '../share-links/links.js';
import { ADMIN, DAY, businessOf, idem, json, person, read, type AccountantHarness, type Loose, type Person } from './helpers/accountants.js';
import { entriesOf, linkOn, listLinks, publicPost, receiptsOf, shareLinkHarness, summaryOf, unlock, viewerOf } from './helpers/share-links.js';

/**
 * MUT-560 review follow-up (ADR-246 as amended): a stale re-unlock never takes a slot; receipt URLs live at most a
 * minute and never past the viewer's access; visitor payloads carry names, never other entities' ids; a per-IP budget
 * on the view routes and a tighter one on the summary; a co-owner closing keeps the profile's links; a cursor from
 * elsewhere never widens the range.
 */
const HOUR = 3_600_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const later = (h: AccountantHarness, ms: number) => h.setNow(new Date(h.now().getTime() + ms));
/** The answer with signed URLs taken out: their object key is the storage's own path, not a field the page reads. */
const withoutUrls = (body: unknown) => JSON.stringify(body, (key, value) => (key === 'url' ? undefined : value));

async function expenseAt(h: AccountantHarness, p: Person, profileId: string, body: Record<string, unknown>): Promise<Loose> {
  const res = await h.app.request('/v1/expenses', json({ amount: '12.00', currency: 'ILS', occurredOn: '2026-10-10', ...body }, { ...p.on(profileId), ...idem() }));
  if (res.status !== 201) throw new Error(`expense failed: ${res.status} ${await res.text()}`);
  return read(res);
}

async function withReceipt(h: AccountantHarness, storage: MemoryAttachmentStorage, p: Person, profileId: string, occurredOn = '2026-10-10') {
  const expense = await expenseAt(h, p, profileId, { occurredOn, title: 'with receipt' });
  const started = await read(await h.app.request(`/v1/expenses/${expense.id}/receipts`, json({ filename: 'cafe.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 }, p.on(profileId))));
  storage.put(new URL(started.upload.url).pathname.replace(/^\/+/, '').replace(/^upload\//, ''), { sizeBytes: 2048, contentType: 'image/jpeg' });
  expect((await h.app.request(`/v1/expenses/${expense.id}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: p.on(profileId) })).status).toBe(200);
  return expense;
}

describe('a stale re-unlock (review 1)', () => {
  it('two parallel re-unlocks with one old token at 3 viewers: one renews, the other 409 SHARE_LINK_STALE_VIEWER; never VIEWER_LIMIT', async () => {
    const h = shareLinkHarness();
    const owner = await person(h);
    const link = await linkOn(h, owner, owner.personalId);
    const old = await viewerOf(h, link.token);
    await viewerOf(h, link.token);
    await viewerOf(h, link.token);
    const results = await Promise.all([unlock(h, link.token, '2468', old), unlock(h, link.token, '2468', old)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const refused = await read(results.find((r) => r.status === 409)!);
    expect(refused.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'SHARE_LINK_STALE_VIEWER' } });
    expect((await listLinks(h, owner, owner.personalId)).items[0].viewers).toBe(3);
  });
});

describe('receipt URLs (review 2)', () => {
  async function opened(h: AccountantHarness, storage: MemoryAttachmentStorage, expiresInDays = 7) {
    const owner = await person(h);
    await withReceipt(h, storage, owner, owner.personalId);
    const link = await linkOn(h, owner, owner.personalId, { expiresInDays });
    return { owner, link };
  }
  const firstKey = async (h: AccountantHarness, viewer: string) => (await read(await entriesOf(h, viewer))).items[0].expense.key as string;

  it('never outlive the viewer’s access: 30 s left → a 30 s URL', async () => {
    const storage = new MemoryAttachmentStorage();
    const h = shareLinkHarness({ attachments: storage });
    const { link } = await opened(h, storage);
    const viewer = await viewerOf(h, link.token);
    const key = await firstKey(h, viewer);
    later(h, 8 * HOUR - 30_000);
    const { items } = await read(await receiptsOf(h, viewer, key));
    expect(new Date(items[0].expiresAt).getTime() - h.now().getTime()).toBe(30_000);
  });

  it('never outlive the link: 20 s before a 1-day link ends → a 20 s URL', async () => {
    const storage = new MemoryAttachmentStorage();
    const h = shareLinkHarness({ attachments: storage });
    const { link } = await opened(h, storage, 1);
    later(h, DAY - 4 * HOUR);
    const viewer = await viewerOf(h, link.token);
    const key = await firstKey(h, viewer);
    later(h, 4 * HOUR - 20_000);
    const { items } = await read(await receiptsOf(h, viewer, key));
    expect(items[0].expiresAt).toBe(link.expiresAt);
  });

  it('with only seconds left the receipts answer the uniform 404', async () => {
    const storage = new MemoryAttachmentStorage();
    const h = shareLinkHarness({ attachments: storage });
    const { link } = await opened(h, storage);
    const viewer = await viewerOf(h, link.token);
    const key = await firstKey(h, viewer);
    later(h, 8 * HOUR - 2_000);
    const res = await receiptsOf(h, viewer, key);
    expect(res.status).toBe(404);
    expect((await read(res)).error.details).toEqual({ reason: 'SHARE_LINK_UNAVAILABLE' });
  });
});

describe('visitor payloads carry names, never ids (review 3)', () => {
  it('category (in the request language), client, vendor and project by name; no UUID anywhere but signed URLs', async () => {
    const storage = new MemoryAttachmentStorage();
    const h = shareLinkHarness({ attachments: storage });
    const owner = await person(h, { displayName: 'Basel Sader' });
    const business = await businessOf(h, owner, 'Sader Studio');
    const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad Trading' }, { ...owner.on(business), ...idem() })));
    const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Lawsuit', currency: 'ILS' }, { ...owner.on(business), ...idem() })));
    const categories = (await read(await h.app.request('/v1/expense-categories', { headers: { ...owner.on(business), 'accept-language': 'en' } }))).items as Loose[];
    const travel = categories.find((c) => c.presetKey !== null)!;
    await expenseAt(h, owner, business, { title: 'Court fee', vendor: 'Ministry', categoryId: travel.id, customerId: customer.id, projectId: project.id });
    await h.app.request('/v1/income', json({ kind: 'received', amount: '300.00', currency: 'ILS', occurredOn: '2026-10-12', customerId: customer.id }, { ...owner.on(business), ...idem() }));
    await h.app.request('/v1/conversions', json({ amount: '10.00', currency: 'USD', toAmount: '36.00', toCurrency: 'ILS', occurredOn: '2026-10-13' }, { ...owner.on(business), ...idem() }));
    await withReceipt(h, storage, owner, business, '2026-10-14');
    const link = await linkOn(h, owner, business);

    const unlocked = await read(await unlock(h, link.token, '2468'));
    const viewer = unlocked.viewerToken as string;
    const arEntries = await read(await publicPost(h, 'entries', { viewerToken: viewer }, { 'accept-language': 'ar' }));
    const enEntries = await read(await publicPost(h, 'entries', { viewerToken: viewer }, { 'accept-language': 'en' }));
    const expense = enEntries.items.find((e: Loose) => e.kind === 'expense' && e.expense.title === 'Court fee').expense;
    expect(expense).toMatchObject({ category: travel.name, client: 'Haddad Trading', project: 'Lawsuit', vendor: 'Ministry' });
    const arExpense = arEntries.items.find((e: Loose) => e.kind === 'expense' && e.expense.title === 'Court fee').expense;
    expect(arExpense.category).toMatch(/[؀-ۿ]/);
    const received = enEntries.items.find((e: Loose) => e.kind === 'received');
    expect(received.income).toMatchObject({ client: 'Haddad Trading' });
    expect(received).not.toHaveProperty('settlesOwedId');
    expect(received).not.toHaveProperty('replacesPaymentId');
    for (const field of ['customerId', 'vendorId', 'categoryId', 'projectId', 'id']) expect(expense).not.toHaveProperty(field);

    const summary = await read(await publicPost(h, 'summary', { viewerToken: viewer }, { 'accept-language': 'en' }));
    const ils = summary.expenses.find((b: Loose) => b.currency === 'ILS');
    expect(ils.byCategory).toContainEqual({ category: travel.name, total: '12.00', count: 1 });
    expect(ils.byClient).toContainEqual({ client: 'Haddad Trading', total: '12.00', count: 1 });

    const withReceiptRow = enEntries.items.find((e: Loose) => e.kind === 'expense' && e.expense.receiptCount === 1).expense;
    const receipts = await read(await receiptsOf(h, viewer, withReceiptRow.key));
    expect(receipts.items).toHaveLength(1);

    for (const body of [unlocked, arEntries, enEntries, summary, receipts]) expect(withoutUrls(body)).not.toMatch(UUID);
  });
});

describe('budgets (reviews 4 and 5)', () => {
  it('the view routes have a per-IP budget, spent before the viewer token is even looked up', async () => {
    const h = shareLinkHarness({ shareLinkViewIpLimiter: new SlidingWindowRateLimiter(2) });
    const owner = await person(h);
    const viewer = await viewerOf(h, (await linkOn(h, owner, owner.personalId)).token);
    expect((await entriesOf(h, 'Z'.repeat(43))).status).toBe(404);
    expect((await entriesOf(h, viewer)).status).toBe(200);
    const limited = await entriesOf(h, viewer);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await entriesOf(h, 'Y'.repeat(43))).status).toBe(429);
  });

  it(`the summary has its own tighter per-viewer budget (${SHARE_LINK_SUMMARY_POLICY.perViewerPerMinute} a minute)`, async () => {
    const h = shareLinkHarness();
    const owner = await person(h);
    const viewer = await viewerOf(h, (await linkOn(h, owner, owner.personalId, { period: 'WHOLE_PROFILE' })).token);
    for (let i = 0; i < SHARE_LINK_SUMMARY_POLICY.perViewerPerMinute; i++) expect((await summaryOf(h, viewer)).status).toBe(200);
    expect((await summaryOf(h, viewer)).status).toBe(429);
    expect((await entriesOf(h, viewer)).status).toBe(200);
    later(h, 61_000);
    expect((await summaryOf(h, viewer)).status).toBe(200);
  });
});

describe('owners closing (review 6)', () => {
  it('a co-owner closing their account keeps the profile’s links working: the profile lives on with its creator', async () => {
    const h = shareLinkHarness();
    const owner = await person(h, { displayName: 'Basel Sader' });
    const business = await businessOf(h, owner, 'Sader Studio');
    const co = await person(h, { displayName: 'Rana Co-owner' });
    expect((await h.app.request(`/admin/v1/users/${co.userId}/memberships`, json({ organizationId: business, role: 'OWNER' }, ADMIN))).status).toBe(201);
    const byCo = await linkOn(h, co, business);
    const byOwner = await linkOn(h, owner, business);
    const viewer = await viewerOf(h, byCo.token);
    expect((await h.app.request('/v1/me/closure', json({ password: co.password }, co.auth))).status).toBe(200);
    expect((await entriesOf(h, viewer)).status).toBe(200);
    expect((await unlock(h, byOwner.token, '2468')).status).toBe(200);
  });
});

describe('cursors (review 7)', () => {
  it('a cursor taken from another profile’s feed never brings in a row outside the link’s profile and range', async () => {
    const h = shareLinkHarness();
    const owner = await person(h);
    const other = await businessOf(h, owner, 'Other Studio');
    for (const day of ['2026-10-05', '2026-10-20']) await expenseAt(h, owner, owner.personalId, { occurredOn: day, title: `shared ${day}` });
    for (const day of ['2026-10-25', '2026-10-15', '2026-09-15', '2026-11-03']) await expenseAt(h, owner, other, { occurredOn: day, title: `private ${day}` });
    const foreign = await read(await h.app.request(`/v1/entries?order=occurredOn&limit=1&profileId=${other}`, { headers: owner.auth }));
    expect(foreign.nextCursor).toEqual(expect.any(String));
    const viewer = await viewerOf(h, (await linkOn(h, owner, owner.personalId)).token);
    const page = await read(await entriesOf(h, viewer, { cursor: foreign.nextCursor }));
    expect(page.items.map((e: Loose) => e.expense.title)).toEqual(['shared 2026-10-20', 'shared 2026-10-05']);
    const loggedOrder = await read(await h.app.request('/v1/entries?limit=1', { headers: owner.auth }));
    expect((await entriesOf(h, viewer, { cursor: loggedOrder.nextCursor })).status).toBe(422);
  });
});
