import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-66 AC 5 and the operator half of AC 6.
 *
 * AC 5 — "unsorted entries never change any /v1/summaries/* result" — is
 * asserted twice over, deliberately: behaviourally, by comparing whole
 * response bodies before and after an inbox is filled; and structurally, by
 * reading the summary sources and finding they cannot see the table at all.
 * The second is what keeps the first from becoming a coincidence.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function setup() {
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

  const p = (await read(await app.request('/admin/v1/organizations', json({ name: `Personal ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const email = `partner${++seq}@firm.ps`;
  const created = await provisionUser(app, { email, displayName: 'Nour Haddad', organizationId: p.id });
  const signIn = await app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(signIn.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const me = () => ({ cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN });
  const as = (extra: Record<string, string> = {}) => ({ ...me(), 'x-mutaba3a-profile': p.id, ...extra });

  const capture = async (body: Record<string, unknown>) => (await read(await app.request('/v1/inbox', json(body, { ...me(), ...idem() })))) as { id: string };
  const detail = async (userId = created.user.id) => read(await app.request(`/admin/v1/users/${userId}`, { headers: admin }));

  return { app, store, p, me, as, capture, detail, userId: created.user.id };
}

const ENTRY = { kind: 'expense', amount: '120.50', currency: 'ILS', occurredOn: '2026-10-08' };

describe('unsorted entries are invisible to every summary (AC 5)', () => {
  it('leaves both summaries byte-identical, however many entries pile up', async () => {
    const s = await setup();
    // Some real spending first, so the summaries have something to be wrong about.
    await s.app.request('/v1/expenses', json({ occurredOn: '2026-10-07', amount: '40.00', currency: 'ILS' }, s.as(idem())));
    await s.app.request('/v1/income', json({ kind: 'received', amount: '900.00', currency: 'ILS', occurredOn: '2026-10-07' }, s.as(idem())));

    const snapshot = async () => ({
      organization: await (await s.app.request('/v1/summaries/organization', { headers: s.as() })).text(),
      expenses: await (await s.app.request('/v1/summaries/expenses', { headers: s.as() })).text(),
    });
    const before = await snapshot();

    for (let i = 0; i < 50; i += 1) {
      await s.capture({ ...ENTRY, kind: i % 2 ? 'income' : 'expense', currency: i % 3 ? 'ILS' : 'USD', amount: '999999.00' });
    }

    expect(await snapshot()).toEqual(before);
  });

  it('moves exactly one currency block, by exactly the filed amount, once an entry is filed', async () => {
    const s = await setup();
    await s.app.request('/v1/expenses', json({ occurredOn: '2026-10-07', amount: '40.00', currency: 'ILS' }, s.as(idem())));
    const entry = await s.capture({ ...ENTRY, amount: '10.00', currency: 'USD' });
    const before = (await read(await s.app.request('/v1/summaries/expenses', { headers: s.as() }))) as Loose;

    expect((await s.app.request(`/v1/inbox/${entry.id}/file-as-expense`, json({}, s.as(idem())))).status).toBe(201);
    const after = (await read(await s.app.request('/v1/summaries/expenses', { headers: s.as() }))) as Loose;

    const block = (body: Loose, currency: string) => body.currencies.find((c: Loose) => c.currency === currency);
    expect(block(before, 'USD')).toBeUndefined();
    expect(block(after, 'USD')).toMatchObject({ total: '10.00', count: 1 });
    // Everything else is untouched.
    expect(block(after, 'ILS')).toEqual(block(before, 'ILS'));
  });

  /**
   * The structural half: the summary code has no reference to the inbox at
   * all, so AC 5 holds because the table is unreachable from there, not
   * because today's numbers happen to come out right.
   */
  it('is not even mentioned in the summary sources', () => {
    const root = new URL('../', import.meta.url);
    // Enumerated, not hardcoded, so a summary module added later is covered without editing this list.
    const files = [...readdirSync(new URL('summaries/', root)).filter((f) => f.endsWith('.ts')).map((f) => `summaries/${f}`), 'expenses/summary.ts', 'routes/summaries.ts'];
    expect(files.length).toBeGreaterThan(2);

    for (const file of files) {
      const source = readFileSync(new URL(file, root), 'utf8');
      expect(source, file).not.toMatch(/inbox/i);
    }
  });
});

describe('the operator can see how big an inbox is (AC 6)', () => {
  it('reports the count for none, one and many — and never another person’s', async () => {
    const s = await setup();
    expect((await s.detail()).inboxEntryCount).toBe(0);

    await s.capture(ENTRY);
    expect((await s.detail()).inboxEntryCount).toBe(1);
    for (let i = 0; i < 9; i += 1) await s.capture(ENTRY);
    expect((await s.detail()).inboxEntryCount).toBe(10);

    const other = await provisionUser(s.app, { email: `other${++seq}@firm.ps`, displayName: 'Rami', organizationId: s.p.id });
    expect((await s.detail(other.user.id)).inboxEntryCount).toBe(0);
  });

  it('follows the inbox down as entries are deleted and filed, with no caching', async () => {
    const s = await setup();
    const dropped = await s.capture(ENTRY);
    const filed = await s.capture(ENTRY);
    expect((await s.detail()).inboxEntryCount).toBe(2);

    await s.app.request(`/v1/inbox/${dropped.id}`, { method: 'DELETE', headers: s.me() });
    expect((await s.detail()).inboxEntryCount).toBe(1);

    await s.app.request(`/v1/inbox/${filed.id}/file-as-expense`, json({}, s.as(idem())));
    expect((await s.detail()).inboxEntryCount).toBe(0);
  });

  /** The behavioural statement of AC 6's first half, at the operator's own route. */
  it('still reports the inbox after the person’s last membership is revoked', async () => {
    const s = await setup();
    await s.capture(ENTRY);
    // MUT-120: the personal profile's membership goes too, so the person has none left. The admin API
    // refuses that one (it is the user's own), so it is removed at the store.
    await s.app.request(`/admin/v1/users/${s.userId}/memberships/${s.p.id}`, { method: 'DELETE', headers: admin });
    for (const m of await s.store.memberships.listByUser(s.userId)) await s.store.memberships.revoke(s.userId, m.organizationId);

    const detail = await s.detail();
    expect(detail.memberships).toEqual([]);
    expect(detail.inboxEntryCount).toBe(1);
  });
});
