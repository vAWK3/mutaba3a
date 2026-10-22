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
// macOS runs operator scripts with /bin/bash 3.2; test that one, not a newer bash earlier on PATH.
const BASH = process.platform === 'darwin' ? '/bin/bash' : 'bash';

const migrationSql = () =>
  readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((dir) => `BEGIN;\n${readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8')}\n;\nCOMMIT;`)
    .join('\n');

const at = new Date('2026-10-20T08:00:00Z');
const ids = {
  user: randomUUID(), // the operator
  customerUser: randomUUID(),
  test: randomUUID(), // the operator's test profile, in ILS
  testAed: randomUUID(), // a test profile whose own currency is AED
  customer: randomUUID(), // a real customer's profile
  testIlsExpense: randomUUID(),
  testAedExpense: randomUUID(), // has a receipt: a hard delete would fail on it
  testBhdConversion: randomUUID(),
  testDeletedExpense: randomUUID(), // already soft-deleted: never counted
  customerSarExpense: randomUUID(),
  client: randomUUID(),
  receipt: randomUUID(),
  testInbox: randomUUID(),
  customerInbox: randomUUID(),
};

interface Run { status: number | null; out: string; err: string }
function currencyRows(env: Record<string, string>, ...args: string[]): Run {
  const r = spawnSync(BASH, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: tmpdir(), ...env }, input: '' });
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
    for (const [id, who] of [[ids.user, 'op'], [ids.customerUser, 'customer']] as const) {
      await db.user.create({ data: { id, email: `${who}-${id.slice(0, 8)}@example.test`, displayName: who, locale: 'en', passwordChangedAt: at, createdAt: at, updatedAt: at } });
    }
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

  const expense = (id: string, organizationId: string, currency: string, amountMinor: bigint, extra: Record<string, unknown> = {}) =>
    db.expense.create({ data: { id, organizationId, occurredOn: '2026-10-20', amountMinor, currency, createdByUserId: ids.user, createdAt: at, updatedAt: at, ...extra } });
  const inbox = (id: string, userId: string, currency: string) =>
    db.inboxEntry.create({ data: { id, userId, kind: 'EXPENSE', amountMinor: 1_000n, currency, occurredOn: '2026-10-20', createdAt: at, updatedAt: at } });

  describe('currency-rows.sh', () => {
    it('finds nothing in a database whose live rows are all in supported currencies, apart from a profile default', async () => {
      await db.organization.update({ where: { id: ids.testAed }, data: { defaultCurrency: 'ILS' } });
      await expense(ids.testIlsExpense, ids.test, 'ILS', 5_000n);
      await expense(ids.testDeletedExpense, ids.test, 'QAR', 7_000n, { deletedAt: at });
      const r = currencyRows(env, 'count');
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('no rows outside ILS,USD,EUR,JOD');
      await db.organization.update({ where: { id: ids.testAed }, data: { defaultCurrency: 'AED' } });
    });

    it('lists every live row in a removed currency by table, column, code and owner (a user for the inbox), and exits 3', async () => {
      await expense(ids.testAedExpense, ids.test, 'AED', 12_550n);
      await db.expenseReceipt.create({
        data: { id: ids.receipt, organizationId: ids.test, expenseId: ids.testAedExpense, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, status: 'READY', storageKey: `org/${ids.test}/expense-receipts/${ids.receipt}`, uploadedByUserId: ids.user, createdAt: at, completedAt: at },
      });
      await expense(ids.customerSarExpense, ids.customer, 'SAR', 9_000n);
      await db.conversion.create({
        data: { id: ids.testBhdConversion, organizationId: ids.test, occurredOn: '2026-10-20', amountMinor: 10_000n, currency: 'USD', toAmountMinor: 3_760n, toCurrency: 'BHD', createdByUserId: ids.user, createdAt: at, updatedAt: at },
      });
      await inbox(ids.testInbox, ids.user, 'OMR');
      await inbox(ids.customerInbox, ids.customerUser, 'AED');
      const r = currencyRows(env, 'count');
      expect(r.status).toBe(3);
      expect(r.out).toContain(`conversions\ttoCurrency\tBHD\t${ids.test}\t1`);
      expect(r.out).toContain(`expenses\tcurrency\tAED\t${ids.test}\t1`);
      expect(r.out).toContain(`expenses\tcurrency\tSAR\t${ids.customer}\t1`);
      expect(r.out).toContain(`inbox_entries\tcurrency\tOMR\tuser:${ids.user}\t1`);
      expect(r.out).toContain(`organizations\tdefaultCurrency\tAED\t${ids.testAed}\t1`);
      expect(r.out).not.toContain('QAR'); // soft-deleted
    });

    it('a dry run previews and changes nothing', async () => {
      const r = currencyRows(env, 'delete-test-profiles', '--organization-id', `${ids.test},${ids.testAed}`, '--user-id', ids.user, '--dry-run');
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('expenses: 1 soft-deleted');
      expect(r.out).toContain('rolled back');
      expect(await db.expense.count({ where: { deletedAt: null } })).toBe(3);
      expect(await db.inboxEntry.count()).toBe(2);
    });

    it('stops with nothing changed when a row it would hard-delete still has others pointing at it', async () => {
      const projectId = randomUUID();
      await db.customer.create({ data: { id: ids.client, organizationId: ids.test, name: 'Client' } });
      await db.project.create({ data: { id: projectId, organizationId: ids.test, customerId: ids.client, name: 'Dubai matter', currency: 'AED' } });
      await db.expense.update({ where: { id: ids.testIlsExpense }, data: { projectId } });
      const r = currencyRows(env, 'delete-test-profiles', '--organization-id', ids.test, '--yes');
      expect(r.status).not.toBe(0);
      expect(r.err).toContain('nothing changed');
      expect(r.err).toContain('projects: 1 row(s) in expenses.projectId point at them');
      expect(await db.expense.count({ where: { deletedAt: null } })).toBe(3);
      await db.expense.update({ where: { id: ids.testIlsExpense }, data: { projectId: null } });
    });

    it('soft-deletes the named profiles\' rows (a receipt stays valid), hard-deletes the rest and the named user\'s inbox, and leaves everyone else', async () => {
      const r = currencyRows(env, 'delete-test-profiles', '--organization-id', ids.test, '--organization-id', ids.testAed, '--user-id', ids.user, '--yes');
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('committed');
      expect(r.out).toContain('projects: 1 deleted');
      expect(r.err).toContain(ids.testAed); // its own default currency: left for the portal
      expect(await db.expense.findUnique({ where: { id: ids.testAedExpense }, select: { deletedAt: true } })).toEqual({ deletedAt: expect.any(Date) });
      expect(await db.expenseReceipt.count({ where: { id: ids.receipt } })).toBe(1);
      expect(await db.conversion.findUnique({ where: { id: ids.testBhdConversion }, select: { deletedAt: true } })).toEqual({ deletedAt: expect.any(Date) });
      expect(await db.project.count({ where: { organizationId: ids.test } })).toBe(0);
      expect(await db.expense.findUnique({ where: { id: ids.testIlsExpense }, select: { deletedAt: true } })).toEqual({ deletedAt: null });
      expect((await db.inboxEntry.findMany({ select: { id: true } })).map((e) => e.id)).toEqual([ids.customerInbox]);
      const after = currencyRows(env, 'count');
      expect(after.status).toBe(3);
      expect(after.out).toContain(`expenses\tcurrency\tSAR\t${ids.customer}\t1`);
      expect(after.out).toContain(`user:${ids.customerUser}`);
      expect(after.out).not.toContain(`\t${ids.test}\t`);
      expect(after.out).not.toContain(`user:${ids.user}`);
    });

    it('refuses an id that is not a uuid, or not a profile here', () => {
      const bad = currencyRows(env, 'delete-test-profiles', '--organization-id', "x' OR true --", '--yes');
      expect(bad.status).not.toBe(0);
      expect(bad.err).toContain('not an id');
      const unknown = currencyRows(env, 'delete-test-profiles', '--organization-id', randomUUID(), '--yes');
      expect(unknown.status).not.toBe(0);
      expect(unknown.err).toContain('not every --organization-id is a profile here');
    });
  });
}
