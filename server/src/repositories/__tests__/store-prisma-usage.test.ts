import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { usageEvent } from '../../usage/event.js';
import { PrismaLedgerStore } from '../prisma.js';
import { recordUsageTx } from '../prisma-usage.js';
import { describeLedgerStoreUsageContract } from './store-contract-usage.js';

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma LedgerStore usage contract (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  afterAll(async () => {
    await store.disconnect();
    await client.$disconnect();
  });
  describeLedgerStoreUsageContract('Prisma', async () => store, { concurrent: true });

  describe('Prisma usage ledger (MUT-735)', () => {
    it('an event recorded in a transaction that rolls back leaves neither the event nor the counter', async () => {
      const subjectKey = `user:${randomUUID()}`;
      const event = usageEvent({ subjectKey, plan: 'solo', door: 'PORTAL', actorUserId: null }, { kind: 'SCAN', detail: 'LIBRARY', entityKey: randomUUID(), organizationId: null }, new Date('1950-03-10T10:00:00Z'));
      await expect(
        client.$transaction(async (tx) => {
          await recordUsageTx(tx, event, null);
          throw new Error('the action failed');
        }),
      ).rejects.toThrow('the action failed');
      expect(await client.usageEvent.count({ where: { subjectKey } })).toBe(0);
      expect(await client.usageCounter.count({ where: { subjectKey } })).toBe(0);
    });

    it('the month rollup is one query', async () => {
      const queries: string[] = [];
      client.$on('query', (e) => queries.push(e.query));
      const { prismaUsage } = await import('../prisma-usage.js');
      const usage = prismaUsage(() => client);
      queries.length = 0;
      await usage.rollup('1950-03');
      expect(queries.filter((q) => !/^(BEGIN|COMMIT|SELECT 1)/i.test(q))).toHaveLength(1);
    });
  });
}
