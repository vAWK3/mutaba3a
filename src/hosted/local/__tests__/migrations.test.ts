import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { LOCAL_FORMAT_VERSION, migrate, type StoredSnapshot } from '../migrations/index.js';

/** The local snapshot's format migrations (D1, brief §2.5): a device's older snapshot opens in this build's shape. */

const AT = new Date('2026-10-01T08:00:00.000Z');

/** A format-1 snapshot, as a device saved it before MUT-300: no firm fields on profiles, no role on memberships. */
async function formatOneSnapshot(): Promise<StoredSnapshot> {
  const store = new MemoryLedgerStore();
  await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: null, locale: 'ar', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
  const { maps } = store.snapshot();
  const orgs = new Map([...maps.orgs].map(([id, org]) => {
    const { firmEnabledAt: _e, firmRequestedAt: _r, firmRequestedByUserId: _b, ...v1 } = org;
    return [id, v1];
  }));
  const members = new Map([...maps.members].map(([key, membership]) => {
    const { role: _role, ...v1 } = membership;
    return [key, v1];
  }));
  return { formatVersion: 1, stateVersion: 3, savedAt: AT, maps: { ...maps, orgs, members } as unknown as StoredSnapshot['maps'] };
}

describe('local snapshot migrations', () => {
  it('runs up to the current format', async () => {
    expect((migrate(await formatOneSnapshot())).formatVersion).toBe(LOCAL_FORMAT_VERSION);
  });

  it('1 → 2 (MUT-300): profiles arrive with firm features off and nothing requested; memberships as OWNER', async () => {
    const before = await formatOneSnapshot();

    const after = migrate(before);

    expect([...after.maps.orgs.values()]).toEqual([...before.maps.orgs.values()].map((org) => ({ ...org, firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null })));
    expect([...after.maps.members.values()]).toEqual([...before.maps.members.values()].map((m) => ({ ...m, role: 'OWNER' })));
    expect(after.stateVersion).toBe(before.stateVersion);
  });

  it("leaves the snapshot it was given untouched", async () => {
    const before = await formatOneSnapshot();
    const orgs = JSON.stringify([...before.maps.orgs.values()]);

    migrate(before);

    expect(JSON.stringify([...before.maps.orgs.values()])).toBe(orgs);
    expect([...before.maps.members.values()].every((m) => !('role' in m))).toBe(true);
  });

  it('restores into a store whose /v1/me reads the firm fields', async () => {
    const store = new MemoryLedgerStore();

    store.restore(migrate(await formatOneSnapshot()));

    const [org] = [...store.snapshot().maps.orgs.values()];
    expect(org).toMatchObject({ firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null });
  });
});
