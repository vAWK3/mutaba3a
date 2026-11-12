import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { CreateExpenseInput } from '../repositories/ports.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-589 (ADR-254): moving a saved expense, with its receipts, to another of the person's profiles. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-11-11T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** Fails the next `copy` or `remove` on demand, to drive the partial-failure paths. */
class FlakyStorage extends MemoryAttachmentStorage {
  failCopyAfter = Infinity;
  failRemove = false;
  readonly copied: Array<[string, string]> = [];
  override async copy(from: string, to: string): Promise<void> {
    if (this.copied.length >= this.failCopyAfter) throw new Error('GCS rewrite failed');
    this.copied.push([from, to]);
    return super.copy(from, to);
  }
  override async remove(key: string): Promise<void> {
    if (this.failRemove) throw new Error('GCS delete failed');
    return super.remove(key);
  }
}

function harness(opts: { billingGate?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  const storage = new FlakyStorage();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    attachments: storage,
    attachmentUrlTtlSeconds: 600,
    receiptUploadLimiter: new SlidingWindowRateLimiter(1_000),
    receiptsLibrary: true,
    billingGate: opts.billingGate ?? false,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, storage };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `xmove-${++ik}-${Math.random().toString(36).slice(2, 8)}` });
const keyOf = (url: string) => new URL(url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
const FILE = { filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 2048 };

/**
 * One person; A, their personal profile; O, a business profile they own (POST /v1/profiles); B, a firm they belong to
 * but don't own (admin-made); C, a profile they aren't on.
 */
async function setup(opts: { billingGate?: boolean } = {}) {
  const h = harness(opts);
  const email = `xmove${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Lina Haddad', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
  const userId = created.user.id as string;
  if (opts.billingGate) await h.store.billing.setTrialStart(userId, new Date(NOW.getTime() - 3 * DAY));
  const a = created.personalProfile.id as string;
  const b = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))).id as string;
  const c = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Elsewhere ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))).id as string;
  await h.app.request(`/admin/v1/users/${userId}/memberships`, json({ organizationId: b }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile: string = a, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });
  const o = (await read(await h.app.request('/v1/profiles', json({ name: `Studio ${++seq}`, type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, { ...as(), ...idem() })))).id as string;
  return { h, a, b, c, o, as, userId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function category(h: Harness, organizationId: string, name: string) {
  return h.store.expenseCategories.create(organizationId, { name, color: null }, NOW);
}

async function expense(s: Setup, organizationId: string, over: Partial<CreateExpenseInput> = {}) {
  return s.h.store.expenses.create(
    {
      organizationId,
      occurredOn: '2026-11-02',
      amountMinor: 11_700n,
      currency: 'ILS',
      title: 'Laptop stand',
      vendor: null,
      categoryId: null,
      customerId: null,
      projectId: null,
      notes: 'for the desk',
      createdByUserId: s.userId,
      vatTreatment: null,
      vatRateBasisPoints: null,
      netMinor: null,
      vatMinor: null,
      allocationNumber: null,
      ...over,
    },
    NOW,
  );
}

/** A READY receipt on the expense (MUT-44's upload), its object in storage. */
async function attach(s: Setup, profile: string, expenseId: string) {
  const started = await read(await s.h.app.request(`/v1/expenses/${expenseId}/receipts`, json(FILE, s.as(profile))));
  s.h.storage.put(keyOf(started.upload.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType }, new Uint8Array([7, 8, 9]));
  expect((await s.h.app.request(`/v1/expenses/${expenseId}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: s.as(profile) })).status).toBe(200);
  return (await s.h.store.expenseReceipts.getById(profile, started.receipt.id))!;
}

const preview = (s: Setup, from: string, expenseId: string, profileId: string) => s.h.app.request(`/v1/expenses/${expenseId}/move-preview?profileId=${profileId}`, { headers: s.as(from) });
const move = (s: Setup, from: string, expenseId: string, profileId: string, expectedVersion: number, key = idem()) =>
  s.h.app.request(`/v1/expenses/${expenseId}/move`, json({ profileId, expectedVersion }, { ...s.as(from), ...key }));

const reasonOf = async (res: Response) => (await read(res)).error.details?.reason;

