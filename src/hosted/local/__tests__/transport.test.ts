import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { createLocalApp } from '../createLocalApp.js';
import { LocalLock } from '../locks.js';
import { mintLocalSession } from '../mintLocalSession.js';
import { IndexedDbPersistence } from '../persistence.js';
import { createLocalTransport, LocalFormatTooNewError, type LocalTransport } from '../transport.js';

/**
 * `transport.ts`'s write rule (MUT-286 plan Phase B item 9): only a mutating
 * method with a 2xx answer persists and bumps `stateVersion`; a read or a
 * refused write leaves the database exactly as it was. Driven through the real
 * `createLocalApp` + `mintLocalSession`, so the requests are the same shapes
 * the portal's `client.ts` sends. `navigator.locks` is faked the same way
 * `locks.test.ts` does (jsdom has none); `fake-indexeddb` is global
 * (`src/test/setup.ts`).
 */

class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

const NOW = () => new Date('2026-01-01T00:00:00.000Z');

let dbCounter = 0;

interface Harness {
  transport: LocalTransport;
  persistence: IndexedDbPersistence;
  store: MemoryLedgerStore;
  headers: Record<string, string>;
}

async function harness(): Promise<Harness> {
  dbCounter += 1;
  const store = new MemoryLedgerStore();
  const persistence = new IndexedDbPersistence(`mut-local-transport-test-${dbCounter}`);
  const lock = new LocalLock(persistence);
  const { token, user } = await mintLocalSession(store, NOW);
  const [membership] = await store.memberships.listByUser(user.id);
  if (!membership) throw new Error('the local person has no personal profile');
  const app = createLocalApp({ store, now: NOW });
  const transport = createLocalTransport({ app, store, persistence, lock, now: NOW });
  return { transport, persistence, store, headers: { Authorization: `Bearer ${token}`, 'X-Mutaba3a-Profile': membership.organizationId } };
}

function createCustomer(h: Harness, name: string, key: string): Promise<Response> {
  return h.transport(
    new Request('http://local/v1/customers', {
      method: 'POST',
      headers: { ...h.headers, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ name }),
    }),
  );
}

describe('createLocalTransport', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
  });

  it('persists a successful write and bumps stateVersion', async () => {
    const h = await harness();

    const response = await createCustomer(h, 'Persisted Client', 'transport-key-1');

    expect(response.status).toBe(201);
    const loaded = await h.persistence.load();
    if (loaded.kind !== 'ok') throw new Error(`expected a saved snapshot, got ${loaded.kind}`);
    expect([...loaded.snapshot.maps.custs.values()].map((c) => c.name)).toEqual(['Persisted Client']);
    expect(loaded.snapshot.stateVersion).toBe(1);
  });

  it('a read writes nothing', async () => {
    const h = await harness();

    const response = await h.transport(new Request('http://local/v1/customers', { headers: h.headers }));

    expect(response.status).toBe(200);
    expect(await h.persistence.peekVersion()).toBeNull();
  });

  it('a refused write writes nothing', async () => {
    const h = await harness();

    const response = await createCustomer(h, '', 'transport-key-empty');

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await h.persistence.peekVersion()).toBeNull();
  });

  it('a restored store answers with what was saved (a reload)', async () => {
    const h = await harness();
    await createCustomer(h, 'Survives Reload', 'transport-key-2');

    const loaded = await h.persistence.load();
    if (loaded.kind !== 'ok') throw new Error(`expected a saved snapshot, got ${loaded.kind}`);
    const reloaded = new MemoryLedgerStore();
    reloaded.restore(loaded.snapshot);
    const { token } = await mintLocalSession(reloaded, NOW);
    const app = createLocalApp({ store: reloaded, now: NOW });
    const response = await app.fetch(new Request('http://local/v1/customers', { headers: { ...h.headers, Authorization: `Bearer ${token}` } }));

    const body = (await response.json()) as { items: Array<{ name: string }> };
    expect(body.items.map((c) => c.name)).toEqual(['Survives Reload']);
  });

  it('refuses to run when another tab saved a newer format, and writes nothing over it', async () => {
    const h = await harness();
    const { maps } = h.store.snapshot();
    await h.persistence.save({ formatVersion: 999, stateVersion: 1, savedAt: NOW(), maps });

    await expect(createCustomer(h, 'Too New', 'transport-key-3')).rejects.toBeInstanceOf(LocalFormatTooNewError);
    expect(await h.persistence.peekVersion()).toEqual({ formatVersion: 999, stateVersion: 1 });
  });
});
