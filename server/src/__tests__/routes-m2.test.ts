import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, API_VERSION } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };

interface Harness {
  app: ReturnType<typeof createApp>;
  store: MemoryLedgerStore;
  clock: { now: Date };
}

function harness(): Harness {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-08T10:00:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(10_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.2.0-test',
    now: () => clock.now,
  });
  return { app, store, clock };
}

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

async function provision(h: Harness, scopes: readonly string[] = SCOPES, bind = true) {
  const orgRes = await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin));
  expect(orgRes.status).toBe(201);
  const org = (await read(orgRes)) as { id: string };
  const keyRes = await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes }, admin));
  expect(keyRes.status).toBe(201);
  const key = (await read(keyRes)) as { secret: string; apiKey: { id: string } };
  const auth = { authorization: `Bearer ${key.secret}` };
  if (bind) {
    const bound = await h.app.request('/v1/integration/bind', json({ provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Tenant' }, { ...auth, 'idempotency-key': `bind-key-${seq}` }));
    expect(bound.status).toBe(201);
  }
  return { org, key, auth };
}

let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function createCustomer(h: Harness, auth: Record<string, string>, body: Record<string, unknown>, headers: Record<string, string> = idem()) {
  return h.app.request('/v1/customers', json(body, { ...auth, ...headers }));
}

async function createProject(h: Harness, auth: Record<string, string>, body: Record<string, unknown>, headers: Record<string, string> = idem()) {
  return h.app.request('/v1/projects', json(body, { ...auth, ...headers }));
}

describe('scopes', () => {
  it('refuses writes without the write scope and names the missing scope', async () => {
    const h = harness();
    const { auth } = await provision(h, ['customers:read', 'projects:read', 'integration:read', 'integration:write']);
    const c = await createCustomer(h, auth, { name: 'Acme' });
    expect(c.status).toBe(403);
    expect((await read(c)).error).toMatchObject({ code: 'INSUFFICIENT_SCOPE', details: { required: 'customers:write' } });
    const p = await createProject(h, auth, { customerId: '00000000-0000-4000-8000-000000000000', name: 'P', currency: 'ILS' });
    expect((await read(p)).error.details.required).toBe('projects:write');
    const imp = await h.app.request('/v1/import/preview', json({ provider: 'MALAFAT', rows: [] }, auth));
    expect(imp.status).toBe(403);
    expect((await read(imp)).error.details.required).toBe('customers:write');
  });

  it('import needs both write scopes and names whichever is missing', async () => {
    const h = harness();
    const { auth } = await provision(h, ['customers:write', 'customers:read', 'integration:write', 'integration:read']);
    const imp = await h.app.request('/v1/import/preview', json({ provider: 'MALAFAT', rows: [] }, auth));
    expect(imp.status).toBe(403);
    expect((await read(imp)).error.details.required).toBe('projects:write');
  });

  it('refuses reads without the read scope', async () => {
    const h = harness();
    const { auth } = await provision(h, ['customers:write', 'integration:write', 'integration:read']);
    expect((await h.app.request('/v1/customers', { headers: auth })).status).toBe(403);
    expect((await h.app.request('/v1/projects', { headers: auth })).status).toBe(403);
  });
});

describe('customers', () => {
  it('creates, serializes without organizationId, requires and replays Idempotency-Key', async () => {
    const h = harness();
    const { auth } = await provision(h);
    const missing = await createCustomer(h, auth, { name: 'Acme' }, {});
    expect(missing.status).toBe(422);
    expect((await read(missing)).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const key = idem();
    const res = await createCustomer(h, auth, { name: 'Acme', email: 'a@acme.test' }, key);
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(body).toMatchObject({ name: 'Acme', email: 'a@acme.test', phone: null, notes: null, status: 'ACTIVE', version: 1, externalReference: null });
    expect(body.organizationId).toBeUndefined();
    expect(body.createdAt).toBe('2026-10-08T10:00:00.000Z');

    const replay = await createCustomer(h, auth, { name: 'Acme', email: 'a@acme.test' }, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect((await read(replay)).id).toBe(body.id);
  });

  it('returns the existing customer for a known external reference instead of a duplicate', async () => {
    const h = harness();
    const { auth, org } = await provision(h);
    const first = await createCustomer(h, auth, { name: 'Acme', externalReference: { provider: 'MALAFAT', externalId: 'client-1' } });
    expect(first.status).toBe(201);
    const firstBody = await read(first);
    expect(firstBody.externalReference).toEqual({ provider: 'MALAFAT', externalId: 'client-1' });
    const audits = h.store.auditCount(org.id);

    const again = await createCustomer(h, auth, { name: 'Acme renamed', externalReference: { provider: 'MALAFAT', externalId: 'client-1' } });
    expect(again.status).toBe(200);
    const againBody = await read(again);
    expect(againBody.id).toBe(firstBody.id);
    expect(againBody.name).toBe('Acme');
    expect(h.store.auditCount(org.id)).toBe(audits);
    const list = await read(await h.app.request('/v1/customers', { headers: auth }));
    expect(list.items).toHaveLength(1);
  });

  it('refuses an external reference when the integration is not connected', async () => {
    const h = harness();
    const { auth } = await provision(h, SCOPES, false);
    const res = await createCustomer(h, auth, { name: 'Acme', externalReference: { provider: 'MALAFAT', externalId: 'client-1' } });
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'INTEGRATION_NOT_CONNECTED' } });
    const plain = await createCustomer(h, auth, { name: 'Acme' });
    expect(plain.status).toBe(201);
  });

  it('validates the body', async () => {
    const h = harness();
    const { auth } = await provision(h);
    expect((await createCustomer(h, auth, { name: '' })).status).toBe(422);
    expect((await createCustomer(h, auth, { name: 'A', email: 'not-an-email' })).status).toBe(422);
  });

  it('gets own customers, 404s another organization’s id, 422s a malformed id', async () => {
    const h = harness();
    const a = await provision(h);
    const b = await provision(h);
    const created = await read(await createCustomer(h, a.auth, { name: 'Acme' }));
    expect((await h.app.request(`/v1/customers/${created.id}`, { headers: a.auth })).status).toBe(200);
    expect((await h.app.request(`/v1/customers/${created.id}`, { headers: b.auth })).status).toBe(404);
    expect((await h.app.request('/v1/customers/not-a-uuid', { headers: a.auth })).status).toBe(422);
  });

  it('lists with filters and cursor pagination, capped at 200', async () => {
    const h = harness();
    const { auth } = await provision(h);
    for (let i = 0; i < 7; i += 1) {
      h.clock.now = new Date(h.clock.now.getTime() + 1);
      await createCustomer(h, auth, { name: `C${i}`, ...(i === 3 ? { externalReference: { provider: 'MALAFAT', externalId: 'x3' } } : {}) });
    }
    const page1 = await read(await h.app.request('/v1/customers?limit=3', { headers: auth }));
    expect(page1.items.map((c: Loose) => c.name)).toEqual(['C0', 'C1', 'C2']);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await read(await h.app.request(`/v1/customers?limit=3&cursor=${page1.nextCursor}`, { headers: auth }));
    expect(page2.items.map((c: Loose) => c.name)).toEqual(['C3', 'C4', 'C5']);
    const page3 = await read(await h.app.request(`/v1/customers?limit=3&cursor=${page2.nextCursor}`, { headers: auth }));
    expect(page3.items.map((c: Loose) => c.name)).toEqual(['C6']);
    expect(page3.nextCursor).toBeNull();

    const byExt = await read(await h.app.request('/v1/customers?externalId=x3', { headers: auth }));
    expect(byExt.items.map((c: Loose) => c.name)).toEqual(['C3']);
    expect(byExt.items[0].externalReference).toEqual({ provider: 'MALAFAT', externalId: 'x3' });
    expect((await h.app.request('/v1/customers?limit=201', { headers: auth })).status).toBe(422);
    expect((await h.app.request('/v1/customers?cursor=garbage', { headers: auth })).status).toBe(422);
  });

  it('patches with If-Match, bumps version, refuses stale versions, audits the changed fields', async () => {
    const h = harness();
    const { auth, org } = await provision(h);
    const c = await read(await createCustomer(h, auth, { name: 'Acme' }));
    const noHeader = await h.app.request(`/v1/customers/${c.id}`, json({ name: 'Acme Ltd' }, auth, 'PATCH'));
    expect(noHeader.status).toBe(422);
    const ok = await h.app.request(`/v1/customers/${c.id}`, json({ name: 'Acme Ltd', phone: '+972' }, { ...auth, 'if-match': '1' }, 'PATCH'));
    expect(ok.status).toBe(200);
    expect(await read(ok)).toMatchObject({ name: 'Acme Ltd', phone: '+972', version: 2 });
    const stale = await h.app.request(`/v1/customers/${c.id}`, json({ name: 'Nope' }, { ...auth, 'if-match': '1' }, 'PATCH'));
    expect(stale.status).toBe(409);
    expect((await read(stale)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'VERSION_MISMATCH', currentVersion: 2 } });
    const events = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/audit`, { headers: admin }))).events as Loose[];
    const updated = events.find((e) => e.action === 'customer.updated');
    expect(updated).toMatchObject({ entityId: c.id, metadata: { fields: ['name', 'phone'] } });
  });

  it('archives: refuses while a project is active, then succeeds, idempotently, auditing once', async () => {
    const h = harness();
    const { auth, org } = await provision(h);
    const c = await read(await createCustomer(h, auth, { name: 'Acme' }));
    const p = await read(await createProject(h, auth, { customerId: c.id, name: 'Case', currency: 'ILS' }));
    const blocked = await h.app.request(`/v1/customers/${c.id}/archive`, json({}, { ...auth, ...idem() }));
    expect(blocked.status).toBe(409);
    expect((await read(blocked)).error.details).toMatchObject({ reason: 'HAS_ACTIVE_PROJECTS', activeProjects: 1 });
    expect((await h.app.request(`/v1/projects/${p.id}/archive`, json({}, { ...auth, ...idem() }))).status).toBe(200);
    const first = await h.app.request(`/v1/customers/${c.id}/archive`, json({}, { ...auth, ...idem() }));
    expect(first.status).toBe(200);
    expect(await read(first)).toMatchObject({ status: 'ARCHIVED', archivedAt: '2026-10-08T10:00:00.000Z' });
    const second = await h.app.request(`/v1/customers/${c.id}/archive`, json({}, { ...auth, ...idem() }));
    expect(second.status).toBe(200);
    const events = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/audit`, { headers: admin }))).events as Loose[];
    expect(events.filter((e) => e.action === 'customer.archived')).toHaveLength(1);
  });
});

