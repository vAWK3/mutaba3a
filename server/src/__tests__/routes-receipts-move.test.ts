import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-503: moving a To-review receipt to another of the person's profiles (ADR-228). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-10-29T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** Fails the next `copy` or `remove` on demand, to drive the partial-failure paths. */
class FlakyStorage extends MemoryAttachmentStorage {
  failCopy = false;
  failRemove = false;
  readonly copied: Array<[string, string]> = [];
  override async copy(from: string, to: string): Promise<void> {
    if (this.failCopy) throw new Error('GCS rewrite failed');
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

const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `move-${++ik}-${Math.random().toString(36).slice(2, 8)}` });
const keyOf = (url: string) => new URL(url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
const FILE = { filename: 'cafe.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 };
const SUGGESTION = { readerVersion: 'phone-1.0', date: { value: '2026-10-28', source: 'ocr', confidence: 0.9 }, totalMinor: { value: '1500', source: 'ocr', confidence: 0.8 } };

/** One person, a personal profile A, a second profile B they belong to, and a profile C they don't. */
async function setup(opts: { billingGate?: boolean } = {}) {
  const h = harness(opts);
  const email = `move${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Lina Haddad', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
  const userId = created.user.id as string;
  if (opts.billingGate) await h.store.billing.setTrialStart(userId, new Date(NOW.getTime() - 3 * DAY));
  const a = created.personalProfile.id as string;
  const b = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Studio ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))).id as string;
  const c = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Elsewhere ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))).id as string;
  await h.app.request(`/admin/v1/users/${userId}/memberships`, json({ organizationId: b }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile: string = a, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });
  return { h, a, b, c, as, userId };
}

async function upload(h: Harness, headers: Record<string, string>, body: object = { ...FILE, suggested: SUGGESTION }) {
  const started = await read(await h.app.request('/v1/receipts/uploads', json(body, { ...headers, ...idem() })));
  h.storage.put(keyOf(started.upload.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType }, new Uint8Array([1, 2, 3]));
  expect((await h.app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers })).status).toBe(200);
  return (await h.store.expenseReceipts.getById(JSON.parse(JSON.stringify(headers))['x-mutaba3a-profile'], started.receipt.id))!;
}

const move = (h: Harness, headers: Record<string, string>, receiptId: string, profileId: string, key = idem()) =>
  h.app.request(`/v1/receipts/${receiptId}/move`, json({ profileId }, { ...headers, ...key }));

describe('POST /v1/receipts/{id}/move (MUT-503)', () => {
  it('moves a To-review receipt from A to B: same id, date, suggestion and reading; A loses it, B gains it', async () => {
    const { h, a, b, as } = await setup();
    const receipt = await upload(h, as());
    const oldKey = receipt.storageKey;

    const res = await move(h, as(), receipt.id, b);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.fromProfileId).toBe(a);
    expect(body.receipt).toMatchObject({ id: receipt.id, filingStatus: 'TO_REVIEW', receivedOn: receipt.receivedOn, suggested: SUGGESTION, approved: null, version: receipt.version + 1 });

    expect(await read(await h.app.request('/v1/receipts/counts', { headers: as() }))).toEqual({ toReview: 0, filed: 0 });
    expect(await read(await h.app.request('/v1/receipts/counts', { headers: as(b) }))).toEqual({ toReview: 1, filed: 0 });
    expect((await h.app.request(`/v1/receipts/${receipt.id}`, { headers: as() })).status).toBe(404);
    expect((await h.app.request(`/v1/receipts/${receipt.id}`, { headers: as(b) })).status).toBe(200);

    // The object went to B's prefix under a key of its own (D5), and A's copy is gone.
    const moved = (await h.store.expenseReceipts.getById(b, receipt.id))!;
    expect(moved.storageKey).toMatch(new RegExp(`^org/${b}/expense-receipts/${receipt.id}-[0-9a-f]{12}$`));
    expect(h.storage.objects.has(moved.storageKey)).toBe(true);
    expect(h.storage.contents.get(moved.storageKey)).toEqual(new Uint8Array([1, 2, 3]));
    expect(h.storage.objects.has(oldKey)).toBe(false);
  });

  it('clears an approval left over from an unlinked expense (D2): its category is A\'s', async () => {
    const { h, a, b, as } = await setup();
    const receipt = await upload(h, as());
    const approved = await read(await h.app.request(`/v1/receipts/${receipt.id}/approve`, json({ occurredOn: '2026-10-28', amount: '15.00', currency: 'ILS', vendor: 'Cafe' }, { ...as(), ...idem() })));
    // Deleting the expense puts the receipt back To review with its approval kept (prisma.ts unlink).
    expect((await h.app.request(`/v1/expenses/${approved.expense.id}`, { method: 'DELETE', headers: { ...as(), 'if-match': `"${approved.expense.version}"` } })).status).toBeLessThan(300);
    expect((await h.store.expenseReceipts.getById(a, receipt.id))!.approved).not.toBeNull();

    const body = await read(await move(h, as(), receipt.id, b));
    expect(body.receipt).toMatchObject({ filingStatus: 'TO_REVIEW', approved: null });
    expect((await h.store.expenseReceipts.getById(b, receipt.id))!).toMatchObject({ approvedAt: null, approvedByUserId: null });
  });

  it('audits expense_receipt.moved_out on A and expense_receipt.moved_in on B (D3)', async () => {
    const { h, a, b, as, userId } = await setup();
    const receipt = await upload(h, as());
    await move(h, as(), receipt.id, b);
    const out = (await h.store.audit.list(a, { action: 'expense_receipt.moved_out' }, { limit: 10, cursor: null })).items;
    const into = (await h.store.audit.list(b, { action: 'expense_receipt.moved_in' }, { limit: 10, cursor: null })).items;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ actorType: 'USER', actorId: userId, entityType: 'expense_receipt', entityId: receipt.id, metadata: { toProfileId: b } });
    expect(into).toHaveLength(1);
    expect(into[0]).toMatchObject({ actorType: 'USER', actorId: userId, entityId: receipt.id, metadata: { fromProfileId: a } });
  });

  it('a retry with the same Idempotency-Key moves once and answers the same', async () => {
    const { h, a, b, as } = await setup();
    const receipt = await upload(h, as());
    const key = idem();
    const first = await move(h, as(), receipt.id, b, key);
    const again = await move(h, as(), receipt.id, b, key);
    expect(again.status).toBe(200);
    expect(await read(again)).toEqual(await read(first));
    expect(h.storage.copied).toHaveLength(1);
    expect((await h.store.audit.list(a, { action: 'expense_receipt.moved_out' }, { limit: 10, cursor: null })).items).toHaveLength(1);
  });

  it('refuses a Filed receipt with 409 RECEIPT_ALREADY_FILED and copies nothing', async () => {
    const { h, b, as } = await setup();
    const receipt = await upload(h, as());
    const approved = await read(await h.app.request(`/v1/receipts/${receipt.id}/approve`, json({ occurredOn: '2026-10-28', amount: '15.00', currency: 'ILS' }, { ...as(), ...idem() })));
    const res = await move(h, as(), receipt.id, b);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'RECEIPT_ALREADY_FILED', expenseId: approved.expense.id });
    expect(h.storage.copied).toEqual([]);
  });

  it('refuses an upload that never completed (422 ATTACHMENT_NOT_READY)', async () => {
    const { h, b, as } = await setup();
    const started = await read(await h.app.request('/v1/receipts/uploads', json(FILE, { ...as(), ...idem() })));
    const res = await move(h, as(), started.receipt.id, b);
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.reason).toBe('ATTACHMENT_NOT_READY');
  });

  it('refuses the profile it is already on (422 SAME_PROFILE), a profile the person isn\'t on (404), and an unknown receipt (404)', async () => {
    const { h, a, c, as } = await setup();
    const receipt = await upload(h, as());
    const same = await move(h, as(), receipt.id, a);
    expect(same.status).toBe(422);
    expect((await read(same)).error.details.reason).toBe('SAME_PROFILE');
    const stranger = await move(h, as(), receipt.id, c);
    expect(stranger.status).toBe(404);
    expect((await read(stranger)).error.details.reason).toBe('PROFILE_NOT_FOUND');
    const unknown = await move(h, as(), '00000000-0000-4000-8000-000000000503', c);
    expect(unknown.status).toBe(404);
    expect(h.storage.copied).toEqual([]);
    expect((await h.store.expenseReceipts.getById(a, receipt.id))!.storageKey).toBe(receipt.storageKey);
  });

  it('answers 409 RECEIPT_FILE_MISSING when the stored object is gone, and leaves the receipt where it is', async () => {
    const { h, a, b, as } = await setup();
    const receipt = await upload(h, as());
    h.storage.objects.delete(receipt.storageKey);
    const res = await move(h, as(), receipt.id, b);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details.reason).toBe('RECEIPT_FILE_MISSING');
    expect(await h.store.expenseReceipts.getById(a, receipt.id)).not.toBeNull();
  });

  it('a failed copy leaves the receipt on A untouched, and the same key can be sent again (5xx releases it)', async () => {
    const { h, a, b, as } = await setup();
    const receipt = await upload(h, as());
    const key = idem();
    h.storage.failCopy = true;
    expect((await move(h, as(), receipt.id, b, key)).status).toBe(500);
    expect((await h.store.expenseReceipts.getById(a, receipt.id))!).toMatchObject({ storageKey: receipt.storageKey, version: receipt.version });
    expect(h.storage.objects.has(receipt.storageKey)).toBe(true);
    h.storage.failCopy = false;
    expect((await move(h, as(), receipt.id, b, key)).status).toBe(200);
  });

  it('a move refused under the lock removes only its own copy (D5): the live file is never touched', async () => {
    const { h, a, b, as } = await setup();
    const receipt = await upload(h, as());
    // Another request deletes the receipt between the checks and the lock.
    const realMove = h.store.expenseReceipts.moveToProfile.bind(h.store.expenseReceipts);
    h.store.expenseReceipts.moveToProfile = async (params) => {
      await h.store.expenseReceipts.softDelete(a, receipt.id, NOW);
      return realMove(params);
    };
    const res = await move(h, as(), receipt.id, b);
    expect(res.status).toBe(404);
    const copiedTo = h.storage.copied[0]?.[1];
    expect(copiedTo).toBeDefined();
    expect(h.storage.objects.has(copiedTo!)).toBe(false);
    expect(h.storage.objects.has(receipt.storageKey)).toBe(true);
  });

  it('two moves to the same profile with different keys: one wins, and its file survives the loser\'s clean-up', async () => {
    const { h, b, as } = await setup();
    const receipt = await upload(h, as());
    const [first, second] = await Promise.all([move(h, as(), receipt.id, b), move(h, as(), receipt.id, b)]);
    expect([first.status, second.status].sort()).toEqual([200, 404]);
    const moved = (await h.store.expenseReceipts.getById(b, receipt.id))!;
    expect(h.storage.objects.has(moved.storageKey)).toBe(true);
  });

  it('a failed delete of A\'s copy after the move still answers 200 (D8: nothing after the commit throws)', async () => {
    const { h, b, as } = await setup();
    const receipt = await upload(h, as());
    h.storage.failRemove = true;
    const res = await move(h, as(), receipt.id, b);
    expect(res.status).toBe(200);
    expect(await h.store.expenseReceipts.getById(b, receipt.id)).not.toBeNull();
  });

  it('a receipt being read moves with its reading state (PENDING stays PENDING)', async () => {
    const { h, a, b, as } = await setup();
    const receipt = await upload(h, as());
    await h.store.expenseReceipts.markBacklogPending({ userId: receipt.uploadedByUserId!, organizationId: a }, NOW);
    expect((await h.store.expenseReceipts.getById(a, receipt.id))!.readStatus).toBe('PENDING');
    await move(h, as(), receipt.id, b);
    expect((await h.store.expenseReceipts.getById(b, receipt.id))!.readStatus).toBe('PENDING');
  });
});

describe('the lapse gate on a move (MUT-503, D7)', () => {
  it('refuses a target profile that is read-only with 402 SUBSCRIPTION_LAPSED, and the receipt stays on A', async () => {
    const { h, a, b, as } = await setup({ billingGate: true });
    const receipt = await upload(h, as());
    // B is a firm with no plan of its own and no Malafat link: read-only under the gate.
    const res = await move(h, as(), receipt.id, b);
    expect(res.status).toBe(402);
    expect((await read(res)).error.code).toBe('SUBSCRIPTION_LAPSED');
    expect(await h.store.expenseReceipts.getById(a, receipt.id)).not.toBeNull();
    expect(h.storage.copied).toEqual([]);
  });
});
