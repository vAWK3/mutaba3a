import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertCustomerRow, insertFirmRow } from './fixtures/raw-rows.js';

/**
 * MUT-742 (ADR-287, option A): every issued document records the jurisdiction and the pack version it was issued under;
 * the issuer's tax ID gets a scheme and room (VarChar 32), a customer's tax ID room. Issued documents are INSERT-only
 * (ADR-260), so the migration must change no existing row: columns added with a constant default (catalog-only, no
 * UPDATE, no trigger), then the old rows read back IL and 1.0.0. Runs on a scratch database built from the migrations
 * before it, with the old rows written as raw SQL (today's client selects columns the old database lacks).
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT742 = '20261127140000_mut742_issuing_jurisdiction';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}
const refused = (dbUrl: string, sql: string): string => {
  try {
    execute(dbUrl, sql);
  } catch (error) {
    return String((error as { stderr?: Buffer }).stderr ?? error);
  }
  return '';
};

if (!url) {
  describe.skip('MUT-742 issuing jurisdiction migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  /** A scratch database at the migration before this one, with a profile, an issuer, a customer and two documents. */
  async function scratchBefore() {
    const name = `mut742_migtest_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created.push(name);
    const u = new URL(url!);
    u.pathname = `/${name}`;
    const dbUrl = u.toString();
    const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    clients.push(db);
    const dirs = migrationDirs();
    expect(dirs).toContain(MUT742);
    expect(dirs.indexOf(MUT742), 'sorts after the last migration it follows').toBe(dirs.length - 1);
    execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT742))));
    const firm = await insertFirmRow(db, 'Studio');
    await db.$executeRawUnsafe(
      `INSERT INTO issuer_details ("organizationId", "legalName", "vatId", country, "dealerType", "updatedAt") VALUES ('${firm.id}', 'Studio Ltd', '515151512', 'IL', 'COMPANY', now())`,
    );
    const customer = await insertCustomerRow(db, firm.id);
    await db.$executeRawUnsafe(`UPDATE customers SET "taxId" = '514713288' WHERE id = '${customer.id}'`);
    let number = 0;
    const doc = (docType: string) =>
      db.$executeRawUnsafe(
        `INSERT INTO issued_documents (id, "organizationId", "docType", number, "documentDate", "issuedAt", currency, "subtotalMinor", "discountMinor", "netMinor", "vatRateBasisPoints", "vatMinor", "grossMinor", "pricesIncludeVat", issuer, customer, language, style, ink, "coreVersion", "createdByUserId", "requestKey")
         VALUES ('${randomUUID()}', '${firm.id}', '${docType}', ${++number}, '2026-11-02', now(), 'ILS', 10000, 0, 10000, 1800, 1800, 11800, false, '{"vatId":"515151512"}', '{"name":"Client"}', 'he', 'PROFESSIONAL', 'BLACK', '1.0.0', '${randomUUID()}', 'k-${number}')`,
      );
    await doc('TAX_INVOICE');
    await doc('RECEIPT');
    return { dbUrl, db, firmId: firm.id, customerId: customer.id };
  }

  /** Every pre-existing column of every row, hashed: what "unchanged" means. */
  const fingerprint = (db: PrismaClient, table: string, exclude: string[]) =>
    db.$queryRawUnsafe<Array<{ id: string; h: string }>>(
      `SELECT ${table === 'issuer_details' ? '"organizationId"::text' : 'id::text'} AS id, md5((to_jsonb(t)${exclude.map((c) => ` - '${c}'`).join('')})::text) AS h FROM ${table} t ORDER BY 1`,
    );

  describe('MUT-742 issuing jurisdiction migration', () => {
    it('changes no existing document, issuer or customer row; old documents read back IL and 1.0.0', async () => {
      const { dbUrl, db, firmId } = await scratchBefore();
      const before = {
        docs: await fingerprint(db, 'issued_documents', []),
        issuer: await fingerprint(db, 'issuer_details', []),
        customers: await fingerprint(db, 'customers', []),
      };
      expect(before.docs).toHaveLength(2);

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT742)}\n;\nCOMMIT;`);

      expect(await fingerprint(db, 'issued_documents', ['jurisdiction', 'jurisdictionPackVersion'])).toEqual(before.docs);
      expect(await fingerprint(db, 'issuer_details', ['vatIdScheme'])).toEqual(before.issuer);
      expect(await fingerprint(db, 'customers', [])).toEqual(before.customers);

      const docs = await db.$queryRawUnsafe<Array<{ jurisdiction: string; jurisdictionPackVersion: string }>>(`SELECT jurisdiction, "jurisdictionPackVersion" FROM issued_documents`);
      expect(docs).toEqual([{ jurisdiction: 'IL', jurisdictionPackVersion: '1.0.0' }, { jurisdiction: 'IL', jurisdictionPackVersion: '1.0.0' }]);
      const issuer = await db.$queryRawUnsafe<Array<{ vatIdScheme: string }>>(`SELECT "vatIdScheme" FROM issuer_details WHERE "organizationId" = '${firmId}'`);
      expect(issuer).toEqual([{ vatIdScheme: 'IL_TAX_ID' }]);
    });

    it('widens the issuer and customer tax ID, and refuses a jurisdiction that is not two capital letters', async () => {
      const { dbUrl, db, firmId, customerId } = await scratchBefore();
      execute(dbUrl, `BEGIN;\n${sqlOf(MUT742)}\n;\nCOMMIT;`);
      const wide = 'SA-310122393500003-0000000000';
      await db.$executeRawUnsafe(`UPDATE issuer_details SET "vatId" = '${wide}' WHERE "organizationId" = '${firmId}'`);
      await db.$executeRawUnsafe(`UPDATE customers SET "taxId" = '${wide}' WHERE id = '${customerId}'`);
      expect(await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM issuer_details WHERE "vatId" = '${wide}'`)).toEqual([{ n: 1 }]);
      const insert = (jurisdiction: string) =>
        `INSERT INTO issued_documents (id, "organizationId", "docType", number, "documentDate", currency, "subtotalMinor", "discountMinor", "netMinor", "vatRateBasisPoints", "vatMinor", "grossMinor", "pricesIncludeVat", issuer, customer, language, style, ink, "coreVersion", "createdByUserId", "requestKey", jurisdiction, "jurisdictionPackVersion")
         VALUES ('${randomUUID()}', '${firmId}', 'RECEIPT', 99, '2026-11-03', 'ILS', 1, 0, 1, 0, 0, 1, false, '{}', '{}', 'he', 'PROFESSIONAL', 'BLACK', '1.0.0', '${randomUUID()}', 'k-x-${jurisdiction}', '${jurisdiction}', '1.0.0')`;
      expect(refused(dbUrl, insert('il'))).toMatch(/issued_documents_jurisdiction_code/);
      expect(refused(dbUrl, insert('ISR'))).not.toBe('');
      expect(refused(dbUrl, insert('SA'))).toBe('');
    });

    it('the INSERT-only triggers and the retention bypass still work on the changed table', async () => {
      const { dbUrl, db } = await scratchBefore();
      execute(dbUrl, `BEGIN;\n${sqlOf(MUT742)}\n;\nCOMMIT;`);
      expect(refused(dbUrl, `UPDATE issued_documents SET notes = 'x'`)).toMatch(/issued documents are immutable/);
      expect(refused(dbUrl, `UPDATE issued_documents SET jurisdiction = 'SA'`)).toMatch(/issued documents are immutable/);
      expect(refused(dbUrl, `DELETE FROM issued_documents`)).toMatch(/issued documents are immutable/);
      expect(refused(dbUrl, `TRUNCATE issued_documents`)).toMatch(/issued documents are immutable/);
      expect(await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM issued_documents`)).toEqual([{ n: 2 }]);
      // The MUT-644 sweep's way past them: one transaction with the bypass.
      execute(dbUrl, `BEGIN;\nSET LOCAL mutaba3a.issuing_bypass = 'on';\nDELETE FROM issued_documents;\nCOMMIT;`);
      expect(await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM issued_documents`)).toEqual([{ n: 0 }]);
    });
  });
}