describe('projects', () => {
  it('creates with a customer, rejects unknown, archived or foreign customers and unsupported currency', async () => {
    const h = harness();
    const a = await provision(h);
    const b = await provision(h);
    const c = await read(await createCustomer(h, a.auth, { name: 'Acme' }));
    const ok = await createProject(h, a.auth, { customerId: c.id, name: 'Case', currency: 'ILS' });
    expect(ok.status).toBe(201);
    const okBody = await read(ok);
    expect(okBody).toMatchObject({ customerId: c.id, currency: 'ILS', status: 'ACTIVE', version: 1, externalReference: null });

    const foreign = await createProject(h, b.auth, { customerId: c.id, name: 'Case', currency: 'ILS' });
    expect(foreign.status).toBe(422);
    expect((await read(foreign)).error.details).toMatchObject({ field: 'customerId' });
    expect((await createProject(h, a.auth, { customerId: c.id, name: 'Case', currency: 'GBP' })).status).toBe(422);

    await h.app.request(`/v1/projects/${okBody.id}/archive`, json({}, { ...a.auth, ...idem() }));
    await h.app.request(`/v1/customers/${c.id}/archive`, json({}, { ...a.auth, ...idem() }));
    const archived = await createProject(h, a.auth, { customerId: c.id, name: 'Case 2', currency: 'ILS' });
    expect(archived.status).toBe(422);
    expect((await read(archived)).error.details).toMatchObject({ field: 'customerId', reason: 'CUSTOMER_ARCHIVED' });
  });

  it('is idempotent by external reference and refuses a reference bound to another customer', async () => {
    const h = harness();
    const { auth } = await provision(h);
    const c1 = await read(await createCustomer(h, auth, { name: 'One' }));
    const c2 = await read(await createCustomer(h, auth, { name: 'Two' }));
    const ref = { provider: 'MALAFAT', externalId: 'matter-1' };
    const first = await read(await createProject(h, auth, { customerId: c1.id, name: 'Case', currency: 'ILS', externalReference: ref }));
    const same = await createProject(h, auth, { customerId: c1.id, name: 'Case renamed', currency: 'USD', externalReference: ref });
    expect(same.status).toBe(200);
    expect(await read(same)).toMatchObject({ id: first.id, name: 'Case', currency: 'ILS' });
    const other = await createProject(h, auth, { customerId: c2.id, name: 'Case', currency: 'ILS', externalReference: ref });
    expect(other.status).toBe(409);
    expect((await read(other)).error.details).toMatchObject({ reason: 'CUSTOMER_MISMATCH', existingCustomerId: c1.id });
  });

  it('lists by customer, currency, status and external id', async () => {
    const h = harness();
    const { auth } = await provision(h);
    const c1 = await read(await createCustomer(h, auth, { name: 'One' }));
    const c2 = await read(await createCustomer(h, auth, { name: 'Two' }));
    // distinct timestamps so the (createdAt, id) order is the creation order
    await createProject(h, auth, { customerId: c1.id, name: 'P1', currency: 'ILS', externalReference: { provider: 'MALAFAT', externalId: 'm1' } });
    h.clock.now = new Date(h.clock.now.getTime() + 1);
    await createProject(h, auth, { customerId: c1.id, name: 'P2', currency: 'USD' });
    h.clock.now = new Date(h.clock.now.getTime() + 1);
    await createProject(h, auth, { customerId: c2.id, name: 'P3', currency: 'ILS' });
    const names = async (q: string) => ((await read(await h.app.request(`/v1/projects${q}`, { headers: auth }))).items as Loose[]).map((p) => p.name);
    expect(await names('')).toEqual(['P1', 'P2', 'P3']);
    expect(await names(`?customerId=${c1.id}`)).toEqual(['P1', 'P2']);
    expect(await names('?currency=ILS')).toEqual(['P1', 'P3']);
    expect(await names('?externalId=m1')).toEqual(['P1']);
    expect(await names('?status=ARCHIVED')).toEqual([]);
  });

  it('patches name and currency; locks currency once activity is posted; customerId is immutable', async () => {
    const h = harness();
    const { auth } = await provision(h);
    const c = await read(await createCustomer(h, auth, { name: 'One' }));
    const p = await read(await createProject(h, auth, { customerId: c.id, name: 'Case', currency: 'ILS' }));
    const ok = await h.app.request(`/v1/projects/${p.id}`, json({ name: 'Case A', currency: 'USD' }, { ...auth, 'if-match': '1' }, 'PATCH'));
    expect(ok.status).toBe(200);
    expect(await read(ok)).toMatchObject({ name: 'Case A', currency: 'USD', version: 2 });

    // M3: the currency locks as soon as the project has an agreement.
    await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2020-01-01' }, auth, 'PUT'));
    const body = { projectId: p.id, amount: '100.00', pricingBasis: 'VAT_EXCLUSIVE', agreementDate: '2026-10-08', paymentTerms: 'EOM', installments: [{ label: 'All', amount: '100.00', trigger: { type: 'MANUAL' } }] };
    const preview = await read(await h.app.request('/v1/agreements/preview', json(body, auth)));
    expect((await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...auth, ...idem() }))).status).toBe(201);
    const locked = await h.app.request(`/v1/projects/${p.id}`, json({ currency: 'EUR' }, { ...auth, 'if-match': '2' }, 'PATCH'));
    expect(locked.status).toBe(409);
    expect((await read(locked)).error.details).toMatchObject({ reason: 'CURRENCY_LOCKED' });
    const sameCurrency = await h.app.request(`/v1/projects/${p.id}`, json({ name: 'Case B', currency: 'USD' }, { ...auth, 'if-match': '2' }, 'PATCH'));
    expect(sameCurrency.status).toBe(200);

    const moved = await h.app.request(`/v1/projects/${p.id}`, json({ customerId: c.id }, { ...auth, 'if-match': '3' }, 'PATCH'));
    expect(moved.status).toBe(422);
  });
});

