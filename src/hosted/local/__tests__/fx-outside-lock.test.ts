import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalBackend } from '../../session/localBackendContract.js';

/**
 * MUT-287 review D2: reference rates read no records, so their network fetch
 * never runs under the cross-tab lock. A stuck FX request must not hold up a
 * save, in this tab or any other.
 */
class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

async function openPage(): Promise<LocalBackend> {
  vi.resetModules();
  return (await import('../index.js')).bootLocalBackend();
}

describe('reference rates and the lock (D2)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
    localStorage.clear();
    // The public snapshot never answers: a stuck network.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a save does not wait for a stuck FX fetch', async () => {
    const page = await openPage();
    const me = (await (await page.fetch(new Request('http://localhost/v1/me'))).json()) as { profiles: Array<{ id: string }> };
    const profileId = me.profiles[0]!.id;

    void page.fetch(new Request('http://localhost/v1/fx-rates?base=ILS', { headers: { 'X-Mutaba3a-Profile': profileId } }));
    const save = page.fetch(
      new Request('http://localhost/v1/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mutaba3a-Profile': profileId, 'Idempotency-Key': 'fx-lock-test-1' },
        body: JSON.stringify({ occurredOn: '2026-10-01', amount: '12.00', currency: 'ILS', title: 'Coffee' }),
      }),
    );
    const outcome = await Promise.race([save.then((r) => r.status), new Promise((resolve) => setTimeout(() => resolve('blocked'), 2_000))]);

    expect(outcome).toBe(201);
  });

  it('MUT-447: a save does not wait for a Reports verdict whose FX fetch is stuck', async () => {
    const page = await openPage();
    const me = (await (await page.fetch(new Request('http://localhost/v1/me'))).json()) as { profiles: Array<{ id: string }> };
    const profileId = me.profiles[0]!.id;

    // The verdict waits on the stuck FX fetch before the lock and never settles here; its outcome is not this test's subject.
    page.fetch(new Request('http://localhost/v1/summaries/verdict')).catch(() => undefined);
    const save = page.fetch(
      new Request('http://localhost/v1/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mutaba3a-Profile': profileId, 'Idempotency-Key': 'fx-lock-test-verdict' },
        body: JSON.stringify({ occurredOn: '2026-10-01', amount: '12.00', currency: 'ILS', title: 'Coffee' }),
      }),
    );
    const outcome = await Promise.race([save.then((r) => r.status), new Promise((resolve) => setTimeout(() => resolve('blocked'), 2_000))]);

    expect(outcome).toBe(201);
  });
});
