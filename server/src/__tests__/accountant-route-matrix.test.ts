import { beforeAll, describe, expect, it } from 'vitest';
import { SESSION_ORGANIZATION_INDEPENDENT_ROUTES } from '../app.js';
import { buildRouteAccessIndex, type RouteAccessIndex } from '../auth/middleware.js';
import { accountantMayRead } from '../auth/writability.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { accountantHarness, businessOf, expenseOn, idem, json, person, read, shared, type AccountantHarness, type Loose, type Person } from './helpers/accountants.js';

/**
 * MUT-559 (ADR-245): every profile-scoped route a session can call, enumerated from the published contract and the
 * route-access index (never a hand list of what is enforced), called as an accountant on a profile shared with them:
 *  - every write answers 403 READ_ONLY_PROFILE, ACCOUNTANT_READ_ONLY (layer 1, the method gate);
 *  - every GET outside the derived allowlist answers the same (layer 2, D1);
 *  - every allowlisted GET answers, and the list reads carry only the shared profile's rows.
 * The allowlist below is what the derivation yields today: a GET added later that it lets in fails here until it is
 * looked at and added, so nothing becomes readable to an accountant by accident.
 */
const ALLOWED_GETS = [
  'GET /v1/attachments',
  'GET /v1/attachments/{attachmentId}/download',
  'GET /v1/conversions',
  'GET /v1/conversions/{conversionId}',
  'GET /v1/customers',
  'GET /v1/customers/{customerId}',
  'GET /v1/customers/{customerId}/statement',
  'GET /v1/expense-categories',
  'GET /v1/expense-groups',
  'GET /v1/expense-groups/{groupId}',
  'GET /v1/expense-groups/{groupId}/summary',
  'GET /v1/expenses',
  'GET /v1/expenses/streak',
  'GET /v1/expenses/{expenseId}',
  'GET /v1/expenses/{expenseId}/receipts/{receiptId}/download',
  'GET /v1/payments',
  'GET /v1/payments/{paymentId}',
  'GET /v1/projects',
  'GET /v1/projects/{projectId}',
  'GET /v1/receipts',
  'GET /v1/receipts/counts',
  'GET /v1/receipts/{receiptId}',
  'GET /v1/receipts/{receiptId}/download',
  'GET /v1/receivables',
  'GET /v1/receivables/{receivableId}',
  'GET /v1/receivables/{receivableId}/credits',
  'GET /v1/summaries/activity',
  'GET /v1/summaries/customers/{customerId}',
  'GET /v1/summaries/expenses',
  'GET /v1/summaries/organization',
  'GET /v1/summaries/period',
  'GET /v1/summaries/projects/{projectId}',
  'GET /v1/vendors',
].sort();

/** The queries a route requires, so the call reaches it. */
const QUERIES: Record<string, string> = {
  'GET /v1/summaries/period': '?from=2026-11-01&to=2026-11-30&currency=ILS',
  'GET /v1/customers/{customerId}/statement': '?currency=ILS',
};
const PLACEHOLDER = '00000000-0000-4000-8000-0000000000aa';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface Operation {
  key: string;
  method: string;
  path: string;
  session: boolean;
}

let h: AccountantHarness;
let owner: Person;
let accountant: Person;
let profileId: string;
let operations: Operation[];
/** Profile-scoped routes only an API key may call (Malafat's): an accountant's session is refused before any profile. */
let keyOnly: Operation[];
let routeAccess: RouteAccessIndex;
/** One real record of the shared profile per path parameter, so every allowlisted detail GET runs its handler to the end. */
const ids: Record<string, string> = {};
let storage: MemoryAttachmentStorage;
const keyOf = (url: string) => new URL(url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');

const hono = (path: string) => path.replace(/\{([^}]+)\}/g, ':$1');
const scopesOf = (op: Operation) => routeAccess.get(`${op.method} ${hono(op.path)}`)?.scopes ?? [];
const concrete = (path: string) => path.replace(/\{[^}]+\}/g, PLACEHOLDER);
const call = (op: Operation, query = '') =>
  h.app.request(`${concrete(op.path)}${query}`, {
    method: op.method,
    headers: { ...accountant.on(profileId), 'content-type': 'application/json', 'if-match': '1', ...idem() },
    ...(op.method === 'GET' || op.method === 'DELETE' ? {} : { body: '{}' }),
  });

