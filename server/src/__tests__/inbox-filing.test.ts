import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-66 filing: an unsorted entry becomes a real record on one chosen
 * profile, atomically and idempotently.
 *
 * Profile P is personal (no integration); profile M is Malafat-fed. The pair
 * is what makes the writability half of the ticket testable: filing as an
 * expense must work on both, filing as income only on P.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

function harness() {
  const store = new MemoryLedgerStore();
  const calls: Array<{ repo: string; method: string }> = [];
  const recording = new Proxy(store, {
    get(target, repo) {
      const value: unknown = Reflect.get(target, repo, target);
      if (typeof value === 'function') return value.bind(target);
      if (typeof repo !== 'string' || typeof value !== 'object' || value === null) return value;
      return new Proxy(value, {
        get(r, method) {
          const fn: unknown = Reflect.get(r, method, r);
          if (typeof method !== 'string' || typeof fn !== 'function') return fn;
          return (...args: unknown[]) => {
            calls.push({ repo, method });
            return (fn as (...a: unknown[]) => unknown).apply(r, args);
          };
        },
      });
    },
  });
  const clock = { now: new Date('2026-10-12T09:00:00Z') };
  const app = createApp({
    store: recording,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, clock, calls };
}

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function setup() {
  const h = harness();
  const p = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Personal ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const m = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const mKey = (await read(await h.app.request(`/admin/v1/organizations/${m.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)))) as { secret: string; apiKey: { id: string } };
  await h.store.integrations.connect({ organizationId: m.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Firm', connectedByApiKeyId: mKey.apiKey.id, at: h.clock.now });

  const email = `partner${++seq}@firm.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: p.id });
  await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId: m.id }, admin));
  const signIn = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(signIn.headers.get('set-cookie') ?? '')?.[1] ?? '';

  const me = (extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN, ...extra });
  const as = (profile: string, extra: Record<string, string> = {}) => me({ 'x-mutaba3a-profile': profile, ...extra });

  const capture = async (body: Record<string, unknown>) => (await read(await h.app.request('/v1/inbox', json(body, { ...me(), ...idem() })))) as { id: string };
  const listInbox = async () => (await read(await h.app.request('/v1/inbox', { headers: me() }))).items as Loose[];
  const fileExpense = (entryId: string, body: Record<string, unknown> = {}, profile = p.id, headers: Record<string, string> = idem()) =>
    h.app.request(`/v1/inbox/${entryId}/file-as-expense`, json(body, as(profile, headers)));
  const fileIncome = (entryId: string, body: Record<string, unknown>, profile = p.id, headers: Record<string, string> = idem()) =>
    h.app.request(`/v1/inbox/${entryId}/file-as-income`, json(body, as(profile, headers)));
  const expenses = async (profile: string) => (await read(await h.app.request('/v1/expenses?limit=200', { headers: as(profile) }))).items as Loose[];

  return { h, p, m, me, as, capture, listInbox, fileExpense, fileIncome, expenses, userId: created.user.id };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const EXPENSE_ENTRY = { kind: 'expense', amount: '120.50', currency: 'ILS', occurredOn: '2026-10-08', note: 'Taxi from court', captureSource: 'siri' };
const INCOME_ENTRY = { kind: 'income', amount: '250.00', currency: 'ILS', occurredOn: '2026-10-08', note: 'Retainer', captureSource: 'widget' };

async function customer(s: Setup, profile: string, name = 'Nadia') {
  return (await read(await s.h.app.request('/v1/customers', json({ name }, s.as(profile, idem()))))) as { id: string };
}

