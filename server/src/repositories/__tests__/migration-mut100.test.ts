import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';
import { insertFirmRow } from './fixtures/raw-rows.js';

/**
 * MUT-100 (eng review D3): the CONTINGENCY enum value arrives alone in one
 * migration, because Postgres refuses a new enum value inside the transaction
 * that added it; the terms, outcome columns and the CHECK that names it come
 * in the next one. Each file is applied as `prisma migrate deploy` would, one
 * transaction per file, on a scratch database built from the history before them.
 */
// One `prisma db execute` per migration after MUT-100 (40 by MUT-479): ~117 s alone at load 25 on 11 cores.
vi.setConfig({ testTimeout: 240_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const ENUM = '20261013090000_mut100_agreement_type_contingency';
const TERMS = '20261013090100_mut100_contingency_terms';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-100 contingency migrations (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-100 contingency migrations', () => {
    it('apply in order, one transaction each; the CHECK keeps a CONTINGENCY row honest; the result matches the schema', async () => {
      const name = `mut100_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      expect(dirs.indexOf(TERMS)).toBe(dirs.indexOf(ENUM) + 1);
      execute(dbUrl, dirs.slice(0, dirs.indexOf(ENUM)).map(sqlOf).join('\n;\n'));

      // An agreement written before the migrations keeps working after them.
      const store = PrismaLedgerStore.connect(dbUrl);
      const at = new Date('2026-10-13T08:00:00Z');
      // A raw row: today's client selects organization columns this older schema lacks (MUT-182).
      const org = await insertFirmRow(db);
      const customer = await store.customers.create({ organizationId: org.id, name: 'Haddad', email: null, phone: null, notes: null }, at);
      const project = await store.projects.create({ organizationId: org.id, customerId: customer.id, name: 'Lawsuit', currency: 'ILS', vatTreatment: null }, at);
      await store.disconnect();
      const insertAgreement = (type: string, extra = '', values = '') =>
        db.$executeRawUnsafe(
          `INSERT INTO agreements (id, "organizationId", "projectId", "customerId", type, currency, "pricingBasis", "vatTreatment", "vatRateBasisPoints", "amountMinor", "netMinor", "vatMinor", "grossMinor", "agreementDate"${extra}) VALUES ('${randomUUID()}', '${org.id}', '${project.id}', '${customer.id}', '${type}', 'ILS', 'VAT_EXCLUSIVE', 'EXEMPT', 0, 1000, 1000, 0, 1000, '2026-10-01'${values})`,
        );
      await insertAgreement('FIXED');

      // Each file applies alone, as its own transaction (the enum value is unusable inside the one that adds it).
      execute(dbUrl, `BEGIN;\n${sqlOf(ENUM)}\nCOMMIT;`);
      execute(dbUrl, `BEGIN;\n${sqlOf(TERMS)}\nCOMMIT;`);

      const rows = await db.$queryRawUnsafe<Array<{ type: string; commissionRateBasisPoints: number | null }>>(`SELECT type::text, "commissionRateBasisPoints" FROM agreements`);
      expect(rows).toEqual([{ type: 'FIXED', commissionRateBasisPoints: null }]);

      await expect(insertAgreement('CONTINGENCY')).rejects.toThrow(/agreements_contingency_terms_check/);
      await expect(insertAgreement('CONTINGENCY', ', "commissionRateBasisPoints", "upfrontTreatment"', ", 0, 'SEPARATE'")).rejects.toThrow(/agreements_contingency_terms_check/);
      await expect(insertAgreement('CONTINGENCY', ', "commissionRateBasisPoints", "upfrontTreatment"', ", 10001, 'SEPARATE'")).rejects.toThrow(/agreements_contingency_terms_check/);
      await expect(insertAgreement('CONTINGENCY', ', "commissionRateBasisPoints"', ', 2000')).rejects.toThrow(/agreements_contingency_terms_check/);
      // A NULL rate must not slip through: `NULL BETWEEN 1 AND 10000` is NULL, and a CHECK that evaluates to NULL passes.
      await expect(insertAgreement('CONTINGENCY', ', "upfrontTreatment"', ", 'SEPARATE'")).rejects.toThrow(/agreements_contingency_terms_check/);
      await insertAgreement('CONTINGENCY', ', "commissionRateBasisPoints", "upfrontTreatment"', ", 2000, 'CREDITED'");
      const commissions = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM installments WHERE "isCommission"`);
      expect(commissions[0]?.n).toBe(0n);

      // The rest of the history (MUT-107 onwards), one transaction per file as `prisma migrate deploy` applies it, ends at the schema.
      for (const dir of dirs.slice(dirs.indexOf(TERMS) + 1)) execute(dbUrl, `BEGIN;\n${sqlOf(dir)}\nCOMMIT;`);
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
