import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { setMode } from '../../session/mode';

/**
 * AC4 (MUT-286): signed out, the portal makes no `/v1` request. Driven through
 * the portal's own typed client (`api`), exactly as the views call it, with
 * the real lazy local backend behind it (the `@mut/local-backend` alias) and
 * `fetch` replaced by a spy that fails the test if anything reaches it.
 */

class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

describe('signed out: no network (AC4)', () => {
  const fetchSpy = vi.fn((input: RequestInfo | URL) => Promise.reject(new TypeError(`network used: ${String(input)}`)));

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
    vi.stubGlobal('fetch', fetchSpy);
    setMode('local');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs a whole session — who am I, record income, read every figure — without one request', async () => {
    const me = await api.me();
    const profileId = me.profiles[0]!.id;

    await api.createIncome(profileId, { kind: 'received', amount: '300.00', currency: 'ILS', occurredOn: '2026-10-01' }, 'no-network-1');
    const payments = await api.payments(profileId);
    const summary = await api.organizationSummary(profileId);
    const customers = await api.customers(profileId);
    const receivables = await api.receivables(profileId);

    expect(payments.items.map((p) => p.amount)).toEqual(['300.00']);
    expect(summary).toBeDefined();
    expect(customers.items).toEqual([]);
    expect(receivables.items).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
