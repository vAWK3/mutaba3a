import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalBackend } from '../../session/localBackendContract.js';

/**
 * `bootLocalBackend` (MUT-286 Phase C), the lazy chunk's entry, driven the way
 * the portal drives it: `Request`s with a profile header and no token (the
 * backend attaches its own). A "page load" is a fresh module instance
 * (`vi.resetModules()` + import) over the same fake IndexedDB, so reloads and
 * second tabs are real: each has its own in-memory store and session.
 */

class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** A new page: its own module instance (so its own memoized backend), sharing the origin's IndexedDB and lock manager. */
async function openPage(): Promise<LocalBackend> {
  vi.resetModules();
  const module = await import('../index.js');
  return module.bootLocalBackend();
}

interface Me {
  user: { id: string };
  profiles: Array<{ id: string }>;
}

async function me(page: LocalBackend): Promise<{ status: number; body: Me }> {
  const response = await page.fetch(new Request('http://localhost/v1/me'));
  return { status: response.status, body: (await response.json()) as Me };
}

let key = 0;
async function receive(page: LocalBackend, profileId: string, amount: string): Promise<number> {
  const response = await page.fetch(
    new Request('http://localhost/v1/income', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mutaba3a-Profile': profileId, 'Idempotency-Key': `boot-test-${++key}` },
      body: JSON.stringify({ kind: 'received', amount, currency: 'ILS', occurredOn: '2026-10-01' }),
    }),
  );
  return response.status;
}

async function paymentAmounts(page: LocalBackend, profileId: string): Promise<string[]> {
  const response = await page.fetch(new Request('http://localhost/v1/payments', { headers: { 'X-Mutaba3a-Profile': profileId } }));
  const body = (await response.json()) as { items: Array<{ amount: string }> };
  return body.items.map((p) => p.amount).sort();
}

// Each "page load" re-imports the whole server route graph (vi.resetModules), the first one cold: seconds under
// the full suite's parallel load, past Vitest's 5 s default (seen in the MUT-286 gate run).
const PAGE_LOAD_TIMEOUT_MS = 30_000;

