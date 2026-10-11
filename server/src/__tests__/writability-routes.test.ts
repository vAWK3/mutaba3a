import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { buildRouteAccessIndex, type RouteAccess } from '../auth/middleware.js';
import { SCOPES } from '../auth/scopes.js';
import { STORE_ACCESS, type MethodAccess } from '../auth/store-guard.js';
import { domainOfScope, matrixRow, type Access } from '../auth/writability.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { LedgerStore } from '../repositories/ports.js';

/**
 * MUT-39: the writability matrix (hosted-portal.md §5) as route behaviour.
 * Expectations are derived from the matrix plus each route's declared
 * `security` and tagged `requireScope`, so a new route is covered the moment
 * it exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const PLACEHOLDER = '00000000-0000-4000-8000-0000000000aa';
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Call {
  repo: string;
  method: string;
  args: unknown[];
}

/** The base store, recording every repository call that reaches it. */
function recording(base: MemoryLedgerStore): { store: LedgerStore; calls: Call[] } {
  const calls: Call[] = [];
  const store = new Proxy(base, {
    get(target, repo) {
      const value: unknown = Reflect.get(target, repo, target);
      if (typeof value === 'function') return value.bind(target);
      if (typeof repo !== 'string' || typeof value !== 'object' || value === null) return value;
      return new Proxy(value, {
        get(r, method) {
          const fn: unknown = Reflect.get(r, method, r);
          if (typeof method !== 'string' || typeof fn !== 'function') return fn;
          return (...args: unknown[]) => {
            calls.push({ repo, method, args });
            return (fn as (...a: unknown[]) => unknown).apply(r, args);
          };
        },
      });
    },
  });
  return { store, calls };
}

