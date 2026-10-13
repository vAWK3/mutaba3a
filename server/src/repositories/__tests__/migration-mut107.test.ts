import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * MUT-107: the fee_proposals contingency columns reuse the UpfrontTreatment
 * enum MUT-100 already created, so this is one migration, one transaction —
 * unlike MUT-100's own two-step enum-then-CHECK split. Applied as `prisma
 * migrate deploy` would, on a scratch database built from the full history
 * before it.
 */
vi.setConfig({ testTimeout: 60_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
// MUT-100's own ENUM migration must commit alone before its value is usable
// (Postgres refuses an uncommitted enum value); its history sits before ours.
const ENUM = '20261013090000_mut100_agreement_type_contingency';
const TARGET = '20261013100000_mut107_contingency_fee_proposals';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-107 fee_proposals contingency migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-107 fee_proposals contingency migration', () => {
    it('applies cleanly; the CHECK rejects one-set-one-null; a both-or-neither row round-trips; the result matches the schema', async () => {
      const name = `mut107_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      execute(dbUrl, dirs.slice(0, dirs.indexOf(ENUM)).map(sqlOf).join('\n;\n'));
      // The enum value and everything after it (including our own migration) each commit alone.
      for (const dir of dirs.slice(dirs.indexOf(ENUM), dirs.indexOf(TARGET))) execute(dbUrl, `BEGIN;\n${sqlOf(dir)}\nCOMMIT;`);

      const orgId = randomUUID();
      await db.$executeRawUnsafe(`INSERT INTO organizations (id, name, slug, "defaultCurrency", timezone, "updatedAt") VALUES ('${orgId}', 'Firm', 'firm-${randomUUID().slice(0, 8)}', 'ILS', 'Asia/Jerusalem', CURRENT_TIMESTAMP)`);
      const insertProposal = (extra = '', values = '') =>
        db.$executeRawUnsafe(
          `INSERT INTO fee_proposals (id, "organizationId", "projectId", "customerId", currency, "pricingBasis", "proposedAmountMinor", "proposedOn"${extra}) VALUES ('${randomUUID()}', '${orgId}', '${randomUUID()}', '${randomUUID()}', 'ILS', 'VAT_EXCLUSIVE', 150000, '2026-10-13'${values})`,
        );
      await insertProposal();

      // Each file applies as its own transaction, matching `prisma migrate deploy`.
      execute(dbUrl, `BEGIN;\n${sqlOf(TARGET)}\nCOMMIT;`);

      const rows = await db.$queryRawUnsafe<Array<{ commissionRateBasisPoints: number | null }>>(`SELECT "commissionRateBasisPoints" FROM fee_proposals`);
      expect(rows).toEqual([{ commissionRateBasisPoints: null }]);

      await expect(insertProposal(', "commissionRateBasisPoints"', ', 2000')).rejects.toThrow(/fee_proposals_contingency_terms_check/);
      await expect(insertProposal(', "upfrontTreatment"', ", 'SEPARATE'")).rejects.toThrow(/fee_proposals_contingency_terms_check/);
      await insertProposal(', "commissionRateBasisPoints", "upfrontTreatment"', ', 2000, \'SEPARATE\'');
      const withTerms = await db.$queryRawUnsafe<Array<{ commissionRateBasisPoints: number | null; upfrontTreatment: string | null }>>(
        `SELECT "commissionRateBasisPoints", "upfrontTreatment" FROM fee_proposals WHERE "commissionRateBasisPoints" IS NOT NULL`,
      );
      expect(withTerms).toEqual([{ commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' }]);

      // The rest of the history (MUT-131 onwards), one transaction per file as `prisma migrate deploy` applies it, ends at the schema.
      for (const dir of dirs.slice(dirs.indexOf(TARGET) + 1)) execute(dbUrl, `BEGIN;\n${sqlOf(dir)}\nCOMMIT;`);
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
