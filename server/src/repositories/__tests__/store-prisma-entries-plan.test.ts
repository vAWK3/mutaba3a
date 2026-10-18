import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';

/**
 * MUT-270 AC "no full scan of a firm's ledger per page": every per-kind query the feed sends is answered by an
 * ordered index scan in (createdAt, id) order — no sequential or bitmap scan, no sort of the organization's rows —
 * and past a cursor the index range itself starts at the cursor. Those plan shapes are switched off for the EXPLAIN,
 * so the planner uses an ordered index whenever one can serve the query; a missing index or an unindexable cursor
 * condition then shows up as a Seq Scan or a Sort instead of passing by luck of a small table.
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

const EXPECTED_INDEX: Record<string, string> = {
  expenses: 'expenses_organizationId_createdAt_id_idx',
  payments: 'payments_organizationId_createdAt_id_idx',
  receivables: 'receivables_organizationId_origin_createdAt_id_idx',
  conversions: 'conversions_organizationId_createdAt_id_idx',
};

if (!url) {
  describe.skip('Prisma entries query plans (MUT-270) (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  const queries: Prisma.QueryEvent[] = [];
  client.$on('query', (e) => queries.push(e));
  const store = new PrismaLedgerStore(client);
  afterAll(() => store.disconnect());

  const unique = () => Math.random().toString(36).slice(2, 10);

  /**
   * Bound raw parameters arrive as text (`uuid = text` fails), so each $n becomes an untyped literal and Postgres
   * infers its type from the column, as it does for Prisma's own query. Every value here is test-made (ids, dates,
   * numbers, enum names): no quoting hazard.
   */
  function inline(sql: string, params: unknown[]): string {
    return params.reduceRight<string>((text, value, i) => text.replaceAll(`$${i + 1}`, typeof value === 'number' ? String(value) : `'${String(value)}'`), sql);
  }

  async function planOf(sql: string, params: unknown[]): Promise<string> {
    const [, , , rows] = await client.$transaction([
      client.$executeRawUnsafe('SET LOCAL enable_seqscan = off'),
      client.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off'),
      client.$executeRawUnsafe('SET LOCAL enable_sort = off'),
      client.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN ${inline(sql, params)}`),
    ]);
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  }

  async function feedQueries(organizationId: string, cursor: { createdAt: Date; id: string } | null) {
    queries.length = 0;
    await store.entries.list([organizationId], { limit: 20, cursor });
    return queries.filter((q) => /FROM "public"\."(expenses|payments|receivables|conversions)"/.test(q.query) && /ORDER BY/.test(q.query));
  }

  /**
   * A firm whose receivables are mostly posted installments, as a Malafat-fed firm's are, with planner statistics:
   * only then does the ADJUSTMENT index beat walking the generic (organizationId, createdAt, id) index past every
   * installment.
   */
  async function firmWithInstallments() {
    const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const base = Date.UTC(2026, 0, 1);
    await client.receivable.createMany({
      data: Array.from({ length: 2_000 }, (_, i) => ({
        organizationId: org.id, customerId: org.id, origin: 'INSTALLMENT' as const, currency: 'ILS', netMinor: 100n, vatMinor: 0n, grossMinor: 100n,
        vatTreatment: 'EXEMPT' as const, vatRateBasisPoints: 0, dueDate: '2026-10-31', postingDate: '2026-10-01', postedAt: new Date(base + i * 60_000), createdAt: new Date(base + i * 60_000),
      })),
    });
    await client.$executeRawUnsafe('ANALYZE receivables');
    return org;
  }

  describe('Prisma entries query plans (MUT-270)', () => {
    for (const withCursor of [false, true]) {
      it(`reads every kind through its (createdAt, id) index${withCursor ? ', past a cursor' : ''}`, async () => {
        const org = await firmWithInstallments();
        const sent = await feedQueries(org.id, withCursor ? { createdAt: new Date('2026-10-18T10:00:00Z'), id: '00000000-0000-4000-8000-000000000000' } : null);
        expect(sent.map((q) => /FROM "public"\."(\w+)"/.exec(q.query)![1]).sort()).toEqual(['conversions', 'expenses', 'payments', 'receivables']);

        for (const q of sent) {
          const table = /FROM "public"\."(\w+)"/.exec(q.query)![1]!;
          const plan = await planOf(q.query, JSON.parse(q.params) as unknown[]);
          expect(plan, `${table}:\n${plan}`).toContain(`Index Scan`);
          expect(plan, `${table}:\n${plan}`).toContain(EXPECTED_INDEX[table]!);
          expect(plan, `${table}:\n${plan}`).not.toMatch(/Seq Scan|Bitmap|\bSort\b/);
          if (withCursor) expect(plan, `${table}:\n${plan}`).toMatch(/Index Cond: .*"createdAt" <=/);
        }
      });
    }
  });
}
