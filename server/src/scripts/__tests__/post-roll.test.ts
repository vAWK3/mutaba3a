import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../../repositories/prisma.js';
import { repairCaptureOrigins } from '../post-roll.js';

/**
 * deploy.sh step 6 (MUT-61): the migration backfills `origin` before the new
 * revision serves, so a payment a person captured through the old revision in
 * between — or after a rollback — keeps the default INTEGRATION. The repair
 * must mark exactly those CAPTURE, touch nothing else, and be repeatable.
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('post-roll repairs (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const store = PrismaLedgerStore.connect(url);
  afterAll(async () => {
    await db.$disconnect();
    await store.disconnect();
  });

  describe('repairCaptureOrigins', () => {
    it('re-marks a person’s payment left INTEGRATION, leaves the integration’s own and existing captures alone, and reports 0 the second time', async () => {
      const at = new Date('2026-10-12T08:00:00Z');
      const tag = randomUUID().slice(0, 8);
      const org = await store.organizations.create({ name: 'Firm', slug: `post-roll-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const { user } = await store.users.create({ email: `post-roll-${tag}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: org.id, personal: { name: 'Personal', slug: `personal-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at });
      const base = { organizationId: org.id, customerId: null, projectId: null, currency: 'ILS', amountMinor: 1000n, receivedOn: '2026-10-10', method: 'CASH' as const, reference: null, notes: null, replacesPaymentId: null, requestId: null, captureSource: null, allocations: [] };
      // What the old revision wrote during the window: a person's payment with the column default.
      const stranded = (await store.payments.create({ ...base, createdByUserId: user.id, origin: 'INTEGRATION' }, at)).payment;
      const integration = (await store.payments.create({ ...base, createdByUserId: null, origin: 'INTEGRATION' }, at)).payment;
      const capture = await store.payments.capture({ ...base, createdByUserId: user.id, captureSource: 'app' }, at);

      expect(await repairCaptureOrigins(db)).toBeGreaterThanOrEqual(1);
      expect(await store.payments.getById(org.id, stranded.id)).toMatchObject({ origin: 'CAPTURE' });
      expect(await store.payments.getById(org.id, integration.id)).toMatchObject({ origin: 'INTEGRATION' });
      expect(await store.payments.getById(org.id, capture.id)).toMatchObject({ origin: 'CAPTURE', captureSource: 'app' });
      expect(await repairCaptureOrigins(db)).toBe(0);
    });
  });
}
