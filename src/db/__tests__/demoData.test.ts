import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { getRepositories } from '../provider';

// MUT-47 (T7): demo removal is by id prefix only. A user's own rows, even in
// the same tables, survive `removeDemoData` and `?demo=1` resets.

const now = '2024-01-01T00:00:00.000Z';

async function clearAll() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(clearAll);
afterEach(clearAll);

describe('demoData.removeDemoData', () => {
  it('deletes demo_ rows and keeps the person\'s own rows', async () => {
    await db.clients.bulkAdd([
      { id: 'demo_client_1', name: 'Sample', createdAt: now, updatedAt: now },
      { id: 'mine-1', name: 'Mine', createdAt: now, updatedAt: now },
    ]);
    await db.transactions.bulkAdd([
      { id: 'demo_tx_1', kind: 'income', status: 'paid', amountMinor: 1, currency: 'USD', occurredAt: '2024-01-01', createdAt: now, updatedAt: now },
      { id: 'tx-mine', kind: 'income', status: 'paid', amountMinor: 1, currency: 'USD', occurredAt: '2024-01-01', createdAt: now, updatedAt: now },
    ]);
    await db.businessProfiles.bulkAdd([
      { id: 'demo_profile_1', name: 'Sample biz', isDefault: false, defaultCurrency: 'USD', createdAt: now, updatedAt: now },
      { id: 'bp-mine', name: 'My biz', isDefault: true, defaultCurrency: 'USD', createdAt: now, updatedAt: now },
    ]);

    const demo = getRepositories().base.demoData;
    expect(await demo.hasDemoData()).toBe(true);

    await demo.removeDemoData();

    expect((await db.clients.toArray()).map((c) => c.id)).toEqual(['mine-1']);
    expect((await db.transactions.toArray()).map((t) => t.id)).toEqual(['tx-mine']);
    expect((await db.businessProfiles.toArray()).map((p) => p.id)).toEqual(['bp-mine']);
    expect(await demo.hasDemoData()).toBe(false);
    expect(await demo.hasOwnData()).toBe(true);
    expect(await demo.hasUserDefaultProfile()).toBe(true);
  });
});