describe('POST /v1/expenses/{id}/move (MUT-589)', () => {
  it('moves an expense with no receipts: same id, A loses it, O gains it, money unchanged', async () => {
    const s = await setup();
    const e = await expense(s, s.a);
    const res = await move(s, s.a, e.id, s.o, e.version);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.fromProfileId).toBe(s.a);
    expect(body.changes).toEqual([]);
    expect(body.expense).toMatchObject({ id: e.id, amount: '117.00', currency: 'ILS', occurredOn: '2026-11-02', title: 'Laptop stand', notes: 'for the desk', version: e.version + 1, receipts: [] });
    expect((await s.h.app.request(`/v1/expenses/${e.id}`, { headers: s.as() })).status).toBe(404);
    expect((await s.h.app.request(`/v1/expenses/${e.id}`, { headers: s.as(s.o) })).status).toBe(200);
  });

  it('moves the totals: A\'s expense summary drops it, O\'s gains it', async () => {
    const s = await setup();
    const e = await expense(s, s.a);
    const total = async (p: string) => read(await s.h.app.request('/v1/summaries/expenses?from=2026-11-01&to=2026-11-30', { headers: s.as(p) }));
    const before = JSON.stringify(await total(s.o));
    await move(s, s.a, e.id, s.o, e.version);
    expect(JSON.stringify(await total(s.o))).not.toBe(before);
    expect(JSON.stringify(await total(s.o))).toContain('117');
    expect(JSON.stringify(await total(s.a))).not.toContain('117');
  });

  it.each([1, 3])('moves %i receipt(s) with it: same ids, new keys on O, the old objects removed', async (n) => {
    const s = await setup();
    const e = await expense(s, s.a);
    const receipts = [];
    for (let i = 0; i < n; i++) receipts.push(await attach(s, s.a, e.id));
    const res = await move(s, s.a, e.id, s.o, e.version);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.expense.receipts.map((r: Loose) => r.id).sort()).toEqual(receipts.map((r) => r.id).sort());
    for (const r of receipts) {
      const moved = (await s.h.store.expenseReceipts.getById(s.o, r.id))!;
      expect(moved).toMatchObject({ expenseId: e.id, filingStatus: 'FILED', status: 'READY' });
      expect(moved.storageKey).toMatch(new RegExp(`^org/${s.o}/expense-receipts/${r.id}-[0-9a-f]{12}$`));
      expect(s.h.storage.contents.get(moved.storageKey)).toEqual(new Uint8Array([7, 8, 9]));
      expect(s.h.storage.objects.has(r.storageKey)).toBe(false);
      expect(await s.h.store.expenseReceipts.getById(s.a, r.id)).toBeNull();
    }
  });

  it('maps the category by name, clears the client, unlinks VAT on a non-firm target, and answers the changes it applied', async () => {
    const s = await setup();
    const hobby = await category(s.h, s.a, 'Hobby');
    await category(s.h, s.o, 'Other');
    const customer = await read(await s.h.app.request('/v1/customers', json({ name: 'Nour Legal' }, { ...s.as(), ...idem() })));
    const e = await expense(s, s.a, { categoryId: hobby.id, customerId: customer.id, vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1700, netMinor: 10_000n, vatMinor: 1_700n, allocationNumber: '123456789' });
    const res = await move(s, s.a, e.id, s.o, e.version);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.changes).toEqual([
      { field: 'category', from: 'Hobby', to: 'Other' },
      { field: 'client', from: 'Nour Legal', to: null },
      { field: 'vat', from: '17.00', to: null },
      { field: 'allocationNumber', from: '123456789', to: null },
    ]);
    const moved = (await s.h.store.expenses.getById(s.o, e.id))!;
    expect(moved).toMatchObject({ customerId: null, projectId: null, vatTreatment: null, netMinor: null, vatMinor: null, allocationNumber: null, amountMinor: 11_700n });
    expect((await s.h.store.expenseCategories.getById(s.o, moved.categoryId!))!.name).toBe('Other');
  });

  it('keeps VAT when the target is a firm', async () => {
    const s = await setup();
    await s.h.store.organizations.setFirm(s.o, { enabled: true, ownerUserIds: [s.userId] }, NOW, { actorId: null, requestId: null });
    const e = await expense(s, s.a, { vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1700, netMinor: 10_000n, vatMinor: 1_700n });
    const body = await read(await move(s, s.a, e.id, s.o, e.version));
    expect(body.changes).toEqual([]);
    expect((await s.h.store.expenses.getById(s.o, e.id))!).toMatchObject({ vatTreatment: 'STANDARD_RATED', vatMinor: 1_700n });
  });

  it('finds or creates the vendor on the target and keeps the typed vendor', async () => {
    const s = await setup();
    const vendor = await s.h.store.vendors.resolve({ organizationId: s.a, name: 'Office Depot', registrationNo: null, phone: null, email: null }, NOW);
    const e = await expense(s, s.a, { vendor: 'Office Depot', vendorId: vendor!.id });
    await move(s, s.a, e.id, s.o, e.version);
    const moved = (await s.h.store.expenses.getById(s.o, e.id))!;
    expect(moved.vendor).toBe('Office Depot');
    expect(moved.vendorId).not.toBeNull();
    expect(moved.vendorId).not.toBe(vendor!.id);
    expect((await s.h.store.vendors.getById(s.o, moved.vendorId!))!.canonicalName).toBe('Office Depot');
  });

  it('rewrites a receipt approval\'s category to the mapped one and keeps the rest as history', async () => {
    const s = await setup();
    const hobby = await category(s.h, s.a, 'Hobby');
    const other = await category(s.h, s.o, 'Other');
    const started = await read(await s.h.app.request('/v1/receipts/uploads', json(FILE, { ...s.as(), ...idem() })));
    s.h.storage.put(keyOf(started.upload.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType }, new Uint8Array([1]));
    await s.h.app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: s.as() });
    const approved = await read(await s.h.app.request(`/v1/receipts/${started.receipt.id}/approve`, json({ occurredOn: '2026-11-02', amount: '15.00', currency: 'ILS', categoryId: hobby.id }, { ...s.as(), ...idem() })));
    const res = await move(s, s.a, approved.expense.id, s.o, approved.expense.version);
    expect(res.status).toBe(200);
    expect((await s.h.store.expenseReceipts.getById(s.o, started.receipt.id))!.approved).toMatchObject({ categoryId: other.id, amountMinor: '1500', currency: 'ILS' });
  });

  it('drops the source\'s group marks (membership on the target follows the date)', async () => {
    const s = await setup();
    const e = await expense(s, s.a, { occurredOn: '2026-11-02' });
    const group = await s.h.store.expenseGroups.create({ organizationId: s.a, name: 'Trip to Amman', startOn: '2026-12-01', endOn: '2026-12-05', notes: null, createdByUserId: s.userId }, NOW);
    await s.h.store.expenseGroups.setOverride(s.a, group.id, e.id, 'included', NOW);
    await s.h.store.expenseGroups.create({ organizationId: s.o, name: 'November', startOn: '2026-11-01', endOn: '2026-11-30', notes: null, createdByUserId: s.userId }, NOW);
    const body = await read(await move(s, s.a, e.id, s.o, e.version));
    expect(body.changes).toEqual([{ field: 'groups', from: 'Trip to Amman', to: 'November' }]);
    expect(await s.h.store.expenseGroups.overridesForExpense(s.a, e.id)).toEqual([]);
    expect(await s.h.store.expenseGroups.overridesForExpense(s.o, e.id)).toEqual([]);
  });

  it('audits expense.moved_out on A and expense.moved_in on O, with the changes', async () => {
    const s = await setup();
    const e = await expense(s, s.a);
    await move(s, s.a, e.id, s.o, e.version);
    const out = (await s.h.store.audit.list(s.a, { action: 'expense.moved_out' }, { limit: 10, cursor: null })).items;
    const into = (await s.h.store.audit.list(s.o, { action: 'expense.moved_in' }, { limit: 10, cursor: null })).items;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ actorType: 'USER', actorId: s.userId, entityType: 'expense', entityId: e.id, metadata: { toProfileId: s.o, changes: [] } });
    expect(into).toHaveLength(1);
    expect(into[0]).toMatchObject({ actorType: 'USER', actorId: s.userId, entityId: e.id, metadata: { fromProfileId: s.a, changes: [] } });
  });

  it('the same Idempotency-Key twice moves once, with one pair of audit rows', async () => {
    const s = await setup();
    const e = await expense(s, s.a);
    await attach(s, s.a, e.id);
    const key = idem();
    const first = await move(s, s.a, e.id, s.o, e.version, key);
    const again = await move(s, s.a, e.id, s.o, e.version, key);
    expect(again.status).toBe(200);
    expect(await read(again)).toEqual(await read(first));
    expect(s.h.storage.copied).toHaveLength(1);
    expect((await s.h.store.audit.list(s.a, { action: 'expense.moved_out' }, { limit: 10, cursor: null })).items).toHaveLength(1);
  });

  describe('refusals', () => {
    it('422 SAME_PROFILE', async () => {
      const s = await setup();
      const e = await expense(s, s.a);
      const res = await move(s, s.a, e.id, s.a, e.version);
      expect(res.status).toBe(422);
      expect(await reasonOf(res)).toBe('SAME_PROFILE');
    });

    it('404 EXPENSE_NOT_FOUND for an unknown or deleted expense', async () => {
      const s = await setup();
      const unknown = await move(s, s.a, '00000000-0000-4000-8000-000000000589', s.o, 1);
      expect(unknown.status).toBe(404);
      expect(await reasonOf(unknown)).toBe('EXPENSE_NOT_FOUND');
      const e = await expense(s, s.a);
      await s.h.store.expenses.softDelete(s.a, e.id, NOW, 'unlink');
      expect((await move(s, s.a, e.id, s.o, e.version)).status).toBe(404);
    });

    it('404 PROFILE_NOT_FOUND for a profile the person isn\'t on', async () => {
      const s = await setup();
      const e = await expense(s, s.a);
      const res = await move(s, s.a, e.id, s.c, e.version);
      expect(res.status).toBe(404);
      expect(await reasonOf(res)).toBe('PROFILE_NOT_FOUND');
    });

    it('403 NOT_OWNER moving out of a profile the person belongs to but doesn\'t own', async () => {
      const s = await setup();
      const e = await expense(s, s.b);
      const res = await move(s, s.b, e.id, s.a, e.version);
      expect(res.status).toBe(403);
      expect(await reasonOf(res)).toBe('NOT_OWNER');
      expect(await s.h.store.expenses.getById(s.b, e.id)).not.toBeNull();
    });

    it('403 MALAFAT_PROFILE when either profile\'s writer of record is Malafat', async () => {
      const s = await setup();
      const key = await read(await s.h.app.request(`/admin/v1/organizations/${s.b}/api-keys`, json({ name: 'Malafat', scopes: ['integration:write'] }, admin)));
      await s.h.store.integrations.connect({ organizationId: s.b, provider: 'MALAFAT', externalTenantId: `tenant-${++seq}`, displayName: 'Firm', connectedByApiKeyId: key.apiKey.id, at: NOW });
      const e = await expense(s, s.a);
      const res = await move(s, s.a, e.id, s.b, e.version);
      expect(res.status).toBe(403);
      expect(await reasonOf(res)).toBe('MALAFAT_PROFILE');
    });

    it('409 VERSION_MISMATCH when expectedVersion is stale, and nothing is copied', async () => {
      const s = await setup();
      const e = await expense(s, s.a);
      await attach(s, s.a, e.id);
      const res = await move(s, s.a, e.id, s.o, e.version + 5);
      expect(res.status).toBe(409);
      expect(await read(res)).toMatchObject({ error: { details: { reason: 'VERSION_MISMATCH', currentVersion: e.version } } });
      expect(s.h.storage.copied).toEqual([]);
    });

    it('409 RECEIPT_NOT_READY while an upload on the expense is unfinished, and its copies are removed', async () => {
      const s = await setup();
      const e = await expense(s, s.a);
      await attach(s, s.a, e.id);
      await s.h.app.request(`/v1/expenses/${e.id}/receipts`, json(FILE, s.as()));
      const res = await move(s, s.a, e.id, s.o, e.version);
      expect(res.status).toBe(409);
      expect(await reasonOf(res)).toBe('RECEIPT_NOT_READY');
      for (const [, to] of s.h.storage.copied) expect(s.h.storage.objects.has(to)).toBe(false);
      expect(await s.h.store.expenses.getById(s.a, e.id)).not.toBeNull();
    });
  });

  describe('failures around the copies (ADR-228 D5, D8)', () => {
    it('a failed copy leaves the expense and its receipts on A, and removes the copies already made', async () => {
      const s = await setup();
      const e = await expense(s, s.a);
      const receipts = [await attach(s, s.a, e.id), await attach(s, s.a, e.id)];
      s.h.storage.failCopyAfter = 1;
      expect((await move(s, s.a, e.id, s.o, e.version)).status).toBe(500);
      expect(await s.h.store.expenses.getById(s.a, e.id)).toMatchObject({ version: e.version });
      for (const r of receipts) expect((await s.h.store.expenseReceipts.getById(s.a, r.id))!.storageKey).toBe(r.storageKey);
      expect(s.h.storage.objects.has(s.h.storage.copied[0]![1])).toBe(false);
    });

    it('a receipt filed onto the expense after the copies (R1) refuses with 409 VERSION_MISMATCH and removes only this move\'s copies', async () => {
      const s = await setup();
      const e = await expense(s, s.a);
      const first = await attach(s, s.a, e.id);
      const realMove = s.h.store.expenses.moveToProfile.bind(s.h.store.expenses);
      s.h.store.expenses.moveToProfile = async (params) => {
        await attach(s, s.a, e.id);
        return realMove(params);
      };
      const res = await move(s, s.a, e.id, s.o, e.version);
      expect(res.status).toBe(409);
      expect(await reasonOf(res)).toBe('VERSION_MISMATCH');
      expect(s.h.storage.objects.has(s.h.storage.copied[0]![1])).toBe(false);
      expect(s.h.storage.objects.has(first.storageKey)).toBe(true);
      expect(await s.h.store.expenses.getById(s.a, e.id)).not.toBeNull();
    });

    it('a failed delete of A\'s objects after the move still answers 200', async () => {
      const s = await setup();
      const e = await expense(s, s.a);
      await attach(s, s.a, e.id);
      s.h.storage.failRemove = true;
      expect((await move(s, s.a, e.id, s.o, e.version)).status).toBe(200);
      expect(await s.h.store.expenses.getById(s.o, e.id)).not.toBeNull();
    });
  });
});

