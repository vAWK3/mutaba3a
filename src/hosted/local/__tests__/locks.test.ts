import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { LOCAL_FORMAT_VERSION } from '../migrations/index.js';
import { LocalLock } from '../locks.js';
import { IndexedDbPersistence } from '../persistence.js';

/**
 * The two-tab lock race (MUT-286 plan §13.4 — a BLOCKING finding in the
 * implementation plan's adversarial review: an earlier draft had only the
 * slow, end-to-end `local.two-tabs` release-QA spec, with no fast,
 * deterministic unit test of the mechanism itself).
 *
 * `navigator.locks` doesn't exist in jsdom, so this test brings a minimal
 * fake: a strict FIFO queue over one lock name, which is exactly what
 * `LocalLock` ever asks of it (`navigator.locks.request('mut-local', {mode:
 * 'exclusive'}, fn)`). `indexedDB` itself needs no faking here — `fake-
 * indexeddb/auto` is already installed globally for the whole suite
 * (`src/test/setup.ts`), and because it is one shared global, two
 * `IndexedDbPersistence` instances opening the same `'mut-local'` database
 * name are exactly two tabs sharing one database, not two separate ones.
 */

class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    // A failed callback must not wedge the queue for whoever is behind it, but must still reject for its own caller.
    this.tail = run.catch(() => undefined);
    return run;
  }
}

function installFakeLockManager(): void {
  Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
}

interface SimulatedTab {
  store: MemoryLedgerStore;
  persistence: IndexedDbPersistence;
  lock: LocalLock;
}

/** `dbName` is shared by every tab within one test (simulating one origin's database) and unique across tests (so cases never see each other's data — see `IndexedDbPersistence`'s own doc comment on why this beats `deleteDatabase` between tests). */
function makeTab(dbName: string): SimulatedTab {
  const persistence = new IndexedDbPersistence(dbName);
  return { store: new MemoryLedgerStore(), persistence, lock: new LocalLock(persistence) };
}

/** One "request": create an organization (standing in for any mutating request) through the exact sequence `transport.ts` runs — reload-if-stale, mutate, persist, bump. Returns whether this call saw `stale`. */
async function writeOrganization(tab: SimulatedTab, slug: string): Promise<boolean> {
  let sawStale = false;
  await tab.lock.withLock(async ({ stale, onDiskVersion }) => {
    sawStale = stale;
    if (stale) {
      const loaded = await tab.persistence.load();
      if (loaded.kind === 'ok') tab.store.restore(loaded.snapshot);
    }
    await tab.store.organizations.create({ name: slug, slug, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { maps } = tab.store.snapshot();
    await tab.persistence.save({ formatVersion: LOCAL_FORMAT_VERSION, stateVersion: onDiskVersion + 1, savedAt: new Date(), maps });
    return { result: undefined, wrote: true };
  });
  return sawStale;
}

let dbCounter = 0;
/** A fresh database name per test, so cases never share state. */
function freshDbName(): string {
  dbCounter += 1;
  return `mut-local-test-${dbCounter}`;
}

describe('two tabs racing a write (LocalLock + IndexedDbPersistence)', () => {
  beforeEach(() => {
    installFakeLockManager();
  });

  it('serializes two tabs writing concurrently: the second sees stale and reloads before writing, and neither write is lost', async () => {
    const dbName = freshDbName();
    const tabA = makeTab(dbName);
    const tabB = makeTab(dbName);

    // Launched "simultaneously" (no await between them) — the race the plan's review flagged. `FakeLockManager`
    // queues strictly in call order, so tabA's write runs first and tabB's second; tabB must still notice tabA's
    // write landed in between, because its own in-memory store was never told about it.
    const [sawStaleA, sawStaleB] = await Promise.all([writeOrganization(tabA, 'tab-a-org'), writeOrganization(tabB, 'tab-b-org')]);

    expect(sawStaleA).toBe(false); // the first writer has nothing to be stale against
    expect(sawStaleB).toBe(true); // the second writer's in-memory store was one version behind what tabA just saved

    const loaded = await tabB.persistence.load();
    if (loaded.kind !== 'ok') throw new Error(`expected a saved snapshot, got ${loaded.kind}`);
    const slugs = [...loaded.snapshot.maps.orgs.values()].map((o) => o.slug).sort();
    expect(slugs).toEqual(['tab-a-org', 'tab-b-org']); // neither write clobbered the other
    expect(loaded.snapshot.stateVersion).toBe(2); // two writes landed, not one overwriting the other
  });

  it('a tab that never raced (no other write happened) never sees stale', async () => {
    const tab = makeTab(freshDbName());
    const sawStale = await writeOrganization(tab, 'solo-org');
    expect(sawStale).toBe(false);
  });

  it('three tabs racing in sequence all land, each on top of the last', async () => {
    const dbName = freshDbName();
    const tabs = [makeTab(dbName), makeTab(dbName), makeTab(dbName)];
    await Promise.all(tabs.map((tab, i) => writeOrganization(tab, `org-${i}`)));

    const loaded = await tabs[0]!.persistence.load();
    if (loaded.kind !== 'ok') throw new Error(`expected a saved snapshot, got ${loaded.kind}`);
    expect(loaded.snapshot.maps.orgs.size).toBe(3);
    expect(loaded.snapshot.stateVersion).toBe(3);
  });
});
