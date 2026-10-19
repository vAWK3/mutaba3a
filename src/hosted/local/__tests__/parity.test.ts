import { describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/src/app.js';
import { SlidingWindowRateLimiter } from '../../../../server/src/rate-limit.js';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
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
  request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

type FetchLike = { fetch(request: Request): Response | Promise<Response> };

async function side(app: FetchLike, store: MemoryLedgerStore, time: ReturnType<typeof clock>): Promise<Side> {
  const { token, user } = await mintLocalSession(store, time.now, 'en');
  const [membership] = await store.memberships.listByUser(user.id);
  if (!membership) throw new Error('no personal profile');
  let key = 0;
  return {
    async request(method, path, body) {
      time.tick();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'X-Mutaba3a-Profile': membership.organizationId };
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
  });
  return side(app, store, time);
}

function localSide(): Promise<Side> {
  const store = new MemoryLedgerStore();
  const time = clock();
  return side(createLocalApp({ store, now: time.now }), store, time);
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

describe('local/remote parity (AC3)', () => {
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
});
