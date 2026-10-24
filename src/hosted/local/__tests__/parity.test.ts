import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/src/app.js';
import { MemoryAttachmentStorage } from '../../../../server/src/attachments/storage.js';
import { SlidingWindowRateLimiter } from '../../../../server/src/rate-limit.js';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { LocalAttachmentStorage } from '../attachments.js';
import { IndexedDbBlobStore } from '../blobStore.js';
import { createLocalApp } from '../createLocalApp.js';
import { LOCAL_PEPPER, mintLocalSession } from '../mintLocalSession.js';

/**
 * AC3 (MUT-286, brief §13): one set of records through the server and through
 * the local backend gives identical answers. The remote side is the real
 * `createApp` (every middleware the Node server runs); the local side is
 * `createLocalApp`. Each gets its own store and its own person, minted the same
 * way, then the same requests in the same order. Ids are random per store, so
 * every UUID is replaced by its order of first appearance before comparing;
 * each side's clock ticks the same way, so timestamps match as they are.
 */

const START_MS = Date.parse('2026-10-12T09:00:00.000Z');
const TICK_MS = 1000;

/** One clock per side, a second per request: equal timestamps would leave list order to random ids. Both sides tick alike. */
function clock() {
  let at = START_MS;
  return { now: () => new Date(at), tick: () => { at += TICK_MS; } };
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

interface Side {
  request(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; body: unknown }>;
}

type FetchLike = { fetch(request: Request): Response | Promise<Response> };

async function side(app: FetchLike, store: MemoryLedgerStore, time: ReturnType<typeof clock>): Promise<Side> {
  const { token, user } = await mintLocalSession(store, time.now, 'en');
  const [membership] = await store.memberships.listByUser(user.id);
  if (!membership) throw new Error('no personal profile');
  let key = 0;
  return {
    async request(method, path, body, extraHeaders = {}) {
      time.tick();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'X-Mutaba3a-Profile': membership.organizationId, ...extraHeaders };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (method === 'POST') headers['Idempotency-Key'] = `parity-key-${++key}`;
      const response = await app.fetch(
        new Request(`http://local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      );
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    },
  };
}

type Logger = Parameters<typeof createApp>[0]['logger'];

/** `pino` lives in server/node_modules only; createApp needs a logger and this test reads none of it. */
function silentLogger(): Logger {
  const noop = () => undefined;
  const logger: Record<string, unknown> = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop };
  logger.child = () => logger;
  return logger as unknown as Logger;
}

function remoteSide(): Promise<Side> {
  const store = new MemoryLedgerStore();
  const time = clock();
  const app = createApp({
    store,
    logger: silentLogger(),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: 'parity-admin-token-with-at-least-32-characters',
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: time.now,
    sessions: { pepper: LOCAL_PEPPER, idleMinutes: 60, absoluteHours: 24, secureCookie: true, trustedProxyHops: 1 },
    attachments: new MemoryAttachmentStorage(),
  });
  return side(app, store, time);
}

function localSide(): Promise<Side> {
  const store = new MemoryLedgerStore();
  const time = clock();
  return side(createLocalApp({ store, now: time.now, attachments: new LocalAttachmentStorage(new IndexedDbBlobStore()) }), store, time);
}

/** Every UUID becomes `id-N`, numbered by first appearance, so two stores' answers compare structurally. */
function normalize(transcript: unknown): unknown {
  const ids = new Map<string, string>();
  const text = JSON.stringify(transcript).replace(UUID, (id) => {
    if (!ids.has(id)) ids.set(id, `id-${ids.size + 1}`);
    return ids.get(id) as string;
  });
  return JSON.parse(text);
}

/** The records: a client, money owed, part of it paid, money received on its own, then every figure the portal reads. */
async function script(s: Side): Promise<unknown[]> {
  const out: unknown[] = [];
  const record = async (method: string, path: string, body?: unknown) => {
    const result = await s.request(method, path, body);
    out.push({ method, path: path.replace(UUID, ':id'), ...result });
    return result.body as Record<string, unknown>;
  };

  const customer = await record('POST', '/v1/customers', { name: 'Parity Client' });
  const owed = await record('POST', '/v1/income', {
    kind: 'owed', amount: '1000.00', currency: 'ILS', occurredOn: '2026-09-01', customerId: customer.id, title: 'Logo', dueDate: '2026-09-15',
  });
  await record('POST', `/v1/receivables/${String(owed.id)}/settle`, { amount: '400.00', paidAt: '2026-10-01', method: 'BANK' });
  await record('POST', '/v1/income', { kind: 'received', amount: '250.50', currency: 'USD', occurredOn: '2026-10-10' });
  await record('POST', '/v1/income', { kind: 'owed', amount: '1.234', currency: 'ILS', occurredOn: '2026-10-10', customerId: customer.id });

  await record('GET', '/v1/summaries/organization');
  await record('GET', `/v1/summaries/customers/${String(customer.id)}`);
  await record('GET', '/v1/receivables');
  await record('GET', '/v1/payments');
  await record('GET', '/v1/customers');
  return out;
}

/**
 * MUT-287 (plan §2 parity row, review D9): expenses, categories, a receipt's
 * record, a trip group with a mark, and a conversion with an edit. A receipt
 * start is compared without its upload URL and headers, which are a bucket's
 * signed URL on one side and `local-blob:` on the other by design.
 */
async function expenseScript(s: Side): Promise<unknown[]> {
  const out: unknown[] = [];
  const record = async (method: string, path: string, body?: unknown, headers?: Record<string, string>, project = (b: unknown) => b) => {
    const result = await s.request(method, path, body, headers);
    out.push({ method, path: path.replace(UUID, ':id'), status: result.status, body: project(result.body) });
    return result.body as Record<string, unknown>;
  };

  const categories = (await record('GET', '/v1/expense-categories')) as { items: Array<{ id: string }> };
  const taxi = await record('POST', '/v1/expenses', { occurredOn: '2026-10-02', amount: '40.00', currency: 'USD', title: 'Taxi', categoryId: categories.items[0]!.id });
  await record('POST', '/v1/expenses', { occurredOn: '2026-10-03', amount: '120.00', currency: 'ILS', title: 'Hotel', vendor: 'Seaside' });
  await record('POST', `/v1/expenses/${String(taxi.id)}/receipts`, { filename: 'taxi.pdf', mimeType: 'application/pdf', sizeBytes: 16 }, undefined, (b) => ({ receipt: (b as { receipt: unknown }).receipt }));
  await record('GET', '/v1/expenses');
  await record('GET', '/v1/summaries/expenses');

  const group = await record('POST', '/v1/expense-groups', { name: 'Amman trip', startOn: '2026-10-01', endOn: '2026-10-05' });
  await record('GET', `/v1/expense-groups/${String(group.id)}/summary`);
  await record('PUT', `/v1/expense-groups/${String(group.id)}/expenses/${String(taxi.id)}`, { mode: 'excluded' });
  await record('GET', `/v1/expense-groups/${String(group.id)}/summary`);
  await record('GET', '/v1/expense-groups');

  const conversion = await record('POST', '/v1/conversions', { occurredOn: '2026-10-04', amount: '100.00', currency: 'USD', toAmount: '365.00', toCurrency: 'ILS' });
  await record('PATCH', `/v1/conversions/${String(conversion.id)}`, { toAmount: '366.00' }, { 'If-Match': String(conversion.version) });
  await record('GET', '/v1/conversions');
  await record('DELETE', `/v1/expenses/${String(taxi.id)}`);
  await record('GET', '/v1/expenses');
  return out;
}

/** MUT-175 (plan T3): Reports' activity summary — payments, a settled Owed entry and expenses, by day and by month. */
async function reportsScript(s: Side): Promise<unknown[]> {
  const out: unknown[] = [];
  const record = async (method: string, path: string, body?: unknown) => {
    const result = await s.request(method, path, body);
    out.push({ method, path: path.replace(UUID, ':id'), ...result });
    return result.body as Record<string, unknown>;
  };

  const customer = await record('POST', '/v1/customers', { name: 'Parity Client' });
  for (const [occurredOn, paidAt] of [['2026-08-03', '2026-08-20'], ['2026-09-01', '2026-09-04'], ['2026-09-10', '2026-10-01']]) {
    const owed = await record('POST', '/v1/income', { kind: 'owed', amount: '300.00', currency: 'ILS', occurredOn, customerId: customer.id, title: 'Work' });
    await record('POST', `/v1/receivables/${String(owed.id)}/settle`, { paidAt });
  }
  await record('POST', '/v1/income', { kind: 'received', amount: '250.50', currency: 'USD', occurredOn: '2026-10-10' });
  await record('POST', '/v1/expenses', { occurredOn: '2026-10-02', amount: '1.234', currency: 'JOD', title: 'Taxi' });
  await record('POST', '/v1/expenses', { occurredOn: '2026-09-03', amount: '120.00', currency: 'ILS', title: 'Hotel' });

  await record('GET', '/v1/summaries/activity?from=2026-10-01&to=2026-10-31');
  await record('GET', '/v1/summaries/activity?from=2026-01-01&to=2026-12-31&bucket=month');
  await record('GET', '/v1/summaries/activity?from=2026-10-31&to=2026-10-01');
  return out;
}

describe('local/remote parity (AC3)', () => {
  it('Reports’ activity summary answers the same signed in and signed out (MUT-175)', async () => {
    globalThis.indexedDB = new IDBFactory();
    const [remote, local] = await Promise.all([remoteSide(), localSide()]);

    const remoteTranscript = normalize(await reportsScript(remote));
    const localTranscript = normalize(await reportsScript(local));

    expect(localTranscript).toEqual(remoteTranscript);
    const steps = localTranscript as Array<{ status: number; body: { daysToPaid?: unknown } }>;
    expect(steps.map((step) => step.status).slice(-3)).toEqual([200, 200, 422]);
    expect(steps.at(-3)!.body.daysToPaid).toMatchObject({ overall: { median: 17, n: 3 } });
  });

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('the same records give the same statuses, totals and refusals signed in and signed out', async () => {
    const [remote, local] = await Promise.all([remoteSide(), localSide()]);

    const remoteTranscript = normalize(await script(remote));
    const localTranscript = normalize(await script(local));

    expect(localTranscript).toEqual(remoteTranscript);
  });

  it('the script exercises what it claims: a part-paid overdue receivable and a refused over-precise amount', async () => {
    const transcript = (await script(await localSide())) as Array<{ status: number; path: string; method: string; body: Record<string, unknown> }>;

    expect(transcript.map((step) => step.status)).toEqual([201, 201, 201, 201, 422, 200, 200, 200, 200, 200]);
    const receivables = transcript[7]?.body as { items: Array<{ status: string }> };
    expect(receivables.items.map((r) => r.status)).toEqual(['OVERDUE']);
  });

  it('expenses, receipts, groups and conversions answer the same signed in and signed out (MUT-287)', async () => {
    const [remote, local] = await Promise.all([remoteSide(), localSide()]);

    const remoteTranscript = normalize(await expenseScript(remote));
    const localTranscript = normalize(await expenseScript(local));

    expect(localTranscript).toEqual(remoteTranscript);
    const statuses = (localTranscript as Array<{ status: number }>).map((step) => step.status);
    expect(statuses).toEqual([200, 201, 201, 201, 200, 200, 201, 200, 200, 200, 200, 201, 200, 200, 204, 200]);
  });
});