function harness() {
  const base = new MemoryLedgerStore();
  const { store, calls } = recording(base);
  const clock = { now: new Date('2026-10-20T09:00:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    attachments: new MemoryAttachmentStorage(),
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, base, calls, clock };
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
    await h.base.integrations.connect({ organizationId: org.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: org.name, connectedByApiKeyId: key.apiKey.id, at: h.clock.now });
  }
  await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
  const customer = await read(await h.app.request('/v1/customers', json({ name: `Haddad ${seq}` }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Sale', currency: 'ILS' }, { ...auth, ...idem() })));
  const fixed = {
    projectId: project.id,
    amount: '1000.00',
    pricingBasis: 'VAT_EXCLUSIVE',
    vatTreatment: 'EXEMPT',
    agreementDate: '2026-10-01',
    paymentTerms: 'EOM',
    installments: [{ label: 'I1', amount: '1000.00', trigger: { type: 'DATE', date: '2026-10-25' } }],
  };
  const preview = await read(await h.app.request('/v1/agreements/preview', json(fixed, auth)));
  const agreement = (await read(await h.app.request('/v1/agreements', json({ ...fixed, previewToken: preview.previewToken }, { ...auth, ...idem() })))).agreement;
  const retained = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Retainer', currency: 'ILS' }, { ...auth, ...idem() })));
  const terms = { projectId: retained.id, monthlyAmount: '2000.00', pricingBasis: 'VAT_INCLUSIVE', startMonth: '2026-11', billingDay: 1, paymentTerms: 'EOM_15' };
  const retainerPreview = await read(await h.app.request('/v1/retainers/preview', json(terms, auth)));
  const retainer = (await read(await h.app.request('/v1/retainers', json({ ...terms, previewToken: retainerPreview.previewToken }, { ...auth, ...idem() })))).agreement;
  if (!agreement?.id || !retainer?.id) throw new Error('fixture: the agreement or the retainer was not created');
  return { org: org as { id: string }, auth, customer, project, agreement, retainer };
}

async function partner(h: Harness, organizationIds: string[]) {
  const [first, ...rest] = organizationIds;
  const email = `partner${++seq}@firm.ps`;
  const created = await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId: first }, admin)));
  for (const organizationId of rest) await h.app.request(`/admin/v1/users/${created.user.id}/memberships`, json({ organizationId }, admin));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.initialPassword }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return (profile: string, extra: Record<string, string> = {}) => ({ cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': profile, ...SAME_ORIGIN, ...extra });
}

// ---- the inventory, read the way authenticate() reads it -------------------

interface Operation extends RouteAccess {
  key: string;
  method: string;
  path: string;
}

const INVENTORY: Operation[] = (() => {
  const { app } = harness();
  return [...buildRouteAccessIndex(app.openAPIRegistry.definitions, app.routes)]
    .filter(([key]) => key.split(' ')[1]!.startsWith('/v1/'))
    .map(([key, access]) => ({ key, method: key.split(' ')[0]!, path: key.split(' ')[1]!, ...access }));
})();
const SCOPED = INVENTORY.filter((op) => op.scopes.length > 0);
const KEY_ONLY = SCOPED.filter((op) => op.principals.has('apiKey') && !op.principals.has('session'));
const SESSION_READS = SCOPED.filter((op) => op.principals.has('session') && op.method === 'GET');
/** Reads that write by design: the first category list seeds a preset (MUT-42 D2). */
const SEEDING_READS = new Set(['GET /v1/expense-categories']);

const grants = (access: Access, scope: string) => access === 'read-write' || (access === 'read' && scope.endsWith(':read'));
const malafatWrite = (op: Operation) =>
  op.scopes
    .filter((s) => s.endsWith(':write'))
    .map(domainOfScope)
    .find((d) => d !== undefined && matrixRow(d).writerOfRecord === 'MALAFAT');
const bigintSafe = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
const accessOf = (c: Call): MethodAccess | undefined => (STORE_ACCESS as Record<string, Record<string, MethodAccess>>)[c.repo]?.[c.method];
const isWrite = (a: MethodAccess | undefined) => typeof a === 'object' && 'write' in a;
const writes = (calls: Call[]) => calls.filter((c) => isWrite(accessOf(c))).map((c) => `${c.repo}.${c.method}`);

function send(h: Harness, op: Operation, headers: Record<string, string>, ids: Record<string, string> = {}) {
  const path = op.path.replace(/:([A-Za-z]+)/g, (_m, name: string) => ids[name] ?? PLACEHOLDER);
  return h.app.request(path, {
    method: op.method,
    headers: { 'content-type': 'application/json', 'idempotency-key': `w-${++ik}`, 'if-match': '1', ...headers },
    ...(op.method === 'GET' || op.method === 'DELETE' ? {} : { body: '{}' }),
  });
}

describe('every route sits inside the matrix', () => {
  it('reads a non-trivial inventory', () => {
    expect(KEY_ONLY.length).toBeGreaterThan(30);
    // The portal's 20 ledger reads (MUT-38) and 5 expense reads (MUT-42).
    expect(SESSION_READS.length).toBe(25);
  });

  it.each(SCOPED.map((op) => [op.key, op] as const))('%s: each scope is a matrix row, granted by every principal it declares', (_key, op) => {
    for (const scope of op.scopes) {
      const domain = domainOfScope(scope);
      expect(domain, scope).toBeDefined();
      const row = matrixRow(domain!);
      if (op.principals.has('session')) expect(grants(row.session, scope), `session ${scope}`).toBe(true);
      if (op.principals.has('apiKey')) expect(grants(row.apiKey, scope), `apiKey ${scope}`).toBe(true);
    }
  });
});

describe('a session on a key-only operation (hosted-portal.md §5 layer 2)', () => {
  let h: Harness;
  let a: Awaited<ReturnType<typeof firm>>;
  let b: Awaited<ReturnType<typeof firm>>;
  let c: Awaited<ReturnType<typeof firm>>;
  let as: Awaited<ReturnType<typeof partner>>;

  beforeAll(async () => {
    h = harness();
    a = await firm(h, { malafat: true });
    b = await firm(h, { malafat: false });
    c = await firm(h, { malafat: true }); // not a member
    as = await partner(h, [a.org.id, b.org.id]);
  });

  it.each(KEY_ONLY.map((op) => [op.key, op] as const))('%s', async (_key, op) => {
    const domain = malafatWrite(op);
    for (const [profile, writer] of [
      [a.org.id, 'MALAFAT'],
      [b.org.id, null],
      [c.org.id, null], // a non-member's writer of record is never revealed
    ] as const) {
      h.calls.length = 0;
      const res = await send(h, op, as(profile));
      const body = await read(res);
      expect(res.status, profile).toBe(403);
      if (domain) {
        expect(body.error.code).toBe('READ_ONLY_PROFILE');
        expect(body.error.details).toEqual({ domain, writerOfRecord: writer });
      } else {
        expect(body.error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
        expect(body.error.details).toBeUndefined();
      }
      expect(writes(h.calls)).toEqual([]);
    }
  });

  it.each(SESSION_READS.filter((op) => !op.path.includes(':')).map((op) => [op.key, op] as const))('%s answers 200 to a session (a read row)', async (_key, op) => {
    expect((await send(h, op, as(a.org.id))).status).toBe(200);
  });
});

describe('the acceptance criteria’s entity writes, refused with nothing written', () => {
  let h: Harness;
  let a: Awaited<ReturnType<typeof firm>>;
  let as: Awaited<ReturnType<typeof partner>>;
  let receivableId: string;
  let installmentId: string;

  beforeAll(async () => {
    h = harness();
    a = await firm(h, { malafat: true });
    const detail = await read(await h.app.request(`/v1/agreements/${a.agreement.id}`, { headers: a.auth }));
    installmentId = detail.installments[0].id;
    h.clock.now = new Date('2026-10-26T09:00:00Z');
    receivableId = (await read(await h.app.request('/v1/receivables', { headers: a.auth }))).items[0].id;
    as = await partner(h, [a.org.id]);
  });

  const cases: Array<[label: string, path: () => string, body: () => unknown, domain: string]> = [
    ['income: an agreement', () => '/v1/agreements', () => ({ projectId: a.project.id, amount: '500.00', previewToken: 'x' }), 'agreements'],
    ['income: posting an installment', () => `/v1/installments/${installmentId}/trigger`, () => ({}), 'agreements'],
    ['receivable: a credit', () => `/v1/receivables/${receivableId}/credits`, () => ({ amount: '10.00', reason: 'Goodwill' }), 'payments'],
    ['payment: recording one', () => '/v1/payments', () => ({ customerId: a.customer.id, currency: 'ILS', amount: '100.00', receivedOn: '2026-10-26' }), 'payments'],
    ['customer: creating one', () => '/v1/customers', () => ({ name: 'New client' }), 'customers'],
  ];

  it.each(cases)('%s → 403 READ_ONLY_PROFILE', async (_label, path, body, domain) => {
    h.calls.length = 0;
    const res = await h.app.request(path(), json(body(), { ...as(a.org.id), ...idem() }));
    expect(res.status).toBe(403);
    expect((await read(res)).error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { domain, writerOfRecord: 'MALAFAT' } });
    expect(writes(h.calls)).toEqual([]);
  });
});

describe('the escape hatch', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sources(full);
      return full.endsWith('.ts') ? [full] : [];
    });
  }
  /** One entry per matching line of code (comments are not call sites). */
  const callSites = (pattern: RegExp) =>
    sources(SRC)
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && pattern.test(line))
          .map(() => relative(SRC, file)),
      )
      .sort();

  it('unguarded() is called only by lazyPostingOf', () => {
    expect(callSites(/(?<!function )\bunguarded\(/)).toEqual(['auth/middleware.ts']);
  });

  it('lazyPostingOf() is called only by the session-reachable reads that post', () => {
    expect(callSites(/(?<!function )\blazyPostingOf\(/)).toEqual([
      'routes/agreements.ts',
      'routes/agreements.ts',
      'routes/receivables.ts',
      'routes/retainers.ts',
      'routes/summaries.ts',
      'routes/summaries.ts',
      'routes/summaries.ts',
    ]);
  });
});