describe('bootLocalBackend', { timeout: PAGE_LOAD_TIMEOUT_MS }, () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
  });

  it('opens on an empty personal profile with no token from the caller (AC1)', async () => {
    const page = await openPage();

    const { status, body } = await me(page);

    expect(status).toBe(200);
    expect(body.profiles).toHaveLength(1);
  });

  it('keeps the same person and profile across a reload, even with nothing entered (first boot saves)', async () => {
    const first = (await me(await openPage())).body;
    const second = (await me(await openPage())).body;

    expect(second.user.id).toBe(first.user.id);
    expect(second.profiles[0]?.id).toBe(first.profiles[0]?.id);
  });

  it('keeps records across a reload (AC2)', async () => {
    const page = await openPage();
    const profileId = (await me(page)).body.profiles[0]!.id;
    expect(await receive(page, profileId, '120.00')).toBe(201);

    const reloaded = await openPage();

    expect(await paymentAmounts(reloaded, profileId)).toEqual(['120.00']);
  });

  it('manages local profiles like MUT-183: create up to the cap of 6, then rename, re-currency and re-type, kept across a reload', async () => {
    const page = await openPage();
    const json = { 'Content-Type': 'application/json' };
    const create = (n: number) =>
      page.fetch(
        new Request('http://localhost/v1/profiles', {
          method: 'POST',
          headers: { ...json, 'Idempotency-Key': `boot-profile-${n}` },
          body: JSON.stringify({ name: `Studio ${n}`, type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }),
        }),
      );

    const created: Array<{ id: string; version: number }> = [];
    for (let n = 1; n <= 5; n++) {
      const response = await create(n);
      expect(response.status).toBe(201);
      created.push((await response.json()) as { id: string; version: number });
    }
    const refused = await create(6);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('PROFILE_LIMIT');

    const first = created[0]!;
    const patched = await page.fetch(
      new Request(`http://localhost/v1/profiles/${first.id}`, {
        method: 'PATCH',
        headers: { ...json, 'If-Match': String(first.version) },
        body: JSON.stringify({ name: 'Renamed Studio', defaultCurrency: 'USD', type: 'PERSONAL' }),
      }),
    );
    expect(patched.status).toBe(200);

    const after = (await me(await openPage())).body as unknown as { profiles: Array<{ id: string; name: string; defaultCurrency: string; type: string }>; limits: { ownedProfiles: number; maxOwnedProfiles: number } };
    expect(after.profiles).toHaveLength(6);
    expect(after.limits).toEqual({ ownedProfiles: 6, maxOwnedProfiles: 6 });
    expect(after.profiles.find((p) => p.id === first.id)).toMatchObject({ name: 'Renamed Studio', defaultCurrency: 'USD', type: 'PERSONAL' });
  });

  it('two tabs opened together on an empty device end up as one person', async () => {
    vi.resetModules();
    const a = await import('../index.js');
    vi.resetModules();
    const b = await import('../index.js');

    const [pageA, pageB] = await Promise.all([a.bootLocalBackend(), b.bootLocalBackend()]);

    expect((await me(pageA)).body.user.id).toBe((await me(pageB)).body.user.id);
  });

  it('a write in one tab is in the other tab\'s next answer', async () => {
    const pageA = await openPage();
    const pageB = await openPage();
    const profileId = (await me(pageA)).body.profiles[0]!.id;

    await receive(pageA, profileId, '10.00');
    await receive(pageB, profileId, '20.00');

    expect(await paymentAmounts(pageA, profileId)).toEqual(['10.00', '20.00']);
  });

  it('restores a downloaded file, replacing what is there, and keeps answering', async () => {
    const page = await openPage();
    const profileId = (await me(page)).body.profiles[0]!.id;
    await receive(page, profileId, '50.00');
    const file = page.exportRecords();
    await receive(page, profileId, '75.00');

    const pending = await page.readRecordsFile(file);
    expect(pending.recordCount).toBe(1);
    await pending.apply();

    expect(await paymentAmounts(page, profileId)).toEqual(['50.00']);
    expect(await paymentAmounts(await openPage(), profileId)).toEqual(['50.00']);
  });

  it('a tab whose person was replaced by another tab\'s restore signs itself in again', async () => {
    const elsewhere = new IDBFactory();
    const home = globalThis.indexedDB;
    globalThis.indexedDB = elsewhere;
    const otherDevice = await openPage();
    const otherPerson = (await me(otherDevice)).body.user.id;
    const file = otherDevice.exportRecords();
    globalThis.indexedDB = home;

    const pageA = await openPage();
    const pageB = await openPage();
    await me(pageA);
    await (await pageB.readRecordsFile(file)).apply();

    const after = await me(pageA);
    expect(after.status).toBe(200);
    expect(after.body.user.id).toBe(otherPerson);
  });

  it('refuses a file that is not a records file, changing nothing', async () => {
    const page = await openPage();

    await expect(page.readRecordsFile(new Blob(['{"hello":"world"}']))).rejects.toMatchObject({ name: 'LocalRecordsFileRefused', reason: 'not-a-records-file' });
    expect((await me(page)).status).toBe(200);
  });

  it('refuses to boot over records saved by a newer build, and tries again next time (D1)', async () => {
    const page = await openPage();
    const { IndexedDbPersistence } = await import('../persistence.js');
    const persistence = new IndexedDbPersistence();
    const loaded = await persistence.load();
    if (loaded.kind !== 'ok') throw new Error('expected a saved snapshot');
    await persistence.save({ ...loaded.snapshot, formatVersion: 999, stateVersion: loaded.snapshot.stateVersion + 1 });
    await persistence.close();
    void page;

    vi.resetModules();
    const module = await import('../index.js');
    await expect(module.bootLocalBackend()).rejects.toMatchObject({ name: 'LocalFormatTooNewError' });
    await expect(module.bootLocalBackend()).rejects.toMatchObject({ name: 'LocalFormatTooNewError' });
  });
});
