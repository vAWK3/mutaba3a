import { afterAll, describe, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';
import { describeLedgerStoreExpenseGroupsContract } from './store-contract-expense-groups.js';

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma LedgerStore expense groups contract (MUT-267) (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  afterAll(() => store.disconnect());
  describeLedgerStoreExpenseGroupsContract('Prisma', async () => store);
}