describe('lazy posting during a session read is a system act (ADR-037 decision 8)', () => {
  const LAZY: Array<[route: string, path: (f: Awaited<ReturnType<typeof firm>>) => string, posts: { installment: number; charge: number }]> = [
    ['GET /v1/summaries/organization', () => '/v1/summaries/organization', { installment: 1, charge: 1 }],
    ['GET /v1/summaries/customers/{customerId}', (f) => `/v1/summaries/customers/${f.customer.id}`, { installment: 1, charge: 1 }],
    ['GET /v1/summaries/projects/{projectId}', (f) => `/v1/summaries/projects/${f.project.id}`, { installment: 1, charge: 1 }],
    ['GET /v1/receivables', () => '/v1/receivables', { installment: 1, charge: 1 }],
    ['GET /v1/agreements', () => '/v1/agreements', { installment: 1, charge: 1 }],
    ['GET /v1/agreements/{agreementId}', (f) => `/v1/agreements/${f.agreement.id}`, { installment: 1, charge: 1 }],
    ['GET /v1/retainers/{agreementId}/charges', (f) => `/v1/retainers/${f.retainer.id}/charges`, { installment: 0, charge: 1 }],
  ];

  it('no other session read posts anything', async () => {
    const h = harness();
    const f = await firm(h, { malafat: true });
    h.clock.now = new Date('2026-11-02T09:00:00Z');
    const as = await partner(h, [f.org.id]);
    const lazy = new Set(LAZY.map(([route]) => route));
    const others = SESSION_READS.filter((op) => !lazy.has(op.key.replace(/:([A-Za-z]+)/g, '{$1}')));
    expect(others).toHaveLength(SESSION_READS.length - LAZY.length);
    for (const op of others) {
      h.calls.length = 0;
      await send(h, op, as(f.org.id), { customerId: f.customer.id, projectId: f.project.id, agreementId: f.agreement.id });
      expect(writes(h.calls), op.key).toEqual(SEEDING_READS.has(op.key) ? ['expenseCategories.seed'] : []);
    }
  });

  it.each(LAZY)('%s posts what fell due once, as SYSTEM, on a Malafat-fed profile', async (_route, path, posts) => {
    const h = harness();
    const f = await firm(h, { malafat: true });
    h.clock.now = new Date('2026-11-02T09:00:00Z');
    const as = await partner(h, [f.org.id]);

    for (let i = 0; i < 2; i++) expect((await h.app.request(path(f), { headers: as(f.org.id) })).status).toBe(200);

    const rows = (await h.base.audit.list(f.org.id, {}, { limit: 500, cursor: null })).items;
    const posted = rows.filter((e) => e.action === 'installment.posted' || e.action === 'retainer.charged');
    expect(posted.filter((e) => e.action === 'installment.posted')).toHaveLength(posts.installment);
    expect(posted.filter((e) => e.action === 'retainer.charged')).toHaveLength(posts.charge);
    for (const e of posted) expect(e).toMatchObject({ actorType: 'SYSTEM', actorId: null });
    expect(rows.filter((e) => e.actorType === 'USER').map((e) => e.action)).toEqual(['user.signed_in']);
  });
});

