import { afterAll, describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';

/**
 * MUT-437 review: Claude fires one add_expense per statement line in parallel. A same-person call waiting for the
 * agent write lock must not hold a pooled connection, or the call holding the lock can't get one for its own queries
 * and the whole pool stalls until the lock times out. A pool of 7 and 8 parallel runs reproduces it, for one person (the
 * per-person queue) and for eight people (the 3-slot cap: 3 lock transactions + 3 holders' queries fit in 7).
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma agent write lock under a small pool (MUT-437) (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const small = new URL(url);
  // Below 8 lock transactions, above the 3 lock slots plus each holder's own query.
  small.searchParams.set('connection_limit', '7');
  small.searchParams.set('pool_timeout', '3');
  const store = PrismaLedgerStore.connect(small.toString());
  afterAll(() => store.disconnect());

  describe('Prisma agent write lock under a small pool (MUT-437)', () => {
    it('finishes eight parallel runs for one person, each querying, on a pool of seven', async () => {
      const userId = crypto.randomUUID();
      const runs = Array.from({ length: 8 }, (_, i) =>
        store.agentWriteLock.run(userId, async () => {
          await store.inboxEntries.countByUser(userId);
          await store.inboxEntries.countByUser(userId);
          return i;
        }),
      );
      expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }, 30_000);

    it('finishes eight parallel runs for eight people, each querying, on the same pool', async () => {
      const runs = Array.from({ length: 8 }, (_, i) => {
        const userId = crypto.randomUUID();
        return store.agentWriteLock.run(userId, async () => {
          await store.inboxEntries.countByUser(userId);
          await store.inboxEntries.countByUser(userId);
          return i;
        });
      });
      expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }, 30_000);
  });
}