describe('GET /v1/expenses/{id}/move-preview (MUT-589)', () => {
  it('lists the changes, the receipt count and the version; the move then applies the same changes', async () => {
    const s = await setup();
    const hobby = await category(s.h, s.a, 'Hobby');
    const e = await expense(s, s.a, { categoryId: hobby.id });
    await attach(s, s.a, e.id);
    const res = await preview(s, s.a, e.id, s.o);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toEqual({ changes: [{ field: 'category', from: 'Hobby', to: null }], receiptCount: 1, expenseVersion: e.version });
    const moved = await read(await move(s, s.a, e.id, s.o, body.expenseVersion));
    expect(moved.changes).toEqual(body.changes);
    // A preview creates nothing on the target (the vendor is only resolved by the move).
    expect(s.h.storage.copied).toHaveLength(1);
  });

  it('runs the move\'s gates: same profile, not a member, not the owner', async () => {
    const s = await setup();
    const e = await expense(s, s.a);
    expect(await reasonOf(await preview(s, s.a, e.id, s.a))).toBe('SAME_PROFILE');
    expect(await reasonOf(await preview(s, s.a, e.id, s.c))).toBe('PROFILE_NOT_FOUND');
    const firmExpense = await expense(s, s.b);
    expect(await reasonOf(await preview(s, s.b, firmExpense.id, s.a))).toBe('NOT_OWNER');
  });
});

describe('the lapse gate on an expense move (MUT-589, D2)', () => {
  it('refuses a read-only target with 402 SUBSCRIPTION_LAPSED; the expense stays', async () => {
    const s = await setup({ billingGate: true });
    const e = await expense(s, s.a);
    // B is a firm with no plan and no Malafat link: read-only under the gate. Move into it is refused; out of A is fine.
    const res = await move(s, s.a, e.id, s.b, e.version);
    expect(res.status).toBe(402);
    expect((await read(res)).error.code).toBe('SUBSCRIPTION_LAPSED');
    expect(await s.h.store.expenses.getById(s.a, e.id)).not.toBeNull();
    expect((await preview(s, s.a, e.id, s.b)).status).toBe(402);
  });
});
