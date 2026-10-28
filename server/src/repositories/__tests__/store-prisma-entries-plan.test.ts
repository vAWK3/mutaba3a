import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import type { FeedPageRequest } from '../ports.js';
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

/** MUT-390: the money-date order reads each kind through its own (money date, createdAt, id) index. */
const MONEY_DATE_INDEX: Record<string, { index: string; column: string }> = {
  expenses: { index: 'expenses_organizationId_occurredOn_createdAt_id_idx', column: 'occurredOn' },
  payments: { index: 'payments_organizationId_receivedOn_createdAt_id_idx', column: 'receivedOn' },
  receivables: { index: 'receivables_organizationId_origin_postingDate_createdAt_id_idx', column: 'postingDate' },
  conversions: { index: 'conversions_organizationId_occurredOn_createdAt_id_idx', column: 'occurredOn' },
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
  const seeded: string[] = [];
  // The seed is 2,000 rows per test: remove it, so a reused local test database does not grow with every run.
  afterAll(async () => {
    await client.receivable.deleteMany({ where: { organizationId: { in: seeded } } });
    await store.disconnect();
  });

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

  async function feedQueries(organizationId: string, cursor: { createdAt: Date; id: string } | null, request: Omit<FeedPageRequest, 'limit' | 'cursor'> = {}) {
    queries.length = 0;
    await store.entries.list([organizationId], { limit: 20, cursor, ...request });
    return queries.filter((q) => /FROM "public"\."(expenses|payments|receivables|conversions)"/.test(q.query) && /ORDER BY/.test(q.query));
  }

  /**
   * A firm whose receivables are mostly posted installments, as a Malafat-fed firm's are, with planner statistics:
   * only then does the ADJUSTMENT index beat walking the generic (organizationId, createdAt, id) index past every
   * installment.
   */
  async function firmWithInstallments() {
    const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    seeded.push(org.id);
    const base = Date.UTC(2026, 0, 1);
    await client.receivable.createMany({
      data: Array.from({ length: 2_000 }, (_, i) => ({
        organizationId: org.id, customerId: org.id, origin: 'INSTALLMENT' as const, currency: 'ILS', netMinor: 100n, vatMinor: 0n, grossMinor: 100n,
        vatTreatment: 'EXEMPT' as const, vatRateBasisPoints: 0, dueDate: '2026-10-31', postingDate: '2026-10-01', postedAt: new Date(base + i * 60_000), createdAt: new Date(base + i * 60_000), number: `CHG-2026-${String(i + 1).padStart(4, '0')}`,
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

  describe('Prisma entries query plans, money-date order and filters (MUT-390)', () => {
    const moneyCursor = { occurredOn: '2026-10-18', createdAt: new Date('2026-10-18T10:00:00Z'), id: '00000000-0000-4000-8000-000000000000' };
    const cases: Array<{ name: string; cursor: typeof moneyCursor | null; request: Omit<FeedPageRequest, 'limit' | 'cursor'>; bounds: Array<'<=' | '>=' | '<'> }> = [
      { name: 'first page', cursor: null, request: { order: 'occurredOn' }, bounds: [] },
      { name: 'past a cursor', cursor: moneyCursor, request: { order: 'occurredOn' }, bounds: ['<='] },
      { name: 'from a day', cursor: null, request: { order: 'occurredOn', occurredFrom: '2026-10-12' }, bounds: ['>='] },
      { name: 'from a day, past a cursor (both bounds kept)', cursor: moneyCursor, request: { order: 'occurredOn', occurredFrom: '2026-10-12', occurredBefore: '2026-10-20' }, bounds: ['<=', '>=', '<'] },
    ];
    for (const c of cases) {
      it(`reads every kind through its money-date index: ${c.name}`, async () => {
        const org = await firmWithInstallments();
        const sent = await feedQueries(org.id, c.cursor, c.request);
        expect(sent.map((q) => /FROM "public"\."(\w+)"/.exec(q.query)![1]).sort()).toEqual(['conversions', 'expenses', 'payments', 'receivables']);

        for (const q of sent) {
          const table = /FROM "public"\."(\w+)"/.exec(q.query)![1]!;
          const { index, column } = MONEY_DATE_INDEX[table]!;
          const plan = await planOf(q.query, JSON.parse(q.params) as unknown[]);
          expect(plan, `${table}:\n${plan}`).toContain('Index Scan');
          expect(plan, `${table}:\n${plan}`).toContain(index);
          expect(plan, `${table}:\n${plan}`).not.toMatch(/Seq Scan|Bitmap|\bSort\b/);
          const indexCond = /Index Cond: (.*)/.exec(plan)?.[1] ?? '';
          // A VarChar money date prints as ("occurredOn")::text in the plan.
          for (const op of c.bounds) expect(indexCond, `${table}:\n${plan}`).toContain(`("${column}")::text ${op} `);
        }
      });
    }

    it('reads logged-since-and-dated-before through the (createdAt, id) indexes, bounded by loggedSince', async () => {
      const org = await firmWithInstallments();
      const sent = await feedQueries(org.id, null, { loggedSince: new Date('2026-10-15T00:00:00Z'), occurredBefore: '2026-10-12' });
      expect(sent).toHaveLength(4);

      for (const q of sent) {
        const table = /FROM "public"\."(\w+)"/.exec(q.query)![1]!;
        const plan = await planOf(q.query, JSON.parse(q.params) as unknown[]);
        // Either (createdAt, id) index of receivables serves: loggedSince bounds both ranges to the week logged.
        const index = table === 'receivables' ? /receivables_organizationId_(origin_)?createdAt_id_idx/ : new RegExp(EXPECTED_INDEX[table]!);
        expect(plan, `${table}:\n${plan}`).toMatch(index);
        expect(plan, `${table}:\n${plan}`).not.toMatch(/Seq Scan|Bitmap|\bSort\b/);
        expect(plan, `${table}:\n${plan}`).toMatch(/Index Cond: .*"createdAt" >=/);
      }
    });
  });
}
