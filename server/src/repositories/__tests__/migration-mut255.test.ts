import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-255: the receipts library columns. Every receipt that exists before the
 * migration comes out FILED, with its upload day in the profile's timezone.
 * An insert shaped like the previous revision's (an expense, no filing status)
 * still passes the CHECK during a rolling deploy, and the CHECK refuses a FILED
 * receipt with no expense and a To-review one with an expense. Runs on a
 * scratch database built from the migrations before it.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT255 = '20261022090000_mut255_receipts_library';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-255 receipts library migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-255 receipts library migration', () => {
    it('backfills FILED and the local upload day, keeps old-shape inserts working, enforces the CHECK and matches the schema', async () => {
      const name = `mut255_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT255))));
      const nour = await insertUserWithPersonalRow(db, []);
      await db.$executeRawUnsafe(`UPDATE organizations SET timezone = 'Asia/Amman' WHERE id = '${nour.personalId}'`);
      const expenseId = randomUUID();
      const at = '2026-10-05T10:00:00.000Z';
      await db.$executeRawUnsafe(`INSERT INTO expenses (id, "organizationId", "occurredOn", "amountMinor", currency, "createdByUserId", "createdAt", "updatedAt") VALUES ('${expenseId}', '${nour.personalId}', '2026-10-05', 1000, 'JOD', '${nour.userId}', '${at}', '${at}')`);
      // 22:30 UTC on the 5th is already the 6th in Amman (UTC+3).
      const receiptId = randomUUID();
      const insertReceipt = (id: string, createdAt: string) =>
        db.$executeRawUnsafe(
          `INSERT INTO expense_receipts (id, "organizationId", "expenseId", filename, "mimeType", "sizeBytes", status, "storageKey", "uploadedByUserId", "createdAt") VALUES ('${id}', '${nour.personalId}', '${expenseId}', 'r.pdf', 'application/pdf', 10, 'READY', 'k', '${nour.userId}', '${createdAt}')`,
        );
      await insertReceipt(receiptId, '2026-10-05T22:30:00.000Z');

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT255)}\n;\nCOMMIT;`);

      const rows = await db.$queryRawUnsafe<Array<{ filingStatus: string; receivedOn: string; version: number }>>(`SELECT "filingStatus"::text AS "filingStatus", "receivedOn", version FROM expense_receipts WHERE id = '${receiptId}'`);
      expect(rows).toEqual([{ filingStatus: 'FILED', receivedOn: '2026-10-06', version: 1 }]);

      // The previous revision's insert (an expense, neither new column) still works during the rolling deploy.
      const oldShape = randomUUID();
      await db.$executeRawUnsafe(
        `INSERT INTO expense_receipts (id, "organizationId", "expenseId", filename, "mimeType", "sizeBytes", status, "storageKey", "uploadedByUserId", "createdAt") VALUES ('${oldShape}', '${nour.personalId}', '${expenseId}', 'r.pdf', 'application/pdf', 10, 'PENDING_UPLOAD', '', '${nour.userId}', now())`,
      );
      const oldRow = await db.$queryRawUnsafe<Array<{ filingStatus: string; receivedOn: string }>>(`SELECT "filingStatus"::text AS "filingStatus", "receivedOn" FROM expense_receipts WHERE id = '${oldShape}'`);
      expect(oldRow[0]!.filingStatus).toBe('FILED');
      expect(oldRow[0]!.receivedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // FILED exactly when there is an expense.
      await expect(db.$executeRawUnsafe(`UPDATE expense_receipts SET "expenseId" = NULL WHERE id = '${receiptId}'`)).rejects.toThrow(/expense_receipts_filed_has_record/);
      await expect(db.$executeRawUnsafe(`UPDATE expense_receipts SET "filingStatus" = 'TO_REVIEW' WHERE id = '${receiptId}'`)).rejects.toThrow(/expense_receipts_filed_has_record/);
      await db.$executeRawUnsafe(`UPDATE expense_receipts SET "expenseId" = NULL, "filingStatus" = 'TO_REVIEW' WHERE id = '${receiptId}'`);

      // Expenses are only soft-deleted: the foreign key still refuses a hard delete of one with receipts.
      await expect(db.$executeRawUnsafe(`DELETE FROM expenses WHERE id = '${expenseId}'`)).rejects.toThrow();

      const rest = dirs.slice(dirs.indexOf(MUT255) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
