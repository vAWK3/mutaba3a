import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-339 (ADR-176): GET /v1/expenses/streak on a person's own personal profile, and the 48-hour capturedAt that
 * decides which day an entry was logged on. Harness as income-routes.test.ts.
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
  /** `repo.method` → a one-shot side effect to run immediately before that store call, so a race can be staged deterministically. */
  const interleave = new Map<string, () => Promise<unknown>>();
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
            const key = `${repo}.${method}`;
            const hook = interleave.get(key);
            if (!hook) return (fn as (...a: unknown[]) => unknown).apply(r, args);
            interleave.delete(key);
            return hook().then(() => (fn as (...a: unknown[]) => unknown).apply(r, args));
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
    // A generous idle/absolute expiry: the read-surface tests advance the clock days ahead to cross a due date; session-expiry behaviour itself is routes-sessions.test.ts's job, not this file's.
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, calls, clock, interleave };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

/** Organization P: personal, no Malafat integration. Organization M: Malafat-connected. */
async function orgs(h: Harness) {
  const p = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Personal ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const m = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const mKey = (await read(await h.app.request(`/admin/v1/organizations/${m.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)))) as { secret: string; apiKey: { id: string } };
  await h.store.integrations.connect({ organizationId: m.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Firm', connectedByApiKeyId: mKey.apiKey.id, at: h.clock.now });
  return { p, m, mAuth: { authorization: `Bearer ${mKey.secret}` } };
}

async function person(h: Harness, organizationIds: string[]) {
  const [first, ...rest] = organizationIds;
  const email = `partner${++seq}@firm.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: first });
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = (profile: string, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });
  return { as, userId: created.user.id };
}

async function setup() {
  const h = harness();
  const { p, m, mAuth } = await orgs(h);
  const u = await person(h, [p.id, m.id]);
  const me = await read(await h.app.request('/v1/me', { headers: u.as(p.id) }));
  const personal = (me.profiles as Loose[]).find((x) => x.isPersonalDefault).id as string;
  const streak = (profile = personal) => h.app.request('/v1/expenses/streak', { headers: u.as(profile) });
  const expense = (body: Record<string, unknown> = {}, profile = personal) =>
    h.app.request('/v1/expenses', json({ occurredOn: '2026-10-01', amount: '5.00', currency: 'ILS', ...body }, { ...u.as(profile), ...idem() }));
  const income = (body: Record<string, unknown> = {}, profile = personal) =>
    h.app.request('/v1/income', json({ kind: 'received', amount: '5.00', currency: 'ILS', occurredOn: '2026-10-01', ...body }, { ...u.as(profile), ...idem() }));
  const day = (iso: string) => { h.clock.now = new Date(iso); };
  return { h, p, m, mAuth, u, personal, streak, expense, income, day };
}

describe('GET /v1/expenses/streak — MUT-339', () => {
  it('nothing logged: 0, nothing to explain', async () => {
    const { streak } = await setup();
    const res = await streak();
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ today: '2026-10-12', current: 0, startedOn: null, lastLoggedOn: null, aliveUntil: null, previous: null });
  });

  it('three days in a row of any entry (S1): an expense, a Received, an expense → 3', async () => {
    const { streak, expense, income, day } = await setup();
    day('2026-10-10T09:00:00Z');
    expect((await expense()).status).toBe(201);
    day('2026-10-11T09:00:00Z');
    expect((await income()).status).toBe(201);
    day('2026-10-12T09:00:00Z');
    expect((await expense()).status).toBe(201);
    expect(await read(await streak())).toMatchObject({ current: 3, startedOn: '2026-10-10', lastLoggedOn: '2026-10-12', aliveUntil: '2026-10-13T21:00:00.000Z' });
  });

  it('a deleted expense and an undone Received do not count', async () => {
    const { h, u, personal, streak, expense, income } = await setup();
    const e = await read(await expense());
    await h.app.request(`/v1/expenses/${e.id}`, { method: 'DELETE', headers: u.as(personal) });
    const r = await read(await income());
    await h.app.request(`/v1/income/${r.id}`, { method: 'DELETE', headers: u.as(personal) });
    expect((await read(await streak())).current).toBe(0);
  });

  it('a whole day missed ends it; the run before is previous', async () => {
    const { streak, expense, day } = await setup();
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
      day(`${d}T09:00:00Z`);
      await expense();
    }
    day('2026-10-12T09:00:00Z');
    await expense();
    expect(await read(await streak())).toMatchObject({ current: 1, previous: { days: 4, lastDay: '2026-10-08' } });
  });

  it('S4: an expense saved offline at 23:50 local and uploaded after midnight counts for its own day', async () => {
    const { streak, expense, day } = await setup();
    day('2026-10-11T09:00:00Z');
    await expense();
    // 23:50 on 10-12 in Jerusalem (UTC+3) is 20:50Z; it uploads at 00:05 on 10-13 (21:05Z).
    day('2026-10-12T21:05:00Z');
    await expense({ capturedAt: '2026-10-12T20:50:00Z' });
    expect(await read(await streak())).toMatchObject({ lastLoggedOn: '2026-10-12', current: 2 });
  });

  it('S4: a capturedAt older than 48 hours is clamped, so a streak cannot be backdated', async () => {
    const { streak, expense } = await setup();
    await expense({ capturedAt: '2026-09-01T09:00:00Z' });
    expect(await read(await streak())).toMatchObject({ lastLoggedOn: '2026-10-10', current: 0 });
  });

  it('a Business or firm profile → 409 NOT_PERSONAL', async () => {
    const { p, m, streak } = await setup();
    for (const profile of [p.id, m.id]) {
      const res = await streak(profile);
      expect(res.status).toBe(409);
      expect((await read(res)).error.details.reason).toBe('NOT_PERSONAL');
    }
  });

  it('an API key cannot read it', async () => {
    const { h, mAuth } = await setup();
    expect((await h.app.request('/v1/expenses/streak', { headers: mAuth })).status).toBe(403);
  });
});
