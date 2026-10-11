import { beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { buildRouteAccessIndex, type RouteAccessIndex } from '../auth/middleware.js';
import { domainOfScope, matrixRow } from '../auth/writability.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * ADR-037 decision 5: every /v1 route declares the principals it accepts in its
 * OpenAPI `security`, and authenticate() enforces exactly that declaration.
 * Everything here is generated from the published document, so a new route is
 * covered the moment it exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const PLACEHOLDER = '00000000-0000-4000-8000-0000000000aa';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** MUT-42: a hosted profile's expenses — sessions only, never a key. */
const EXPENSE_OPERATIONS = [
  'PATCH /v1/expense-categories/{categoryId}',
  'DELETE /v1/expenses/{expenseId}',
  'DELETE /v1/expenses/{expenseId}/receipts/{receiptId}',
  'GET /v1/expense-categories',
  'GET /v1/expenses',
  'GET /v1/expenses/{expenseId}',
  'GET /v1/expenses/{expenseId}/receipts/{receiptId}/download',
  'GET /v1/summaries/expenses',
  'PATCH /v1/expenses/{expenseId}',
  'POST /v1/expense-categories',
  'POST /v1/expenses',
  'POST /v1/expenses/{expenseId}/receipts',
  'POST /v1/expenses/{expenseId}/receipts/{receiptId}/complete',
];

/** The portal's read surface (hosted-portal.md §5–§6), the two identity routes, and the expense operations. */
const SESSION_OPERATIONS = [
  ...EXPENSE_OPERATIONS,
  'DELETE /v1/sessions/current',
  'GET /v1/agreements',
  'GET /v1/agreements/{agreementId}',
  'GET /v1/attachments',
  'GET /v1/attachments/{attachmentId}/download',
  'GET /v1/customers',
  'GET /v1/customers/{customerId}',
  'GET /v1/fee-proposals',
  'GET /v1/fee-proposals/{proposalId}',
  'GET /v1/me',
  'GET /v1/payments',
  'GET /v1/payments/{paymentId}',
  'GET /v1/projects',
  'GET /v1/projects/{projectId}',
  'GET /v1/receivables',
  'GET /v1/receivables/{receivableId}',
  'GET /v1/receivables/{receivableId}/credits',
  'GET /v1/retainers/{agreementId}/charges',
  'GET /v1/summaries/customers/{customerId}',
  'GET /v1/summaries/organization',
  'GET /v1/summaries/projects/{projectId}',
  'GET /v1/vat-rates',
].sort();
const PUBLIC_OPERATIONS = ['POST /v1/sessions'];
const IDENTITY_OPERATIONS = ['GET /v1/me', 'DELETE /v1/sessions/current'];

interface Operation {
  key: string;
  method: string;
  path: string;
  security: Array<Record<string, unknown>> | undefined;
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

let app: ReturnType<typeof createApp>;
let operations: Operation[];
let routeAccess: RouteAccessIndex;
let sessionCookie: string;
let orgId: string;
let fullKey: string;
const scopedKeys: string[] = [];

beforeAll(async () => {
  app = createApp({
    store: new MemoryLedgerStore(),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: 'test',
  });
  const doc = (await (await app.request('/openapi.json')).json()) as { paths: Record<string, Record<string, Loose>> };
  operations = Object.entries(doc.paths)
    .filter(([path]) => path.startsWith('/v1/'))
    .flatMap(([path, item]) =>
      METHODS.filter((m) => item[m]).map((m) => ({ key: `${m.toUpperCase()} ${path}`, method: m.toUpperCase(), path, security: item[m].security })),
    );
  routeAccess = buildRouteAccessIndex(app.openAPIRegistry.definitions, app.routes);

  const org = await (await app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin))).json() as { id: string };
  orgId = org.id;
  const key = async (scopes: string[]) => ((await (await app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'k', scopes }, admin))).json()) as { secret: string }).secret;
  fullKey = await key(['integration:read']);
  scopedKeys.push(await key(['audit:read']), await key(['integration:read']));

  const created = (await (await app.request('/admin/v1/users', json({ email: 'nour@firm.ps', displayName: 'Nour', organizationId: org.id }, admin))).json()) as { initialPassword: string };
  const signIn = await app.request('/v1/sessions', json({ email: 'nour@firm.ps', password: created.initialPassword }, { origin: 'http://localhost' }));
  expect(signIn.status).toBe(201);
  sessionCookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

const accepts = (op: Operation, scheme: 'apiKey' | 'session') => (op.security ?? []).some((req) => scheme in req);
const scopesOf = (op: Operation) => routeAccess.get(`${op.method} ${op.path.replace(/\{([^}]+)\}/g, ':$1')}`)?.scopes ?? [];
/** hosted-portal.md §5 layer 2: writes in a domain Malafat owns are read-only to a session; everything else key-only is not its business. */
const malafatWriteDomain = (op: Operation) =>
  scopesOf(op)
    .filter((s) => s.endsWith(':write'))
    .map(domainOfScope)
    .find((d) => d !== undefined && matrixRow(d).writerOfRecord === 'MALAFAT');
