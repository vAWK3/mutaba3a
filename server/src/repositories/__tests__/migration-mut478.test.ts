import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertFirmRow } from './fixtures/raw-rows.js';

/**
 * MUT-478: receivable numbers. Existing receivables are numbered CHG-YYYY-NNNN per organization and posting year in
 * (postingDate, postedAt, id) order, and each counter resumes after its last number. An insert shaped like the
 * previous revision's (no number) is numbered by the trigger during a rolling deploy; the new revision's insert keeps
 * the number it sends; a duplicate is refused. Runs on a scratch database built from the migrations before it.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT478 = '20261027160000_mut478_receivable_numbers';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-478 receivable numbers migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  const created: string[] = [];
  const clients: PrismaClient[] = [];

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.$disconnect()));
    for (const name of created) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  });

  describe('MUT-478 receivable numbers migration', () => {
    it('backfills in posting order per organization and year, numbers old-shape inserts, keeps sent numbers, refuses duplicates, and matches the schema', async () => {
      const name = `mut478_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT478))));
      const firmA = await insertFirmRow(db, 'A');
      const firmB = await insertFirmRow(db, 'B');
      const insert = (organizationId: string, postingDate: string, postedAt: string, id = randomUUID(), number: string | null = null) =>
        db
          .$executeRawUnsafe(
            `INSERT INTO receivables (id, "organizationId", "customerId", origin, currency, "netMinor", "vatMinor", "grossMinor", "vatTreatment", "vatRateBasisPoints", "dueDate", "postingDate", "postedAt"${number ? ', number' : ''}) VALUES ('${id}', '${organizationId}', '${randomUUID()}', 'ADJUSTMENT', 'ILS', 100, 0, 100, 'EXEMPT', 0, '${postingDate}', '${postingDate}', '${postedAt}'${number ? `, '${number}'` : ''})`,
          )
          .then(() => id);
      const later = await insert(firmA.id, '2026-03-01', '2026-03-01T12:00:00Z');
      const earlier = await insert(firmA.id, '2026-03-01', '2026-03-01T09:00:00Z');
      const january = await insert(firmA.id, '2026-01-15', '2026-02-01T00:00:00Z');
      const lastYear = await insert(firmA.id, '2025-12-31', '2025-12-31T00:00:00Z');
      const other = await insert(firmB.id, '2026-03-01', '2026-03-01T00:00:00Z');

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT478)}\n;\nCOMMIT;`);

      const numberOf = async (id: string) => (await db.$queryRawUnsafe<Array<{ number: string }>>(`SELECT number FROM receivables WHERE id = '${id}'`))[0]?.number;
      expect(await numberOf(lastYear)).toBe('CHG-2025-0001');
      expect(await numberOf(january)).toBe('CHG-2026-0001');
      expect(await numberOf(earlier)).toBe('CHG-2026-0002');
      expect(await numberOf(later)).toBe('CHG-2026-0003');
      expect(await numberOf(other)).toBe('CHG-2026-0001');
      const counters = await db.$queryRawUnsafe<Array<{ organizationId: string; year: number; next: number }>>(`SELECT "organizationId", year, next FROM receivable_counters ORDER BY "organizationId", year`);
      expect(counters.filter((c) => c.organizationId === firmA.id).map((c) => [c.year, c.next])).toEqual([[2025, 1], [2026, 3]]);

      // The previous revision's insert (no number) is numbered by the trigger, after the backfilled ones.
      expect(await numberOf(await insert(firmA.id, '2026-10-01', '2026-10-01T00:00:00Z'))).toBe('CHG-2026-0004');
      // A first receivable in a new year starts that year's counter.
      expect(await numberOf(await insert(firmB.id, '2027-01-02', '2027-01-02T00:00:00Z'))).toBe('CHG-2027-0001');
      // The new revision's insert keeps the number it took from the counter itself.
      await db.$executeRawUnsafe(`UPDATE receivable_counters SET next = next + 1 WHERE "organizationId" = '${firmA.id}' AND year = 2026`);
      expect(await numberOf(await insert(firmA.id, '2026-10-02', '2026-10-02T00:00:00Z', randomUUID(), 'CHG-2026-0005'))).toBe('CHG-2026-0005');
      // Unique per organization.
      await expect(insert(firmA.id, '2026-10-03', '2026-10-03T00:00:00Z', randomUUID(), 'CHG-2026-0005')).rejects.toThrow(/23505/);

      const rest = dirs.slice(dirs.indexOf(MUT478) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