describe('switching profiles never leaks one profile’s figures into another (asserted at the query layer)', () => {
  let h: Harness;
  let a: Awaited<ReturnType<typeof firm>>;
  let b: Awaited<ReturnType<typeof firm>>;
  let as: Awaited<ReturnType<typeof partner>>;

  beforeAll(async () => {
    h = harness();
    a = await firm(h, { malafat: true });
    b = await firm(h, { malafat: false });
    h.clock.now = new Date('2026-11-02T09:00:00Z');
    as = await partner(h, [a.org.id, b.org.id]);
  });

  it('lists each profile’s own customers, and customers.list only ever receives the header’s organization', async () => {
    for (const [mine, theirs] of [
      [a, b],
      [b, a],
    ] as const) {
      h.calls.length = 0;
      const page = await read(await h.app.request('/v1/customers', { headers: as(mine.org.id) }));
      expect(page.items.map((x: Loose) => x.id)).toEqual([mine.customer.id]);
      const lists = h.calls.filter((call) => call.repo === 'customers' && call.method === 'list');
      expect(lists.length).toBeGreaterThan(0);
      for (const call of lists) expect(call.args[0]).toBe(mine.org.id);
      expect((await h.app.request(`/v1/customers/${theirs.customer.id}`, { headers: as(mine.org.id) })).status).toBe(404);
    }
  });

  it.each(SESSION_READS.map((op) => [op.key, op] as const))(
    '%s: the other profile’s organization id never reaches the store',
    async (_key, op) => {
      for (const [mine, theirs] of [
        [a, b],
        [b, a],
      ] as const) {
        h.calls.length = 0;
        const ids = { customerId: mine.customer.id, projectId: mine.project.id, agreementId: op.path.startsWith('/v1/retainers') ? mine.retainer.id : mine.agreement.id };
        const res = await send(h, op, as(mine.org.id), ids);
        expect([200, 404], op.key).toContain(res.status);
        const leaked = h.calls.filter((call) => bigintSafe(call.args).includes(theirs.org.id)).map((call) => `${call.repo}.${call.method}`);
        expect(leaked).toEqual([]);
      }
    },
  );
});
