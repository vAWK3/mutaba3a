import { afterAll, describe, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';
import { describeLedgerStoreCoOwnersContract } from './store-contract-co-owners.js';

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma LedgerStore co-owners contract (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  afterAll(() => store.disconnect());
  // Only Postgres can race two transactions; the memory store is single-threaded.
  describeLedgerStoreCoOwnersContract('Prisma', async () => store, { concurrent: true });
}
