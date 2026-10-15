import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-66: the four plain inbox routes. What they must prove beyond ordinary
 * CRUD is that they belong to the person and not to any profile — no
 * X-Mutaba3a-Profile, no scope, no reachable trace of anyone else's entries.
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
  const clock = { now: new Date('2026-10-12T09:00:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, clock };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function organization(h: Harness, label: string) {
  return (await read(await h.app.request('/admin/v1/organizations', json({ name: `${label} ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
}

/** A signed-in person. Every user is created with a first membership; `revokeAll` reaches the no-membership state the way reality does. */
async function person(h: Harness, organizationIds?: string[]) {
  const ids = organizationIds ?? [(await organization(h, 'Firm')).id];
  const [first, ...rest] = ids;
  const email = `partner${++seq}@firm.ps`;
  const created = (await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId: first }, admin)))) as { user: { id: string }; initialPassword: string };
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.initialPassword }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  /** No X-Mutaba3a-Profile: these routes name no profile. */
  const me = (extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN, ...extra });
  const revokeAll = async () => {
    // MUT-120: every membership, the personal profile's included. The admin API refuses the personal
    // one (it is the user's own), so it is removed at the store.
    for (const m of await h.store.memberships.listByUser(created.user.id)) await h.store.memberships.revoke(created.user.id, m.organizationId);
  };
  return { me, userId: created.user.id, email, revokeAll, organizationIds: ids };
}

const BASE = { kind: 'expense', amount: '120.50', currency: 'ILS', occurredOn: '2026-10-08' };

async function setup(organizationIds?: string[]) {
  const h = harness();
  const u = await person(h, organizationIds);
  const capture = (body: Record<string, unknown> = BASE) => h.app.request('/v1/inbox', json(body, { ...u.me(), ...idem() }));
  const list = (query = '') => h.app.request(`/v1/inbox${query}`, { headers: u.me() });
  return { h, u, capture, list };
}

describe('POST /v1/inbox', () => {
  it('captures with every field, and with the optional ones absent', async () => {
    const { capture } = await setup();
    const full = await capture({ ...BASE, kind: 'income', note: 'Retainer top-up', captureSource: 'siri' });
    expect(full.status).toBe(201);
    expect(await read(full)).toMatchObject({
      kind: 'income',
      amount: '120.50',
      currency: 'ILS',
      occurredOn: '2026-10-08',
      note: 'Retainer top-up',
      captureSource: 'siri',
      version: 1,
    });

    const bare = await capture(BASE);
    expect(bare.status).toBe(201);
    expect(await read(bare)).toMatchObject({ kind: 'expense', note: null, captureSource: null });
  });

  it('refuses a non-positive amount and a malformed date', async () => {
    const { capture } = await setup();
    expect((await capture({ ...BASE, amount: '0.00' })).status).toBe(422);
    expect((await capture({ ...BASE, amount: '-1.00' })).status).toBe(422);
    expect((await capture({ ...BASE, occurredOn: '08/10/2026' })).status).toBe(422);
  });

  /** The §3.1 decision, asserted at the route: capture has no profile, so it has no timezone to judge "today" in. */
  it('accepts a future date — that check belongs to filing', async () => {
    const { capture } = await setup();
    const res = await capture({ ...BASE, occurredOn: '2027-06-01' });
    expect(res.status).toBe(201);
    expect((await read(res)).occurredOn).toBe('2027-06-01');
  });

  /**
   * MUT-227: a typo year is refused at capture, but leniently. With no profile there is no timezone, so the floor
   * is measured from UTC's yesterday (2026-10-11 here), which is at or before every timezone's today. Capture can
   * never refuse a date that filing would accept; filing applies the exact floor.
   */
  it('refuses a date more than ten years before UTC yesterday (bound past); accepts that floor day', async () => {
    const { capture } = await setup();
    for (const occurredOn of ['2016-10-02', '0001-01-01']) {
      const old = await capture({ ...BASE, occurredOn });
      expect(old.status).toBe(422);
      expect((await read(old)).error.details).toEqual({ reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' });
    }
    expect((await capture({ ...BASE, occurredOn: '2016-10-03' })).status).toBe(201);
  });

  it('rejects an unknown field, as every other create route does', async () => {
    const { capture } = await setup();
    expect((await capture({ ...BASE, organizationId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
  });

  // ---- MUT-131: this route had no Idempotency-Key protection at all; /v1/income and /v1/expenses
  // already work this way (income-routes.test.ts) — same contract, here for the organization-
  // independent capture route too, so a lost-response replay can never double-create an entry.

  it('missing Idempotency-Key → 422', async () => {
    const { h, u } = await setup();
    const res = await h.app.request('/v1/inbox', json(BASE, u.me()));
    expect(res.status).toBe(422);
  });

  it('replays the same Idempotency-Key + body → identical response, no second row created', async () => {
    const { h, u } = await setup();
    const headers = u.me({ 'idempotency-key': 'inbox-key-01' });
    const first = await h.app.request('/v1/inbox', json(BASE, headers));
    const again = await h.app.request('/v1/inbox', json(BASE, headers));
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await read(again)).toEqual(await read(first));
    const list = await read(await h.app.request('/v1/inbox', { headers: u.me() }));
    expect(list.items).toHaveLength(1);
  });

  it('replays the same key with a different body → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const { h, u } = await setup();
    const headers = u.me({ 'idempotency-key': 'inbox-key-02' });
    await h.app.request('/v1/inbox', json(BASE, headers));
    const other = await h.app.request('/v1/inbox', json({ ...BASE, amount: '999.00' }, headers));
    expect((await read(other)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('two different people using the identical literal key each get their own entry — no cross-user leakage', async () => {
    const a = await setup();
    const b = await setup();
    const literal = { 'idempotency-key': 'shared-literal-key' };
    const mine = await read(await a.h.app.request('/v1/inbox', json({ ...BASE, note: 'mine' }, a.u.me(literal))));
    const theirs = await read(await b.h.app.request('/v1/inbox', json({ ...BASE, note: 'theirs' }, b.u.me(literal))));
    expect(mine.id).not.toBe(theirs.id);
    expect((await read(await a.list())).items).toHaveLength(1);
    expect((await read(await b.list())).items).toHaveLength(1);
  });
});

describe('the inbox belongs to the person, not to a profile', () => {
  /** AC 6 at the route: losing the last membership takes nothing away, and the inbox still works end to end. */
  it('works for someone whose last membership has been revoked', async () => {
    const { capture, list, h, u } = await setup();
    const before = await read(await capture());
    await u.revokeAll();
    expect(await h.store.memberships.listByUser(u.userId)).toEqual([]);
    expect((await read(await list())).items.map((e: Loose) => e.id)).toEqual([before.id]);

    const created = await read(await capture());
    // Both were captured at the same frozen instant, so (createdAt, id) order is the id tiebreaker's, not insertion order's.
    expect(new Set((await read(await list())).items.map((e: Loose) => e.id))).toEqual(new Set([created.id, before.id]));

    const patched = await h.app.request(`/v1/inbox/${created.id}`, json({ note: 'Taxi' }, { ...u.me(), 'if-match': '1' }, 'PATCH'));
    expect(patched.status).toBe(200);
    expect((await h.app.request(`/v1/inbox/${created.id}`, { method: 'DELETE', headers: u.me() })).status).toBe(204);
  });

  it('ignores an X-Mutaba3a-Profile header rather than starting to require one', async () => {
    const h = harness();
    const org = await organization(h, 'Firm');
    const u = await person(h, [org.id]);
    const withHeader = await h.app.request('/v1/inbox', json(BASE, u.me({ 'x-mutaba3a-profile': org.id, ...idem() })));
    expect(withHeader.status).toBe(201);
    const listed = await h.app.request('/v1/inbox', { headers: u.me({ 'x-mutaba3a-profile': org.id }) });
    expect(listed.status).toBe(200);
    expect((await read(listed)).items).toHaveLength(1);
  });

  it('refuses an API key outright — a key has no person behind it, so no inbox', async () => {
    const h = harness();
    const org = await organization(h, 'Firm');
    const key = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)))) as { secret: string };
    const auth = { authorization: `Bearer ${key.secret}` };
    expect((await h.app.request('/v1/inbox', { headers: auth })).status).toBe(403);
    expect((await h.app.request('/v1/inbox', json(BASE, auth))).status).toBe(403);
  });

  it('never leaks one person’s entries to another, however many pages are walked', async () => {
    const h = harness();
    const mine = await person(h);
    const theirs = await person(h);
    for (let i = 0; i < 5; i += 1) await h.app.request('/v1/inbox', json({ ...BASE, note: `mine ${i}` }, mine.me(idem())));
    await h.app.request('/v1/inbox', json({ ...BASE, note: 'theirs' }, theirs.me(idem())));

    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await read(await h.app.request(`/v1/inbox?limit=2${cursor ? `&cursor=${cursor}` : ''}`, { headers: mine.me() }));
      walked.push(...page.items.map((e: Loose) => e.note));
      cursor = page.nextCursor;
    } while (cursor);

    expect(walked).toHaveLength(5);
    expect(walked).not.toContain('theirs');
  });

  it('answers 404, never 403, for another person’s entry', async () => {
    const h = harness();
    const mine = await person(h);
    const theirs = await person(h);
    const entry = (await read(await h.app.request('/v1/inbox', json(BASE, theirs.me(idem()))))) as { id: string };

    expect((await h.app.request(`/v1/inbox/${entry.id}`, json({ note: 'x' }, { ...mine.me(), 'if-match': '1' }, 'PATCH'))).status).toBe(404);
    expect((await h.app.request(`/v1/inbox/${entry.id}`, { method: 'DELETE', headers: mine.me() })).status).toBe(404);
    // And it is still there for its owner.
    expect((await read(await h.app.request('/v1/inbox', { headers: theirs.me() }))).items).toHaveLength(1);
  });
});

describe('GET /v1/inbox', () => {
  it('lists newest first and pages without gaps or repeats', async () => {
    const { h, u, capture, list } = await setup();
    for (let i = 0; i < 4; i += 1) {
      h.clock.now = new Date(`2026-10-12T09:0${i}:00Z`);
      await capture({ ...BASE, note: `n${i}` });
    }
    const first = await read(await list('?limit=2'));
    expect(first.items.map((e: Loose) => e.note)).toEqual(['n3', 'n2']);
    const second = await read(await h.app.request(`/v1/inbox?limit=2&cursor=${first.nextCursor}`, { headers: u.me() }));
    expect(second.items.map((e: Loose) => e.note)).toEqual(['n1', 'n0']);
    expect(second.nextCursor).toBeNull();
  });

  it('refuses a cursor it did not issue, naming the field', async () => {
    const { list } = await setup();
    const res = await list('?cursor=not-a-cursor');
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.field).toBe('cursor');
  });
});

describe('PATCH /v1/inbox/{entryId}', () => {
  it('changes what was captured and bumps the version', async () => {
    const { h, u, capture } = await setup();
    const created = (await read(await capture({ ...BASE, note: 'guess' }))) as { id: string };
    const res = await h.app.request(`/v1/inbox/${created.id}`, json({ amount: '99.00', note: null }, { ...u.me(), 'if-match': '1' }, 'PATCH'));
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ amount: '99.00', note: null, version: 2 });
  });

  it('refuses moving the date more than ten years back (MUT-227), and leaves the entry as it was', async () => {
    const { h, u, capture, list } = await setup();
    const created = (await read(await capture())) as { id: string };
    const res = await h.app.request(`/v1/inbox/${created.id}`, json({ occurredOn: '2006-10-08' }, { ...u.me(), 'if-match': '1' }, 'PATCH'));
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' });
    expect((await read(await list())).items).toMatchObject([{ id: created.id, occurredOn: '2026-10-08', version: 1 }]);
  });

  it('refuses a stale If-Match with 409 VERSION_MISMATCH, and a missing one with 422', async () => {
    const { h, u, capture } = await setup();
    const created = (await read(await capture())) as { id: string };
    await h.app.request(`/v1/inbox/${created.id}`, json({ note: 'first' }, { ...u.me(), 'if-match': '1' }, 'PATCH'));

    const stale = await h.app.request(`/v1/inbox/${created.id}`, json({ note: 'second' }, { ...u.me(), 'if-match': '1' }, 'PATCH'));
    expect(stale.status).toBe(409);
    expect((await read(stale)).error.details.reason).toBe('VERSION_MISMATCH');
    expect((await h.app.request(`/v1/inbox/${created.id}`, json({ note: 'x' }, u.me(), 'PATCH'))).status).toBe(422);
  });

  /** kind is not on the request schema at all, so asking to change it is a plain unknown-field refusal. */
  it('will not change the kind', async () => {
    const { h, u, capture } = await setup();
    const created = (await read(await capture())) as { id: string };
    const res = await h.app.request(`/v1/inbox/${created.id}`, json({ kind: 'income' }, { ...u.me(), 'if-match': '1' }, 'PATCH'));
    expect(res.status).toBe(422);
    expect((await read(await h.app.request(`/v1/inbox`, { headers: u.me() }))).items[0].kind).toBe('expense');
  });

  it('will not change the currency without a fresh amount, which would reinterpret the stored minor units', async () => {
    const { h, u, capture } = await setup();
    const created = (await read(await capture())) as { id: string };
    const alone = await h.app.request(`/v1/inbox/${created.id}`, json({ currency: 'USD' }, { ...u.me(), 'if-match': '1' }, 'PATCH'));
    expect(alone.status).toBe(422);
    expect((await read(alone)).error.details.field).toBe('amount');

    const together = await h.app.request(`/v1/inbox/${created.id}`, json({ currency: 'USD', amount: '30.00' }, { ...u.me(), 'if-match': '1' }, 'PATCH'));
    expect(together.status).toBe(200);
    expect(await read(together)).toMatchObject({ currency: 'USD', amount: '30.00' });
  });
});

describe('DELETE /v1/inbox/{entryId}', () => {
  /** Deliberately unlike Expense's soft delete, which answers 204 again: an entry is a scratch note, and nothing references it. */
  it('is a hard delete — the second attempt is 404, not 204 again', async () => {
    const { h, u, capture } = await setup();
    const created = (await read(await capture())) as { id: string };
    expect((await h.app.request(`/v1/inbox/${created.id}`, { method: 'DELETE', headers: u.me() })).status).toBe(204);
    expect((await h.app.request(`/v1/inbox/${created.id}`, { method: 'DELETE', headers: u.me() })).status).toBe(404);
    expect((await read(await h.app.request('/v1/inbox', { headers: u.me() }))).items).toEqual([]);
  });
});