beforeAll(async () => {
  storage = new MemoryAttachmentStorage();
  h = accountantHarness({ receiptsLibrary: true, attachments: storage });
  owner = await person(h, { displayName: 'Basel Sader' });
  profileId = await businessOf(h, owner, 'Sader Studio');
  const other = await businessOf(h, owner, 'Other Studio');
  await expenseOn(h, owner, profileId, 'Shared paper');
  await expenseOn(h, owner, other, 'Private rent');
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad Trading' }, { ...owner.on(profileId), ...idem() })));
  await h.app.request('/v1/customers', json({ name: 'Hidden Client' }, { ...owner.on(other), ...idem() }));
  const as = () => ({ ...owner.on(profileId), ...idem() });
  const seed = async (path: string, body: object) => {
    const res = await h.app.request(path, json(body, as()));
    if (res.status !== 201 && res.status !== 200) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return read(res);
  };
  ids.customerId = customer.id;
  ids.projectId = (await seed('/v1/projects', { customerId: customer.id, name: 'Rebrand', currency: 'ILS' })).id;
  ids.paymentId = (await seed('/v1/income', { kind: 'received', amount: '50.00', currency: 'ILS', occurredOn: '2026-11-01', customerId: customer.id })).id;
  ids.receivableId = (await seed('/v1/income', { kind: 'owed', amount: '80.00', currency: 'ILS', occurredOn: '2026-11-01', customerId: customer.id })).id;
  ids.conversionId = (await seed('/v1/conversions', { occurredOn: '2026-11-01', amount: '100.00', currency: 'USD', toAmount: '365.00', toCurrency: 'ILS' })).id;
  ids.groupId = (await seed('/v1/expense-groups', { name: 'Jordan trip', startOn: '2026-11-01', endOn: '2026-11-03' })).id;
  ids.expenseId = await expenseOn(h, owner, profileId, 'Printer ink');
  const file = { filename: 'ink.pdf', mimeType: 'application/pdf', sizeBytes: 2048 };
  const expenseReceipt = await seed(`/v1/expenses/${ids.expenseId}/receipts`, file);
  storage.put(keyOf(expenseReceipt.upload.url), { sizeBytes: file.sizeBytes, contentType: file.mimeType });
  expect((await h.app.request(`/v1/expenses/${ids.expenseId}/receipts/${expenseReceipt.receipt.id}/complete`, { method: 'POST', headers: owner.on(profileId) })).status).toBe(200);
  ids.expenseReceiptId = expenseReceipt.receipt.id;
  const library = await seed('/v1/receipts/uploads', file);
  storage.put(keyOf(library.upload.url), { sizeBytes: file.sizeBytes, contentType: file.mimeType });
  expect((await h.app.request(`/v1/receipts/${library.receipt.id}/complete`, { method: 'POST', headers: owner.on(profileId) })).status).toBe(200);
  ids.receiptId = library.receipt.id;
  // Attachments are Malafat's to write (an owned profile has no key), so the store makes one.
  const attachment = await h.store.attachments.create({ organizationId: profileId, kind: 'INVOICE', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 2048, customerId: customer.id, projectId: null, paymentId: null, invoiceNumber: null, invoiceDate: null, uploadedByKeyId: null, requestId: null }, h.now());
  const attachmentKey = `attachments/${profileId}/${attachment.id}`;
  await h.store.attachments.setKey(profileId, attachment.id, attachmentKey);
  storage.put(attachmentKey, { sizeBytes: 2048, contentType: 'application/pdf' });
  await h.store.attachments.complete(profileId, attachment.id, h.now());
  ids.attachmentId = attachment.id;
  accountant = await shared(h, owner, profileId);
  await expenseOn(h, accountant, accountant.personalId, 'My own lunch');

  const doc = (await read(await h.app.request('/openapi.json'))) as { paths: Record<string, Record<string, Loose>> };
  routeAccess = buildRouteAccessIndex(h.app.openAPIRegistry.definitions, h.app.routes);
  const isSession = (security: Array<Record<string, unknown>>) => security.some((req) => 'session' in req || 'deviceSession' in req);
  const all = Object.entries(doc.paths)
    .filter(([path]) => path.startsWith('/v1/'))
    .flatMap(([path, item]) =>
      METHODS.filter((m) => item[m] && (item[m].security ?? []).length > 0).map((m) => ({ key: `${m.toUpperCase()} ${path}`, method: m.toUpperCase(), path, session: isSession(item[m].security) })),
    )
    // Profile-scoped: everything that acts on one profile (a session names it in X-Mutaba3a-Profile, a key implies it).
    .filter((op) => !SESSION_ORGANIZATION_INDEPENDENT_ROUTES.has(`${op.method} ${hono(op.path)}`) && !op.path.startsWith('/v1/operator/'));
  operations = all.filter((op) => op.session);
  keyOnly = all.filter((op) => !op.session);
});