describe('import', () => {
  const rows = (prefix: string) => [
    { entityType: 'CUSTOMER', externalId: `${prefix}-c1`, name: 'Acme' },
    { entityType: 'CUSTOMER', externalId: `${prefix}-c2`, name: 'Beta', email: 'b@beta.test' },
    { entityType: 'PROJECT', externalId: `${prefix}-p1`, name: 'Case 1', currency: 'ILS', customerExternalId: `${prefix}-c1` },
    { entityType: 'PROJECT', externalId: `${prefix}-p2`, name: 'Case 2', currency: 'USD', customerExternalId: `${prefix}-c2` },
  ];

  it('preview writes nothing and reports per-row actions with a token', async () => {
    const h = harness();
    const { auth } = await provision(h);
    const res = await h.app.request('/v1/import/preview', json({ provider: 'MALAFAT', rows: rows('a') }, auth));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.rows.map((r: Loose) => r.action)).toEqual(['create', 'create', 'create', 'create']);
    expect(body.previewToken).toMatch(/^[0-9a-f]{64}$/);
    expect(body.totals).toEqual({ create: 4, link: 0, conflict: 0 });
    expect((await read(await h.app.request('/v1/customers', { headers: auth }))).items).toHaveLength(0);
  });

  it('rejects more than 500 rows and requires a connected integration', async () => {
    const h = harness();
    const { auth } = await provision(h);
    const many = Array.from({ length: 501 }, (_, i) => ({ entityType: 'CUSTOMER', externalId: `c${i}`, name: `N${i}` }));
    expect((await h.app.request('/v1/import/preview', json({ provider: 'MALAFAT', rows: many }, auth))).status).toBe(422);
    const unbound = await provision(h, SCOPES, false);
    const res = await h.app.request('/v1/import/preview', json({ provider: 'MALAFAT', rows: rows('u') }, unbound.auth));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details.reason).toBe('INTEGRATION_NOT_CONNECTED');
  });

  it('commit applies customers before projects, is idempotent on re-run, audits, and rejects a stale token', async () => {
    const h = harness();
    const { auth, org } = await provision(h);
    const preview = await read(await h.app.request('/v1/import/preview', json({ provider: 'MALAFAT', rows: rows('b') }, auth)));

    const stale = await h.app.request('/v1/import/commit', json({ provider: 'MALAFAT', rows: rows('b').slice(0, 2), previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(stale.status).toBe(409);
    expect((await read(stale)).error.details.reason).toBe('PREVIEW_STALE');

    const key = idem();
    const commit = await h.app.request('/v1/import/commit', json({ provider: 'MALAFAT', rows: rows('b'), previewToken: preview.previewToken }, { ...auth, ...key }));
    expect(commit.status).toBe(200);
    const body = await read(commit);
    expect(body.rows.map((r: Loose) => r.outcome)).toEqual(['created', 'created', 'created', 'created']);
    expect(body.totals).toEqual({ created: 4, linked: 0, failed: 0 });
    const projects = (await read(await h.app.request('/v1/projects', { headers: auth }))).items as Loose[];
    const customers = (await read(await h.app.request('/v1/customers', { headers: auth }))).items as Loose[];
    expect(projects.find((p) => p.name === 'Case 2').customerId).toBe(customers.find((c) => c.name === 'Beta').id);
    expect(customers.find((c) => c.name === 'Beta').email).toBe('b@beta.test');

    const replay = await h.app.request('/v1/import/commit', json({ provider: 'MALAFAT', rows: rows('b'), previewToken: preview.previewToken }, { ...auth, ...key }));
    expect(replay.headers.get('idempotent-replayed')).toBe('true');

    const rerun = await read(await h.app.request('/v1/import/commit', json({ provider: 'MALAFAT', rows: rows('b'), previewToken: preview.previewToken }, { ...auth, ...idem() })));
    expect(rerun.rows.map((r: Loose) => r.outcome)).toEqual(['linked', 'linked', 'linked', 'linked']);
    expect((await read(await h.app.request('/v1/customers', { headers: auth }))).items).toHaveLength(2);

    const events = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/audit`, { headers: admin }))).events as Loose[];
    expect(events.filter((e) => e.action === 'import.committed')).toHaveLength(2);
    expect(events.filter((e) => e.action === 'customer.created' && e.metadata?.import === true)).toHaveLength(2);
    expect(events.filter((e) => e.action === 'project.created' && e.metadata?.import === true)).toHaveLength(2);
    expect(events.find((e) => e.action === 'import.committed')?.metadata).toMatchObject({ totals: { created: 0, linked: 4, failed: 0 } });
  });

  it('commit reports a failing row without rolling back the rows before it', async () => {
    const h = harness();
    const { auth } = await provision(h);
    const bad = [
      { entityType: 'CUSTOMER', externalId: 'c1', name: 'Acme' },
      { entityType: 'PROJECT', externalId: 'p1', name: 'Case', currency: 'ILS', customerExternalId: 'ghost' },
      { entityType: 'PROJECT', externalId: 'p2', name: 'Case', currency: 'ILS', customerExternalId: 'c1' },
    ];
    const preview = await read(await h.app.request('/v1/import/preview', json({ provider: 'MALAFAT', rows: bad }, auth)));
    expect(preview.rows[1]).toMatchObject({ action: 'conflict', reason: 'UNKNOWN_CUSTOMER' });
    const commit = await read(await h.app.request('/v1/import/commit', json({ provider: 'MALAFAT', rows: bad, previewToken: preview.previewToken }, { ...auth, ...idem() })));
    expect(commit.rows.map((r: Loose) => r.outcome)).toEqual(['created', 'failed', 'created']);
    expect(commit.rows[1].reason).toBe('UNKNOWN_CUSTOMER');
    expect(commit.totals).toEqual({ created: 2, linked: 0, failed: 1 });
  });

  it('keeps organizations apart even with identical external ids', async () => {
    const h = harness();
    const a = await provision(h);
    const b = await provision(h);
    for (const side of [a, b]) {
      const preview = await read(await h.app.request('/v1/import/preview', json({ provider: 'MALAFAT', rows: rows('same') }, side.auth)));
      const commit = await read(await h.app.request('/v1/import/commit', json({ provider: 'MALAFAT', rows: rows('same'), previewToken: preview.previewToken }, { ...side.auth, ...idem() })));
      expect(commit.totals.created).toBe(4);
    }
    expect((await read(await h.app.request('/v1/customers?externalId=same-c1', { headers: a.auth }))).items).toHaveLength(1);
    expect((await read(await h.app.request('/v1/projects', { headers: b.auth }))).items).toHaveLength(2);
  });
});

describe('contract', () => {
  it('publishes every M2 path and the reason vocabulary at API version 1.1.0-m2', async () => {
    const h = harness();
    const doc = await read(await h.app.request('/openapi.json'));
    expect(doc.info.version).toBe(API_VERSION);
    expect(API_VERSION).toBe('1.8.0-mut37');
    for (const path of ['/v1/customers', '/v1/customers/{customerId}', '/v1/customers/{customerId}/archive', '/v1/projects', '/v1/projects/{projectId}', '/v1/projects/{projectId}/archive', '/v1/import/preview', '/v1/import/commit']) {
      expect(doc.paths[path], path).toBeDefined();
    }
    expect(doc.paths['/v1/customers/{customerId}'].patch).toBeDefined();
    for (const reason of ['VERSION_MISMATCH', 'CURRENCY_LOCKED', 'CUSTOMER_MISMATCH', 'HAS_ACTIVE_PROJECTS', 'PREVIEW_STALE', 'INTEGRATION_NOT_CONNECTED']) {
      expect(doc.info.description).toContain(reason);
    }
  });
});