const concrete = (path: string) => path.replace(/\{[^}]+\}/g, PLACEHOLDER);
const request = (op: Operation, headers: Record<string, string>) =>
  app.request(concrete(op.path), {
    method: op.method,
    headers: { 'content-type': 'application/json', 'idempotency-key': 'route-security-key', 'if-match': '1', ...headers },
    ...(op.method === 'GET' || op.method === 'DELETE' ? {} : { body: '{}' }),
  });

describe('route security declarations', () => {
  it('inspects a non-trivial inventory', () => {
    expect(operations.length).toBeGreaterThan(55);
  });

  it('every /v1 operation declares its principals, except the public sign-in', () => {
    const undeclared = operations.filter((op) => !PUBLIC_OPERATIONS.includes(op.key) && (!op.security || op.security.length === 0)).map((op) => op.key);
    expect(undeclared).toEqual([]);
    for (const key of PUBLIC_OPERATIONS) expect(operations.find((op) => op.key === key)?.security).toEqual([]);
  });

  it('exactly the portal read surface and the identity routes accept sessions', () => {
    expect(operations.filter((op) => accepts(op, 'session')).map((op) => op.key).sort()).toEqual(SESSION_OPERATIONS);
  });
});

describe('authenticate() enforces each declaration', () => {
  it('reads every key-reachable operation’s scopes from its middleware', () => {
    const unscoped = operations.filter((o) => accepts(o, 'apiKey') && scopesOf(o).length === 0).map((o) => o.key);
    expect(unscoped).toEqual([]);
  });

  it('a session is refused on every key-only operation: READ_ONLY_PROFILE on Malafat’s writes, PRINCIPAL_NOT_ACCEPTED elsewhere', async () => {
    const wrong: string[] = [];
    const readOnly: string[] = [];
    for (const op of operations.filter((o) => accepts(o, 'apiKey') && !accepts(o, 'session'))) {
      const res = await request(op, { cookie: sessionCookie, 'x-mutaba3a-profile': orgId, origin: 'http://localhost' });
      const body = (await res.json()) as Loose;
      const domain = malafatWriteDomain(op);
      const want = domain ? 'READ_ONLY_PROFILE' : 'PRINCIPAL_NOT_ACCEPTED';
      if (res.status !== 403 || body.error?.code !== want) wrong.push(`${op.key} → ${res.status} ${body.error?.code}, want ${want}`);
      if (domain) {
        readOnly.push(op.key);
        // This organization has no Malafat integration: the refusal says so, and names nobody.
        expect(body.error.details, op.key).toEqual({ domain, writerOfRecord: null });
      }
    }
    expect(wrong).toEqual([]);
    expect(readOnly.length).toBeGreaterThan(20);
  });

  it('an API key is refused on every session-only operation', async () => {
    const sessionOnly = operations.filter((o) => accepts(o, 'session') && !accepts(o, 'apiKey'));
    expect(sessionOnly.map((o) => o.key).sort()).toEqual([...IDENTITY_OPERATIONS, ...EXPENSE_OPERATIONS].sort());
    for (const op of sessionOnly) {
      const res = await request(op, { authorization: `Bearer ${fullKey}` });
      expect(res.status, op.key).toBe(403);
      expect(((await res.json()) as Loose).error.code, op.key).toBe('PRINCIPAL_NOT_ACCEPTED');
    }
  });

  it('a session is let through on every operation that declares it (no handler re-refuses it)', async () => {
    const refused: string[] = [];
    // Sign-out would end the shared session mid-loop; routes-sessions.test.ts covers it.
    for (const op of operations.filter((o) => accepts(o, 'session') && o.key !== 'DELETE /v1/sessions/current')) {
      const res = await request(op, { cookie: sessionCookie, 'x-mutaba3a-profile': orgId, origin: 'http://localhost' });
      if (res.status === 401 || res.status === 403) refused.push(`${op.key} → ${res.status} ${((await res.json()) as Loose).error?.code}`);
    }
    expect(refused).toEqual([]);
  });

  it('every operation reachable by an API key enforces a scope', async () => {
    const unscoped: string[] = [];
    for (const op of operations.filter((o) => accepts(o, 'apiKey'))) {
      const codes = await Promise.all(scopedKeys.map(async (k) => ((await (await request(op, { authorization: `Bearer ${k}` })).json()) as Loose).error?.code));
      if (!codes.includes('INSUFFICIENT_SCOPE')) unscoped.push(`${op.key} → ${codes.join(', ')}`);
    }
    expect(unscoped).toEqual([]);
  });
});
