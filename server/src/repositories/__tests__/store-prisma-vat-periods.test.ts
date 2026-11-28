import { afterAll, describe, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';
import { describeLedgerStoreVatPeriodContract } from './store-contract-vat-periods.js';

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma LedgerStore VAT period contract (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  afterAll(() => store.disconnect());
  describeLedgerStoreVatPeriodContract('Prisma', async () => store);
}
