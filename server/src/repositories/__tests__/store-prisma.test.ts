import { afterAll, describe, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';
import { describeLedgerStoreContract } from './store-contract.js';

/**
 * Runs the same contract against Postgres. Skipped unless
 * MUTABA3A_TEST_DATABASE_URL points at a migrated database
 * (`npm run test:db` uses the docker container from README.md).
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma LedgerStore contract (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  afterAll(() => store.disconnect());
  describeLedgerStoreContract('Prisma', async () => store);
}
