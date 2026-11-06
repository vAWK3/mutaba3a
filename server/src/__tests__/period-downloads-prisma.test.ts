import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { collectRows } from '../period-pack/index.js';
import { PrismaLedgerStore } from '../repositories/prisma.js';
import { person } from './helpers/accountants.js';
import { download, downloadHarness, expenseOn, indexOf, receiptOn, receivedOn, rowsOf, workbookOf, zipOf } from './helpers/period-downloads.js';

/**
 * MUT-314 (ADR-248) on Postgres (test:db): both downloads through the real app, and the data path's cost (test group
 * 14): a 1,000-row month (600 expenses, 400 received payments, 600 receipts) is collected in under 3 s and at most 20
 * queries (feed pages, receipt batches, one name batch: no N+1).
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('period downloads on Postgres (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  const queries: Prisma.QueryEvent[] = [];
  client.$on('query', (e) => queries.push(e));
  const store = new PrismaLedgerStore(client);
  afterAll(() => store.disconnect());

  describe('period downloads on Postgres (MUT-314)', () => {
    it('the report and the receipts zip agree, through the real app', async () => {
      const h = downloadHarness({ store });
      const p = await person(h, { email: `pack-${randomUUID()}@studio.ps`, displayName: 'Basel Sader' });
      const a = await expenseOn(h, p, p.personalId, { occurredOn: '2026-10-03', title: 'A', vendor: 'קפה' });
      await expenseOn(h, p, p.personalId, { occurredOn: '2026-09-30', title: 'before' });
      await receivedOn(h, p, p.personalId, '2026-10-09', '1.500', 'JOD');
      await receiptOn(h, p, p.personalId, a.id, new Uint8Array([1, 2, 3]));
      const asOf = h.now().toISOString();
      const wb = await workbookOf(await download(h, p, p.personalId, { asOf }));
      expect(rowsOf(wb.getWorksheet('Expenses')!).slice(1).map((r) => [r[0], r[2], r[3], r[15]])).toEqual([['E0001', 'קפה', 'A', 'E0001-1.png']]);
      expect(wb.getWorksheet('Income')!.getCell('F2')).toMatchObject({ value: 1.5, numFmt: '0.000' });
      const files = await zipOf(await download(h, p, p.personalId, { type: 'receipts', asOf }));
      expect(indexOf(files).slice(1)).toEqual([['receipts/E0001-1.png', 'E0001', '2026-10-03', 'קפה', 'ILS', '12.00', 'ok', a.id]]);
    });

    it('a 1,000-row month is collected in under 3 s and at most 20 queries', async () => {
      const { user, personalOrganization: org } = await store.users.create({
        email: `perf-${randomUUID()}@studio.ps`,
        displayName: 'Perf',
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
        locale: 'en',
        personal: { name: 'Personal', slug: `personal-${randomUUID()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
        at: new Date('2026-10-01T08:00:00Z'),
      });
      const at = new Date('2026-10-31T10:00:00Z');
      const day = (i: number) => `2026-10-${String((i % 28) + 1).padStart(2, '0')}`;
      for (let i = 0; i < 600; i++) {
        const e = await store.expenses.create(
          { organizationId: org.id, occurredOn: day(i), amountMinor: BigInt(1000 + i), currency: 'ILS', title: `E${i}`, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null },
          at,
        );
        const r = await store.expenseReceipts.create({ organizationId: org.id, expenseId: e.id, filename: 'r.png', mimeType: 'image/png', sizeBytes: 50 * 1024, receivedOn: '2026-10-31', uploadedByUserId: user.id, requestId: null }, at);
        await store.expenseReceipts.setKey(org.id, r.id, `org/${org.id}/r/${r.id}`);
        await store.expenseReceipts.complete(org.id, r.id, at);
      }
      for (let i = 0; i < 400; i++) {
        await store.payments.capture({ organizationId: org.id, customerId: null, projectId: null, currency: 'ILS', amountMinor: 500n, receivedOn: day(i), method: 'CASH', notes: null, requestId: null, createdByUserId: user.id, captureSource: 'app' }, at);
      }

      queries.length = 0;
      const started = performance.now();
      const rows = await collectRows(store, org, { from: '2026-10-01', to: '2026-10-31' }, new Date('2026-11-01T00:00:00Z'), 'en', { scope: 'report', forLink: false });
      const elapsed = performance.now() - started;
      expect(rows.expenses).toHaveLength(600);
      expect(rows.income).toHaveLength(400);
      expect(rows.expenses.reduce((n, l) => n + l.receipts.length, 0)).toBe(600);
      expect(elapsed).toBeLessThan(3_000);
      expect(queries.length).toBeLessThanOrEqual(20);
      const estimate = await store.periodPack.estimate(org.id, { occurredFrom: '2026-10-01', occurredBefore: '2026-11-01' }, new Date('2026-11-01T00:00:00Z'));
      expect(estimate).toEqual({ expenses: 600, income: 400, receipts: 600, receiptBytes: 600 * 50 * 1024 });
    }, 120_000);
  });
}
