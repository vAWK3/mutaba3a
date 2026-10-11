import { beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SCOPES } from '../auth/scopes.js';
import { sessionClaimKey } from '../idempotency.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-42 AC: "expenses are invisible to Malafat's API key, asserted by a
 * cross-principal test" (brief §2). A session records canary expense data;
 * Malafat's full-scope key then reads everything it can reach, and nothing it
 * gets back may carry the canaries. Generated from the published document, so
 * a later route is swept the moment it exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const CANARY_VENDOR = 'ZZ-EXPENSE-CANARY';
const CANARY_AMOUNT = '987.65';
const CANARY_CATEGORY = 'ZZ-CATEGORY-CANARY';
const SHARED_KEY = 'shared-idempotency-0001';

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const store = new MemoryLedgerStore();
const storage = new MemoryAttachmentStorage();
const app = createApp({
  store,
  logger: pino({ level: 'silent' }),
  rateLimiter: new SlidingWindowRateLimiter(1_000_000),
  adminToken: ADMIN_TOKEN,
  keyEnvironment: 'test',
  version: '0.1.0-test',
  attachments: storage,
  sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
});

let orgId: string;
let userId: string;
let key: Record<string, string>;
let session: Record<string, string>;
const canaryIds: string[] = [];
const realIds: Record<string, string> = {};

beforeAll(async () => {
  const org = await read(await app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  orgId = org.id;
  const created = await read(await app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  key = { authorization: `Bearer ${created.secret}` };
  await store.integrations.connect({ organizationId: org.id, provider: 'MALAFAT', externalTenantId: 'tenant-canary', displayName: 'Firm', connectedByApiKeyId: created.apiKey.id, at: new Date() });
  const customer = await read(await app.request('/v1/customers', json({ name: 'Haddad' }, { ...key, 'idempotency-key': 'customer-0000001' })));
  const project = await read(await app.request('/v1/projects', json({ customerId: customer.id, name: 'Sale', currency: 'ILS' }, { ...key, 'idempotency-key': 'project-00000001' })));
  realIds.customerId = customer.id;
  realIds.projectId = project.id;

  const person = await read(await app.request('/admin/v1/users', json({ email: 'nour@firm.ps', displayName: 'Nour', organizationId: org.id }, admin)));
  userId = person.user.id;
  const signIn = await app.request('/v1/sessions', json({ email: 'nour@firm.ps', password: person.initialPassword }, SAME_ORIGIN));
  session = { cookie: `${COOKIE}=${new RegExp(`${COOKIE}=([^;]*)`).exec(signIn.headers.get('set-cookie') ?? '')?.[1]}`, 'x-mutaba3a-profile': org.id, ...SAME_ORIGIN };

  const category = await read(await app.request('/v1/expense-categories', json({ name: CANARY_CATEGORY }, { ...session, 'idempotency-key': 'category-0000001' })));
  const expense = await read(await app.request('/v1/expenses', json({ occurredOn: '2026-10-05', amount: CANARY_AMOUNT, currency: 'ILS', vendor: CANARY_VENDOR, categoryId: category.id, customerId: customer.id, projectId: project.id }, { ...session, 'idempotency-key': SHARED_KEY })));
  const started = await read(await app.request(`/v1/expenses/${expense.id}/receipts`, json({ filename: 'canary.pdf', mimeType: 'application/pdf', sizeBytes: 64 }, session)));
  storage.put(`org/${org.id}/expense-receipts/${started.receipt.id}`, { sizeBytes: 64, contentType: 'application/pdf' });
  expect((await app.request(`/v1/expenses/${expense.id}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: session })).status).toBe(200);
  canaryIds.push(expense.id, started.receipt.id, category.id);
});

function leaks(text: string): string[] {
  return [CANARY_VENDOR, CANARY_AMOUNT, CANARY_CATEGORY, 'canary.pdf', ...canaryIds].filter((needle) => text.includes(needle));
}

describe('Malafat’s key reads nothing of a hosted profile’s expenses', () => {
  it('no key-reachable read returns a canary, whichever id it is handed', async () => {
    const doc = (await read(await app.request('/openapi.json'))) as { paths: Record<string, Record<string, Loose>> };
    const reads = Object.entries(doc.paths)
      .filter(([path, item]) => path.startsWith('/v1/') && item.get && (item.get.security ?? []).some((s: Loose) => 'apiKey' in s))
      .map(([path]) => path);
    expect(reads.length).toBeGreaterThan(20);

    const found: string[] = [];
    let ok = 0;
    for (const path of reads) {
      const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
      // Real ids where we have them, and every canary id in every slot: a key must not reach an expense through any door.
      const candidates = params.length === 0 ? [{}] : [Object.fromEntries(params.map((p) => [p, realIds[p] ?? canaryIds[0]!])), ...canaryIds.map((id) => Object.fromEntries(params.map((p) => [p, id])))];
      for (const ids of candidates) {
        const res = await app.request(path.replace(/\{([^}]+)\}/g, (_m, p: string) => (ids as Record<string, string>)[p]!), { headers: key });
        expect(res.status, path).not.toBe(401);
        if (res.status === 200) ok++;
        const hit = leaks(await res.text());
        if (hit.length) found.push(`${path} ${JSON.stringify(ids)} → ${hit.join(', ')}`);
      }
    }
    expect(found).toEqual([]);
    expect(ok).toBeGreaterThan(10);
  });

  it('GET /v1/audit lists no expense activity, though it is recorded', async () => {
    const recorded = (await store.audit.list(orgId, {}, { limit: 500, cursor: null })).items.filter((e) => e.entityType.startsWith('expense'));
    expect(recorded.length).toBeGreaterThanOrEqual(3);
    const listed = await read(await app.request('/v1/audit?limit=200', { headers: key }));
    expect(listed.items.filter((e: Loose) => String(e.entityType).startsWith('expense'))).toEqual([]);
    expect(await read(await app.request('/v1/audit?entityType=expense', { headers: key }))).toMatchObject({ items: [] });
  });

  it('a session’s Idempotency-Key is its own: Malafat can neither look it up nor collide with it', async () => {
    const lookup = await app.request(`/v1/operations/${SHARED_KEY}`, { headers: key });
    expect(lookup.status).toBe(404);
    const reuse = await app.request('/v1/customers', json({ name: 'Same key, other principal' }, { ...key, 'idempotency-key': SHARED_KEY }));
    expect(reuse.status).toBe(201);
    expect(await store.idempotency.get(orgId, sessionClaimKey(userId, SHARED_KEY))).not.toBeNull();
    expect(sessionClaimKey(userId, 'k'.repeat(128)).length).toBeLessThanOrEqual(128);
  });
});