describe('POST /v1/inbox/{id}/file-as-expense', () => {
  it('carries the entry’s own money and date onto the expense, and the entry is gone', async () => {
    const s = await setup();
    const entry = await s.capture(EXPENSE_ENTRY);
    const res = await s.fileExpense(entry.id, { vendor: 'Yellow Cab', title: 'Taxi' });

    expect(res.status).toBe(201);
    expect(await read(res)).toMatchObject({
      amount: '120.50',
      currency: 'ILS',
      occurredOn: '2026-10-08',
      notes: 'Taxi from court',
      vendor: 'Yellow Cab',
      title: 'Taxi',
    });
    expect(await s.listInbox()).toEqual([]);
    expect(await s.expenses(s.p.id)).toHaveLength(1);
  });

  /** expenses is profile-independent in the matrix, so "any profile the user belongs to" is the AC's literal wording. */
  it('lands on a Malafat-fed profile just as readily as on a personal one', async () => {
    const s = await setup();
    const entry = await s.capture(EXPENSE_ENTRY);
    expect((await s.fileExpense(entry.id, {}, s.m.id)).status).toBe(201);
    expect(await s.expenses(s.m.id)).toHaveLength(1);
    expect(await s.expenses(s.p.id)).toHaveLength(0);
  });

  it('answers 422 CATEGORY_NOT_FOUND and keeps the entry when a type change deletes the category mid-filing (MUT-182 R17)', async () => {
    const s = await setup();
    // The race made deterministic: the route's check still finds the category, the write's foreign key does not.
    const ghost = '00000000-0000-4000-8000-0000000000c5';
    const getById = s.h.store.expenseCategories.getById;
    s.h.store.expenseCategories.getById = async (organizationId, id) =>
      id === ghost ? { id: ghost, organizationId, name: 'Gone', color: null, archivedAt: null, version: 1, createdAt: new Date(), updatedAt: new Date() } : getById(organizationId, id);
    const entry = await s.capture(EXPENSE_ENTRY);
    const filed = await s.fileExpense(entry.id, { categoryId: ghost });
    expect(filed.status).toBe(422);
    expect((await read(filed)).error.details).toMatchObject({ reason: 'CATEGORY_NOT_FOUND', field: 'categoryId' });
    expect((await s.listInbox()).map((e) => e.id)).toContain(entry.id);
    expect(await s.expenses(s.p.id)).toHaveLength(0);
  });

  it('validates links and categories exactly as POST /v1/expenses does', async () => {
    const s = await setup();
    const ghost = '00000000-0000-4000-8000-000000000000';
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ customerId: ghost }, 'CUSTOMER_NOT_FOUND'],
      [{ projectId: ghost }, 'PROJECT_NOT_FOUND'],
      [{ categoryId: ghost }, 'CATEGORY_NOT_FOUND'],
    ];
    for (const [body, reason] of cases) {
      const entry = await s.capture(EXPENSE_ENTRY);
      const filed = await s.fileExpense(entry.id, body);
      const direct = await s.h.app.request('/v1/expenses', json({ occurredOn: '2026-10-08', amount: '120.50', currency: 'ILS', ...body }, s.as(s.p.id, idem())));
      const [filedBody, directBody] = [await read(filed), await read(direct)];

      expect(filed.status, reason).toBe(direct.status);
      expect(filedBody.error.details, reason).toEqual(directBody.error.details);
      expect(filedBody.error.details.reason, reason).toBe(reason);
      // Every refusal leaves the entry exactly where it was.
      expect((await s.listInbox()).map((e) => e.id)).toContain(entry.id);
    }
  });

  it('refuses an income entry with 409 ENTRY_KIND_MISMATCH and leaves it alone', async () => {
    const s = await setup();
    const entry = await s.capture(INCOME_ENTRY);
    const res = await s.fileExpense(entry.id);

    expect(res.status).toBe(409);
    expect((await read(res)).error.details.reason).toBe('ENTRY_KIND_MISMATCH');
    expect((await s.listInbox()).map((e) => e.id)).toEqual([entry.id]);
    expect(await s.expenses(s.p.id)).toHaveLength(0);
  });

  it('is 404 for another person’s entry, and for one already filed', async () => {
    const s = await setup();
    const entry = await s.capture(EXPENSE_ENTRY);
    expect((await s.fileExpense(entry.id)).status).toBe(201);
    expect((await s.fileExpense(entry.id)).status).toBe(404);
    expect((await s.fileExpense('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  /** "any profile the user belongs to" (AC 2) — and no others: a non-member destination is not found. */
  it('is 404 for a profile the person is not a member of, and files nothing', async () => {
    const s = await setup();
    const outsider = (await read(await s.h.app.request('/admin/v1/organizations', json({ name: `Outsider ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
    const entry = await s.capture(EXPENSE_ENTRY);

    const res = await s.fileExpense(entry.id, {}, outsider.id);
    expect(res.status).toBe(404);
    expect((await s.listInbox()).map((e) => e.id)).toEqual([entry.id]);
    expect(await s.expenses(s.p.id)).toHaveLength(0);
  });

  it('requires an Idempotency-Key', async () => {
    const s = await setup();
    const entry = await s.capture(EXPENSE_ENTRY);
    expect((await s.fileExpense(entry.id, {}, s.p.id, {})).status).toBe(422);
    // The refusal happened in middleware, before the handler: the entry is untouched.
    expect((await s.listInbox()).map((e) => e.id)).toEqual([entry.id]);
  });

  /** AC 4, and the half that matters: a replay must not produce a second expense. */
  it('replays to the identical response and writes nothing new', async () => {
    const s = await setup();
    const entry = await s.capture(EXPENSE_ENTRY);
    const key = idem();
    const first = await s.fileExpense(entry.id, { vendor: 'Yellow Cab' }, s.p.id, key);
    const replay = await s.fileExpense(entry.id, { vendor: 'Yellow Cab' }, s.p.id, key);

    expect(replay.status).toBe(first.status);
    expect(await read(replay)).toEqual(await read(first));
    expect(await s.expenses(s.p.id)).toHaveLength(1);
    expect(await s.listInbox()).toEqual([]);
  });

  it('refuses the same key with a different body', async () => {
    const s = await setup();
    const entry = await s.capture(EXPENSE_ENTRY);
    const key = idem();
    await s.fileExpense(entry.id, { vendor: 'Yellow Cab' }, s.p.id, key);
    const res = await s.fileExpense(entry.id, { vendor: 'Blue Cab' }, s.p.id, key);
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('records how the entry was captured on the expense’s audit row', async () => {
    const s = await setup();
    const entry = await s.capture(EXPENSE_ENTRY);
    const filed = await read(await s.fileExpense(entry.id));
    const events = await s.h.store.audit.listByOrganization(s.p.id, 50);
    const row = events.find((e) => e.entityId === filed.id && e.entityType === 'expense');
    expect(row?.metadata).toMatchObject({ captureSource: 'siri', filedFromInbox: true });
  });

  /**
   * Filing is refused exactly where a direct create is, and no more: POST /v1/expenses
   * accepts a future occurredOn, so filing must too. The income route is the opposite
   * case, and is asserted below — there the direct route does refuse.
   */
  it('accepts a future-dated entry, because POST /v1/expenses does', async () => {
    const s = await setup();
    const entry = await s.capture({ ...EXPENSE_ENTRY, occurredOn: '2027-06-01' });
    const filed = await s.fileExpense(entry.id);
    const direct = await s.h.app.request('/v1/expenses', json({ occurredOn: '2027-06-01', amount: '120.50', currency: 'ILS' }, s.as(s.p.id, idem())));

    expect(filed.status).toBe(direct.status);
    expect(filed.status).toBe(201);
    expect((await read(filed)).occurredOn).toBe('2027-06-01');
    expect(await s.listInbox()).toEqual([]);
  });

  /**
   * MUT-227: POST /v1/expenses refuses a date more than ten years back, so filing does too. 2016-10-03 passes
   * capture's lenient floor (UTC yesterday − 3660) but sits one day under this profile's exact floor (2016-10-04).
   */
  it('refuses an entry dated more than ten years back, because POST /v1/expenses does, and leaves it in the inbox', async () => {
    const s = await setup();
    const entry = await s.capture({ ...EXPENSE_ENTRY, occurredOn: '2016-10-03' });
    const filed = await s.fileExpense(entry.id);
    const direct = await s.h.app.request('/v1/expenses', json({ occurredOn: '2016-10-03', amount: '120.50', currency: 'ILS' }, s.as(s.p.id, idem())));
    const [filedBody, directBody] = [await read(filed), await read(direct)];

    expect(filed.status).toBe(422);
    expect(filedBody.error.details).toEqual({ reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' });
    expect(filedBody.error.details).toEqual(directBody.error.details);
    expect((await s.listInbox()).map((e) => e.id)).toEqual([entry.id]);
  });

  it('files an entry dated on the floor day itself (MUT-227: 2016-10-04 when today is 2026-10-12)', async () => {
    const s = await setup();
    const entry = await s.capture({ ...EXPENSE_ENTRY, occurredOn: '2016-10-04' });
    const filed = await s.fileExpense(entry.id);
    expect(filed.status).toBe(201);
    expect((await read(filed)).occurredOn).toBe('2016-10-04');
  });
});

describe('POST /v1/inbox/{id}/file-as-income on a personal profile', () => {
  it('Received with no client → 201, the payment stands alone', async () => {
    const s = await setup();
    const entry = await s.capture(INCOME_ENTRY);
    const res = await s.fileIncome(entry.id, { kind: 'received' });

    expect(res.status).toBe(201);
    expect(await read(res)).toMatchObject({ kind: 'received', amount: '250.00', currency: 'ILS', occurredOn: '2026-10-08', customerId: null, notes: 'Retainer', status: 'unallocated' });
    expect(await s.listInbox()).toEqual([]);
  });

  it('Owed with a client → 201, an ADJUSTMENT receivable due EOM_15 of the entry’s date', async () => {
    const s = await setup();
    const c = await customer(s, s.p.id);
    const entry = await s.capture(INCOME_ENTRY);
    const res = await s.fileIncome(entry.id, { kind: 'owed', customerId: c.id, title: 'October work' });

    expect(res.status).toBe(201);
    expect(await read(res)).toMatchObject({ kind: 'owed', customerId: c.id, title: 'October work', dueDate: '2026-11-15', status: 'open' });
    expect(await s.listInbox()).toEqual([]);
  });

  /** MUT-65's own rule, reached through this route — the same error shape, not a lookalike. */
  it('Owed with no client is refused exactly as POST /v1/income refuses it', async () => {
    const s = await setup();
    const entry = await s.capture(INCOME_ENTRY);
    const filed = await s.fileIncome(entry.id, { kind: 'owed' });
    const direct = await s.h.app.request('/v1/income', json({ kind: 'owed', amount: '250.00', currency: 'ILS', occurredOn: '2026-10-08' }, s.as(s.p.id, idem())));
    const [filedBody, directBody] = [await read(filed), await read(direct)];

    expect(filed.status).toBe(422);
    expect(filed.status).toBe(direct.status);
    expect(filedBody.error.details).toEqual(directBody.error.details);
    expect(filedBody.error.details.reason).toBe('CUSTOMER_REQUIRED_FOR_OWED');
    expect((await s.listInbox()).map((e) => e.id)).toEqual([entry.id]);
  });

  it('refuses an expense entry with 409 ENTRY_KIND_MISMATCH on a personal profile', async () => {
    const s = await setup();
    const entry = await s.capture(EXPENSE_ENTRY);
    const res = await s.fileIncome(entry.id, { kind: 'received' });
    expect(res.status).toBe(409);
    expect((await read(res)).error.details.reason).toBe('ENTRY_KIND_MISMATCH');
    expect((await s.listInbox()).map((e) => e.id)).toEqual([entry.id]);
  });

  /** On a Malafat-fed profile the matrix refuses in middleware, before the handler can look at the kind. */
  it('refuses an expense entry on a Malafat-fed profile with READ_ONLY_PROFILE, not the kind conflict', async () => {
    const s = await setup();
    const entry = await s.capture(EXPENSE_ENTRY);
    const res = await s.fileIncome(entry.id, { kind: 'received' }, s.m.id);
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('READ_ONLY_PROFILE');
    expect((await s.listInbox()).map((e) => e.id)).toEqual([entry.id]);
  });

  it('replays to the identical response and creates no second record', async () => {
    const s = await setup();
    const entry = await s.capture(INCOME_ENTRY);
    const key = idem();
    const first = await s.fileIncome(entry.id, { kind: 'received' }, s.p.id, key);
    const replay = await s.fileIncome(entry.id, { kind: 'received' }, s.p.id, key);

    expect(await read(replay)).toEqual(await read(first));
    const payments = (await read(await s.h.app.request('/v1/payments?limit=50', { headers: s.as(s.p.id) }))).items as Loose[];
    expect(payments).toHaveLength(1);
  });

  /** A filed entry's audit row must read the same as one written directly, field for field. */
  it('writes the same audit metadata shape as POST /v1/income does', async () => {
    const s = await setup();
    const c = await customer(s, s.p.id);
    const entry = await s.capture({ ...INCOME_ENTRY, captureSource: undefined });
    const filedId = (await read(await s.fileIncome(entry.id, { kind: 'received', customerId: c.id }))).id;
    const directId = (await read(await s.h.app.request('/v1/income', json({ kind: 'received', amount: '250.00', currency: 'ILS', occurredOn: '2026-10-08', customerId: c.id }, s.as(s.p.id, idem()))))).id;

    const events = await s.h.store.audit.listByOrganization(s.p.id, 50);
    const metaOf = (id: string) => events.find((e) => e.entityId === id && e.entityType === 'payment')?.metadata as Record<string, unknown>;
    const filedMeta = metaOf(filedId);
    const directMeta = metaOf(directId);

    expect(Object.keys(filedMeta).sort()).toEqual([...Object.keys(directMeta), 'filedFromInbox'].sort());
    for (const key of Object.keys(directMeta)) expect(filedMeta[key], key).toEqual(directMeta[key]);
  });

  /** The mirror of the expense case: POST /v1/income does refuse a future date, so filing must too. */
  it('refuses a future-dated entry, because POST /v1/income does, and leaves it in the inbox', async () => {
    const s = await setup();
    const entry = await s.capture({ ...INCOME_ENTRY, occurredOn: '2027-06-01' });
    const filed = await s.fileIncome(entry.id, { kind: 'received' });
    const direct = await s.h.app.request('/v1/income', json({ kind: 'received', amount: '250.00', currency: 'ILS', occurredOn: '2027-06-01' }, s.as(s.p.id, idem())));
    const [filedBody, directBody] = [await read(filed), await read(direct)];

    expect(filed.status).toBe(direct.status);
    expect(filed.status).toBe(422);
    expect(filedBody.error.details).toEqual(directBody.error.details);
    expect((await s.listInbox()).map((e) => e.id)).toEqual([entry.id]);
  });

  it('refuses an entry dated more than ten years back, because POST /v1/income does, and leaves it in the inbox (MUT-227)', async () => {
    const s = await setup();
    const entry = await s.capture({ ...INCOME_ENTRY, occurredOn: '2016-10-03' });
    const filed = await s.fileIncome(entry.id, { kind: 'received' });
    const direct = await s.h.app.request('/v1/income', json({ kind: 'received', amount: '250.00', currency: 'ILS', occurredOn: '2016-10-03' }, s.as(s.p.id, idem())));
    const [filedBody, directBody] = [await read(filed), await read(direct)];

    expect(filed.status).toBe(422);
    expect(filedBody.error.details).toEqual({ reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' });
    expect(filedBody.error.details).toEqual(directBody.error.details);
    expect((await s.listInbox()).map((e) => e.id)).toEqual([entry.id]);
  });

  it('files an entry dated on the floor day itself (MUT-227: 2016-10-04 when today is 2026-10-12)', async () => {
    const s = await setup();
    const entry = await s.capture({ ...INCOME_ENTRY, occurredOn: '2016-10-04' });
    const filed = await s.fileIncome(entry.id, { kind: 'received' });
    expect(filed.status).toBe(201);
    expect((await read(filed)).occurredOn).toBe('2016-10-04');
  });

  it('records how the entry was captured on the income audit row', async () => {
    const s = await setup();
    const entry = await s.capture(INCOME_ENTRY);
    const filed = await read(await s.fileIncome(entry.id, { kind: 'received' }));
    const events = await s.h.store.audit.listByOrganization(s.p.id, 50);
    const row = events.find((e) => e.entityId === filed.id && e.entityType === 'payment');
    expect(row?.metadata).toMatchObject({ captureSource: 'widget', filedFromInbox: true });
    // The amount must be the entry's own money, formatted as POST /v1/income formats it — not the kind.
    expect(row?.metadata).toMatchObject({ amount: '250.00', currency: 'ILS' });
  });
});

describe('POST /v1/inbox/{id}/file-as-income on a Malafat-fed profile', () => {
  /** AC 3, both halves: the refusal, and the entry still being there afterwards. */
  it('refuses every shape with READ_ONLY_PROFILE and leaves the entry in place', async () => {
    const s = await setup();
    const c = await customer(s, s.p.id);
    for (const body of [{ kind: 'received' }, { kind: 'owed', customerId: c.id }]) {
      const entry = await s.capture(INCOME_ENTRY);
      const res = await s.fileIncome(entry.id, body, s.m.id);

      expect(res.status).toBe(403);
      const error = (await read(res)).error;
      expect(error.code).toBe('READ_ONLY_PROFILE');
      expect(error.details).toEqual({ domain: 'payments', writerOfRecord: 'MALAFAT' });
      expect((await s.listInbox()).map((e) => e.id)).toContain(entry.id);
      await s.h.app.request(`/v1/inbox/${entry.id}`, { method: 'DELETE', headers: s.me() });
    }
  });

  /** The refusal must happen before the transaction, not as a rollback of one that started. */
  it('never reaches the store at all', async () => {
    const s = await setup();
    const entry = await s.capture(INCOME_ENTRY);
    s.h.calls.length = 0;
    await s.fileIncome(entry.id, { kind: 'received' }, s.m.id);

    const touched = s.h.calls.filter((c) => (c.repo === 'payments' && c.method === 'create') || (c.repo === 'receivables' && c.method === 'createAdjustment') || (c.repo === 'inboxEntries' && c.method.startsWith('file')));
    expect(touched).toEqual([]);
  });
});

describe('MUT-61: filing as Received is a capture', () => {
  it('writes origin CAPTURE with the entry’s own captureSource', async () => {
    const s = await setup();
    const entry = await s.capture(INCOME_ENTRY);
    const res = await s.fileIncome(entry.id, { kind: 'received' });
    expect(res.status).toBe(201);
    const filed = await read(res);
    expect(await s.h.store.payments.getById(s.p.id, filed.id)).toMatchObject({ origin: 'CAPTURE', captureSource: 'widget', createdByUserId: s.userId });
  });
});

describe('MUT-388: an entry still in a removed Gulf currency', () => {
  // Captured while AED was supported. Filing copies the entry's currency into the new row, so without a check an old
  // AED entry would become a new AED expense or payment after the currency was removed.
  async function gulfEntry(s: Setup, kind: 'expense' | 'income') {
    const { id } = await s.capture(kind === 'expense' ? EXPENSE_ENTRY : INCOME_ENTRY);
    const updated = await s.h.store.inboxEntries.update(s.userId, id, 1, { currency: 'AED', amountMinor: 12_050n }, s.h.clock.now);
    expect(updated.kind).toBe('updated');
    return id;
  }

  it('refuses filing it as an expense (422) and leaves the entry where it was', async () => {
    const s = await setup();
    const id = await gulfEntry(s, 'expense');
    const res = await s.fileExpense(id);
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'UNSUPPORTED_CURRENCY', field: 'currency' });
    expect((await s.listInbox()).map((e) => e.id)).toContain(id);
    expect(await s.expenses(s.p.id)).toEqual([]);
  });

  it.each([['received', {}], ['owed', 'client']] as const)('refuses filing it as %s income (422)', async (kind, extra) => {
    const s = await setup();
    const id = await gulfEntry(s, 'income');
    const body: Record<string, unknown> = { kind };
    if (extra === 'client') body.customerId = (await customer(s, s.p.id)).id;
    const res = await s.fileIncome(id, body);
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'UNSUPPORTED_CURRENCY', field: 'currency' });
    expect((await s.listInbox()).map((e) => e.id)).toContain(id);
  });
});
