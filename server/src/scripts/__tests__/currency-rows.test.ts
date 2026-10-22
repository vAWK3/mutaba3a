import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * MUT-388: the release gate for removed currencies. It reads the currency columns
 * from the catalog and the supported list from money.ts, so these tests run it
 * against a real database built from the migrations.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = join(SERVER, 'scripts/currency-rows.sh');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const hasPsql = spawnSync('psql', ['--version']).status === 0;

const migrationSql = () =>
  readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((dir) => `BEGIN;\n${readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8')}\n;\nCOMMIT;`)
    .join('\n');

const at = new Date('2026-10-20T08:00:00Z');
const ids = {
  user: randomUUID(),
  test: randomUUID(), // the operator's test profile, in ILS
  testAed: randomUUID(), // a test profile whose own currency is AED
  customer: randomUUID(), // a real customer's profile
  testAedExpense: randomUUID(),
  testIlsExpense: randomUUID(),
  testBhdConversion: randomUUID(),
  customerSarExpense: randomUUID(),
};

interface Run { status: number | null; out: string; err: string }
function currencyRows(env: Record<string, string>, ...args: string[]): Run {
  const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: tmpdir(), ...env }, input: '' });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

if (!url || !hasPsql) {
  describe.skip('currency-rows.sh (set MUTABA3A_TEST_DATABASE_URL and install psql to run)', () => {
    it('skipped', () => {});
  });
} else {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  const name = `mut388_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const dbUrl = (() => {
    const u = new URL(url);
    u.pathname = `/${name}`;
    u.search = '';
    return u.toString();
  })();
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const env = { DATABASE_URL: dbUrl };

  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: migrationSql(), cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
    await db.user.create({ data: { id: ids.user, email: `op-${ids.user.slice(0, 8)}@example.test`, displayName: 'Operator', locale: 'en', passwordChangedAt: at, createdAt: at, updatedAt: at } });
    const org = (id: string, defaultCurrency: string) =>
      db.organization.create({ data: { id, name: `Org ${id.slice(0, 4)}`, slug: `org-${id}`, defaultCurrency, timezone: 'Asia/Jerusalem' } });
    await org(ids.test, 'ILS');
    await org(ids.testAed, 'AED');
    await org(ids.customer, 'ILS');
  });

  afterAll(async () => {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  });

  const expense = (id: string, organizationId: string, currency: string, amountMinor: bigint) =>
    db.expense.create({ data: { id, organizationId, occurredOn: '2026-10-20', amountMinor, currency, createdByUserId: ids.user, createdAt: at, updatedAt: at } });

  describe('currency-rows.sh', () => {
    it('finds nothing in a database whose rows are all in supported currencies, apart from a profile default', async () => {
      await db.organization.update({ where: { id: ids.testAed }, data: { defaultCurrency: 'ILS' } });
      await expense(ids.testIlsExpense, ids.test, 'ILS', 5_000n);
      const r = currencyRows(env, 'count');
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('no rows outside ILS,USD,EUR,JOD');
      await db.organization.update({ where: { id: ids.testAed }, data: { defaultCurrency: 'AED' } });
    });

    it('lists every row in a removed currency by table, column, code and profile, and exits 3', async () => {
      await expense(ids.testAedExpense, ids.test, 'AED', 12_550n);
      await expense(ids.customerSarExpense, ids.customer, 'SAR', 9_000n);
      await db.conversion.create({
        data: { id: ids.testBhdConversion, organizationId: ids.test, occurredOn: '2026-10-20', amountMinor: 10_000n, currency: 'USD', toAmountMinor: 3_760n, toCurrency: 'BHD', createdByUserId: ids.user, createdAt: at, updatedAt: at },
      });
      const r = currencyRows(env, 'count');
      expect(r.status).toBe(3);
      expect(r.out).toContain(`conversions\ttoCurrency\tBHD\t${ids.test}\t1`);
      expect(r.out).toContain(`expenses\tcurrency\tAED\t${ids.test}\t1`);
      expect(r.out).toContain(`expenses\tcurrency\tSAR\t${ids.customer}\t1`);
      expect(r.out).toContain(`organizations\tdefaultCurrency\tAED\t${ids.testAed}\t1`);
      expect(r.out).not.toContain('ILS');
    });

    it('a dry run of delete-test-profiles changes nothing', async () => {
      const r = currencyRows(env, 'delete-test-profiles', '--organization-id', `${ids.test},${ids.testAed}`, '--dry-run');
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('rolled back');
      expect(await db.expense.count()).toBe(3);
      expect(await db.conversion.count()).toBe(1);
    });

    it('deletes only the removed-currency rows on the named profiles, and leaves a profile default for the portal', async () => {
      const r = currencyRows(env, 'delete-test-profiles', '--organization-id', ids.test, '--organization-id', ids.testAed, '--yes');
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('expenses: 1 deleted');
      expect(r.out).toContain('conversions: 1 deleted');
      expect(r.err).toContain(ids.testAed);
      expect((await db.expense.findMany({ orderBy: { id: 'asc' }, select: { id: true } })).map((e) => e.id).sort()).toEqual([ids.testIlsExpense, ids.customerSarExpense].sort());
      expect(await db.conversion.count()).toBe(0);
      expect(await db.organization.findUnique({ where: { id: ids.testAed }, select: { defaultCurrency: true } })).toEqual({ defaultCurrency: 'AED' });
      const after = currencyRows(env, 'count');
      expect(after.status).toBe(3);
      expect(after.out).toContain(`expenses\tcurrency\tSAR\t${ids.customer}\t1`);
      expect(after.out).not.toContain(`\t${ids.test}\t`);
    });

    it('refuses a profile id that is not a uuid', () => {
      const r = currencyRows(env, 'delete-test-profiles', '--organization-id', "x' OR true --", '--yes');
      expect(r.status).not.toBe(0);
      expect(r.err).toContain('not a profile id');
    });
  });
}
