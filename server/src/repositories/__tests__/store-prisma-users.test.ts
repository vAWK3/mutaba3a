import { afterAll, describe, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';
import { describeLedgerStoreUsersContract } from './store-contract-users.js';

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma LedgerStore users contract (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  afterAll(() => store.disconnect());
  describeLedgerStoreUsersContract('Prisma', async () => store);
}