describe('the accountant route matrix (MUT-559)', () => {
  it('walks a non-trivial inventory of profile-scoped routes', () => {
    expect(operations.length + keyOnly.length).toBeGreaterThan(110);
    expect(operations.length).toBeGreaterThan(70);
  });

  it('refuses every key-only profile route (Malafat’s writes and reads) with a 403 before any profile is selected', async () => {
    const wrong: string[] = [];
    for (const op of keyOnly) {
      const res = await call(op);
      if (res.status !== 403) wrong.push(`${op.key} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('derives exactly the reviewed GET allowlist from the routes’ scope tags (D1)', () => {
    const allowed = operations.filter((op) => op.method === 'GET' && accountantMayRead(scopesOf(op))).map((op) => op.key).sort();
    expect(allowed).toEqual(ALLOWED_GETS);
    // The records export has no scope tag, so it is refused (download is MUT-314).
    expect(allowed).not.toContain('GET /v1/records-export');
  });

  it('refuses every write with 403 READ_ONLY_PROFILE, ACCOUNTANT_READ_ONLY, before the route runs', async () => {
    const writes = operations.filter((op) => op.method !== 'GET');
    expect(writes.length).toBeGreaterThan(30);
    const wrong: string[] = [];
    for (const op of writes) {
      const res = await call(op);
      const body = await read(res);
      if (res.status !== 403 || body.error?.details?.reason !== 'ACCOUNTANT_READ_ONLY') wrong.push(`${op.key} → ${res.status} ${JSON.stringify(body.error ?? body)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('refuses every GET outside the allowlist the same way', async () => {
    const refused = operations.filter((op) => op.method === 'GET' && !ALLOWED_GETS.includes(op.key));
    expect(refused.length).toBeGreaterThan(5);
    const wrong: string[] = [];
    for (const op of refused) {
      const res = await call(op);
      const body = await read(res);
      if (res.status !== 403 || body.error?.details?.reason !== 'ACCOUNTANT_READ_ONLY') wrong.push(`${op.key} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('answers every allowlisted GET on a real record of the shared profile, its handler run to the end under the store guard', async () => {
    const wrong: string[] = [];
    for (const key of ALLOWED_GETS) {
      const op = operations.find((o) => o.key === key)!;
      // The expense's receipt and the library's receipt are both {receiptId}.
      const path = op.path.replace(/\{([^}]+)\}/g, (_m, name: string) => (name === 'receiptId' && op.path.startsWith('/v1/expenses/') ? ids.expenseReceiptId : ids[name]) ?? `missing-${name}`);
      const res = await h.app.request(`${path}${QUERIES[key] ?? ''}`, { headers: accountant.on(profileId) });
      // The streak is a person's own personal profile's (409 NOT_PERSONAL on a shared business profile).
      const expected = key === 'GET /v1/expenses/streak' ? 409 : 200;
      if (res.status !== expected) wrong.push(`${key} → ${res.status} ${await res.text()}`);
    }
    expect(wrong).toEqual([]);
  });

  it('refuses the retainer charges: they need agreements:read, which an accountant never holds', async () => {
    const op = operations.find((o) => o.key === 'GET /v1/retainers/{agreementId}/charges')!;
    expect(scopesOf(op)).toEqual(expect.arrayContaining(['payments:read', 'agreements:read']));
    const res = await call(op);
    expect(res.status).toBe(403);
    expect((await read(res)).error.details).toEqual({ reason: 'ACCOUNTANT_READ_ONLY' });
  });

  it('the list reads carry only the shared profile’s rows', async () => {
    const get = async (path: string) => read(await h.app.request(path, { headers: accountant.on(profileId) }));
    expect((await get('/v1/expenses')).items.map((e: Loose) => e.title).sort()).toEqual(['Printer ink', 'Shared paper']);
    expect((await get('/v1/customers')).items.map((c: Loose) => c.name)).toEqual(['Haddad Trading']);
    const payments = await get('/v1/payments');
    expect(payments.items).toHaveLength(1);
    expect(payments.items[0].id).toBe(ids.paymentId);
    expect(payments.items[0].amount).toBe('50.00');
    const summary = JSON.stringify(await get('/v1/summaries/organization'));
    expect(summary).not.toContain('Hidden Client');
  });
});
