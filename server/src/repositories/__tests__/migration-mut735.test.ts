import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertFirmRow, insertUserWithPersonalRow } from './fixtures/raw-rows.js';
import { usageMonthOf } from '../../usage/month.js';

/**
 * MUT-735 (ADR-281): the usage tables, with this Asia/Jerusalem month's counters backfilled from the documents issued
 * and the scans finished this month (last month's and unfinished ones are not), per payer: the profile's creator or
 * personal owner, else the firm itself. Runs on a scratch database built from the migrations before it.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT735 = '20261125230000_mut735_usage_metering';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-735 usage metering migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-735 usage metering migration', () => {
    it("backfills this month's DOCUMENTS and SCANS per payer, and matches the schema", async () => {
      const name = `mut735_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      expect(dirs).toContain(MUT735);
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT735))));
      const firm = await insertFirmRow(db, 'Firm');
      const { userId, personalId } = await insertUserWithPersonalRow(db, [firm.id]);
      const business = randomUUID();
      await db.$executeRawUnsafe(
        `INSERT INTO organizations (id, name, slug, "defaultCurrency", timezone, "updatedAt", "ownerUserId", "profileType") VALUES ('${business}', 'Studio', 'studio-${business.slice(0, 8)}', 'ILS', 'Asia/Jerusalem', now(), '${userId}', 'BUSINESS')`,
      );
      let number = 0;
      const doc = (organizationId: string, issuedAt: string) =>
        db.$executeRawUnsafe(
          `INSERT INTO issued_documents (id, "organizationId", "docType", number, "documentDate", "issuedAt", currency, "subtotalMinor", "discountMinor", "netMinor", "vatRateBasisPoints", "vatMinor", "grossMinor", "pricesIncludeVat", issuer, customer, language, style, ink, "coreVersion", "createdByUserId", "requestKey")
           VALUES ('${randomUUID()}', '${organizationId}', 'RECEIPT', ${++number}, '2026-01-01', ${issuedAt}, 'ILS', 100, 0, 100, 0, 0, 100, false, '{}', '{}', 'he', 'PROFESSIONAL', 'BLACK', '1.0.0', '${userId}', '${randomUUID()}')`,
        );
      const scan = (organizationId: string, status: string, completedAt: string) =>
        db.$executeRawUnsafe(
          `INSERT INTO expense_receipts (id, "organizationId", filename, "mimeType", "sizeBytes", "storageKey", status, "filingStatus", "completedAt", "createdAt") VALUES ('${randomUUID()}', '${organizationId}', 'r.pdf', 'application/pdf', 10, 'k/${randomUUID()}', '${status}', 'TO_REVIEW', ${completedAt}, now())`,
        );
      const thisMonth = `(now() AT TIME ZONE 'UTC')`;
      const lastMonth = `((date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'UTC') - interval '1 minute'`;
      await doc(business, thisMonth);
      await doc(personalId, thisMonth);
      await doc(business, lastMonth);
      await doc(firm.id, thisMonth);
      await scan(business, 'READY', thisMonth);
      await scan(business, 'PENDING_UPLOAD', 'NULL');
      await scan(firm.id, 'READY', lastMonth);

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT735)}\n;\nCOMMIT;`);

      const month = usageMonthOf(new Date());
      const rows = await db.$queryRawUnsafe<Array<{ subjectKey: string; month: string; meter: string; count: number; plan: string }>>(`SELECT "subjectKey", month, meter, count, plan FROM usage_counters ORDER BY "subjectKey", meter`);
      expect(rows).toEqual(
        [
          { subjectKey: `org:${firm.id}`, month, meter: 'DOCUMENTS', count: 1, plan: 'none' },
          { subjectKey: `user:${userId}`, month, meter: 'DOCUMENTS', count: 2, plan: 'none' },
          { subjectKey: `user:${userId}`, month, meter: 'SCANS', count: 1, plan: 'none' },
        ].sort((a, b) => (a.subjectKey + a.meter < b.subjectKey + b.meter ? -1 : 1)),
      );
      expect(await db.$queryRawUnsafe<Array<{ n: bigint }>>('SELECT count(*) AS n FROM usage_events')).toEqual([{ n: 0n }]);

      const rest = dirs.slice(dirs.indexOf(MUT735) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
