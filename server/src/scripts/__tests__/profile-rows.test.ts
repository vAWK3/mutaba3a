import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * MUT-327: the operator's by-hand tools for one profile — export it, put it
 * back from a restored copy, and purge a closed account (until MUT-333). They
 * read the schema from the catalog, so these tests run them against two real
 * databases built from the migrations: "live" and "backup" (the restored copy).
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = join(SERVER, 'scripts/profile-rows.sh');
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

const at = new Date('2026-10-01T08:00:00Z');
const ids = {
  owner: randomUUID(),
  other: randomUUID(),
  personal: randomUUID(),
  business: randomUUID(),
  otherPersonal: randomUUID(),
  firm: randomUUID(),
  customer: randomUUID(),
  category: randomUUID(),
  expense: randomUUID(),
  receipt: randomUUID(),
  otherCustomer: randomUUID(),
  auditCreated: randomUUID(),
  auditTerms: randomUUID(),
};

/** The same rows in both databases: what the nightly backup caught. */
async function seed(db: PrismaClient): Promise<void> {
  const tag = ids.owner.slice(0, 8);
  await db.user.create({ data: { id: ids.owner, email: `owner-${tag}@example.test`, displayName: 'Owner', locale: 'en', passwordChangedAt: at, createdAt: at, updatedAt: at } });
  await db.user.create({ data: { id: ids.other, email: `other-${tag}@example.test`, displayName: 'Other', locale: 'en', passwordChangedAt: at, createdAt: at, updatedAt: at } });
  const org = (id: string, extra: Record<string, unknown>) =>
    db.organization.create({ data: { id, name: `Org ${id.slice(0, 4)}`, slug: `org-${id}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', ...extra } });
  await org(ids.personal, { personalOwnerUserId: ids.owner, ownerUserId: ids.owner, profileType: 'PERSONAL' });
  await org(ids.business, { ownerUserId: ids.owner, profileType: 'BUSINESS' });
  await org(ids.otherPersonal, { personalOwnerUserId: ids.other, ownerUserId: ids.other, profileType: 'PERSONAL' });
  await org(ids.firm, {});
  for (const organizationId of [ids.personal, ids.business]) await db.membership.create({ data: { userId: ids.owner, organizationId, createdAt: at } });
  await db.membership.create({ data: { userId: ids.other, organizationId: ids.otherPersonal, createdAt: at } });
  await db.customer.create({ data: { id: ids.customer, organizationId: ids.business, name: 'Client A' } });
  await db.customer.create({ data: { id: ids.otherCustomer, organizationId: ids.otherPersonal, name: 'Other client' } });
  await db.expenseCategory.create({ data: { id: ids.category, organizationId: ids.business, name: 'Rent', nameKey: 'rent', createdAt: at, updatedAt: at } });
  await db.expense.create({
    data: { id: ids.expense, organizationId: ids.business, occurredOn: '2026-09-30', amountMinor: 12_500n, currency: 'ILS', title: 'Office', categoryId: ids.category, customerId: ids.customer, createdByUserId: ids.owner, createdAt: at, updatedAt: at },
  });
  await db.expenseReceipt.create({
    data: { id: ids.receipt, organizationId: ids.business, expenseId: ids.expense, filename: 'office, rent.pdf', mimeType: 'application/pdf', sizeBytes: 1234, status: 'READY', storageKey: `org/${ids.business}/expense-receipts/${ids.receipt}`, uploadedByUserId: ids.owner, createdAt: at, completedAt: at },
  });
  await db.auditEvent.create({ data: { id: ids.auditCreated, organizationId: ids.business, actorType: 'USER', actorId: ids.owner, action: 'expense.created', entityType: 'expense', entityId: ids.expense, createdAt: at } });
  await db.auditEvent.create({ data: { id: ids.auditTerms, organizationId: ids.business, actorType: 'USER', actorId: ids.owner, action: 'user.terms_accepted', entityType: 'user', entityId: ids.owner, createdAt: at } });
  await db.termsAcceptance.create({ data: { userId: ids.owner, version: '2026-10-19', locale: 'en', textSha256: 'a'.repeat(64), surface: 'portal', acceptedAt: at } });
}

interface Run { status: number | null; out: string; err: string }
function profileRows(env: Record<string, string>, ...args: string[]): Run {
  const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: tmpdir(), ...env }, input: '' });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

if (!url || !hasPsql) {
  describe.skip('profile-rows.sh (set MUTABA3A_TEST_DATABASE_URL and install psql to run)', () => {
    it('skipped', () => {});
  });
} else {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  const created: string[] = [];
  const clients: PrismaClient[] = [];
  const dbUrl = (name: string) => {
    const u = new URL(url);
    u.pathname = `/${name}`;
    u.search = '';
    return u.toString();
  };
  async function scratch(label: string): Promise<{ url: string; db: PrismaClient }> {
    const name = `mut327_${label}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created.push(name);
    execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl(name)], { input: migrationSql(), cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
    const db = new PrismaClient({ datasources: { db: { url: dbUrl(name) } } });
    clients.push(db);
    return { url: dbUrl(name), db };
  }

  let live: { url: string; db: PrismaClient };
  let backup: { url: string; db: PrismaClient };
  const work = mkdtempSync(join(tmpdir(), 'profile-rows-'));

  beforeAll(async () => {
    [live, backup] = await Promise.all([scratch('live'), scratch('backup')]);
    await Promise.all([seed(live.db), seed(backup.db)]);
  });

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await Promise.all(clients.map((c) => c.$disconnect()));
    for (const name of created) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  });

  const snapshot = async (db: PrismaClient) => ({
    customers: await db.customer.findMany({ orderBy: { id: 'asc' }, select: { id: true, organizationId: true, name: true } }),
    expenses: await db.expense.findMany({ orderBy: { id: 'asc' }, select: { id: true, organizationId: true, title: true, amountMinor: true, deletedAt: true } }),
    receipts: await db.expenseReceipt.findMany({ orderBy: { id: 'asc' }, select: { id: true, filename: true, storageKey: true } }),
    memberships: await db.membership.findMany({ orderBy: [{ userId: 'asc' }, { organizationId: 'asc' }], select: { userId: true, organizationId: true } }),
    audit: await db.auditEvent.count(),
  });

  describe('profile-rows.sh export', () => {
    it('writes one CSV per profile table, the organization row and the receipt copy lines, and no API keys', () => {
      const out = join(work, 'export');
      const r = profileRows({ DATABASE_URL: live.url }, 'export', '--organization-id', ids.business, '--out', out, '--bucket', 'demo-bucket');
      expect(r.status, r.err).toBe(0);
      const files = readdirSync(out);
      expect(files).toEqual(expect.arrayContaining(['organizations.csv', 'customers.csv', 'expenses.csv', 'expense_receipts.csv', 'audit_events.csv', 'receipts.txt']));
      expect(files).not.toContain('api_keys.csv');
      // MUT-358: billing follows Stripe and the operator; it is not the person's records.
      expect(files).not.toContain('entitlement_grants.csv');
      expect(files).not.toContain('billing_subscriptions.csv');
      expect(files).not.toContain('idempotency_keys.csv');
      expect(readFileSync(join(out, 'customers.csv'), 'utf8')).toContain('Client A');
      expect(readFileSync(join(out, 'customers.csv'), 'utf8')).not.toContain('Other client');
      expect(readFileSync(join(out, 'receipts.txt'), 'utf8')).toContain(`gcloud storage cp 'gs://demo-bucket/org/${ids.business}/expense-receipts/${ids.receipt}' 'receipts/${ids.receipt}-office, rent.pdf'`);
    });
  });

  describe('profile-rows.sh restore', () => {
    it('refuses when the source and the target are the same database', () => {
      const r = profileRows({ DATABASE_URL: live.url, SOURCE_DATABASE_URL: live.url }, 'restore', '--organization-id', ids.business, '--yes');
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/same database/i);
    });

    it('refuses when the two schemas differ', async () => {
      await backup.db.$executeRawUnsafe('ALTER TABLE customers ADD COLUMN drill_extra int');
      try {
        const r = profileRows({ DATABASE_URL: live.url, SOURCE_DATABASE_URL: backup.url }, 'restore', '--organization-id', ids.business, '--yes');
        expect(r.status).not.toBe(0);
        expect(r.err).toMatch(/schema/i);
        expect(r.err).toContain('customers');
      } finally {
        await backup.db.$executeRawUnsafe('ALTER TABLE customers DROP COLUMN drill_extra');
      }
    });

    it('puts one profile back as the copy has it, leaves access, other profiles and the audit trail alone, and a dry run changes nothing', async () => {
      // What happened after the backup: a rename, a deleted expense with its receipt, a new customer,
      // a new membership, new audit rows, and a change to someone else's profile.
      await live.db.customer.update({ where: { id: ids.customer }, data: { name: 'Renamed by mistake' } });
      await live.db.expenseReceipt.delete({ where: { id: ids.receipt } });
      await live.db.expense.delete({ where: { id: ids.expense } });
      const stray = await live.db.customer.create({ data: { organizationId: ids.business, name: 'Added after the backup' } });
      await live.db.membership.create({ data: { userId: ids.other, organizationId: ids.business, createdAt: at } });
      await live.db.auditEvent.create({ data: { organizationId: ids.business, actorType: 'USER', actorId: ids.owner, action: 'expense.deleted', entityType: 'expense', entityId: ids.expense } });
      await live.db.customer.update({ where: { id: ids.otherCustomer }, data: { name: 'Other client, renamed' } });
      // MUT-358: a grant made after the backup survives a restore; billing never rolls back.
      const grant = await live.db.entitlementGrant.create({ data: { organizationId: ids.business, tier: 'FIRM', reason: 'after the backup', grantedBy: 'test' } });

      const before = await snapshot(live.db);
      const env = { DATABASE_URL: live.url, SOURCE_DATABASE_URL: backup.url };
      const dry = profileRows(env, 'restore', '--organization-id', ids.business, '--dry-run');
      expect(dry.status, dry.err).toBe(0);
      expect(dry.out).toMatch(/rolled back/i);
      expect(await snapshot(live.db)).toEqual(before);

      const r = profileRows(env, 'restore', '--organization-id', ids.business, '--yes');
      expect(r.status, r.err).toBe(0);
      const after = await snapshot(live.db);
      const fromBackup = await snapshot(backup.db);
      const inBusiness = <T extends { organizationId: string }>(rows: T[]) => rows.filter((row) => row.organizationId === ids.business);
      expect(inBusiness(after.customers)).toEqual(inBusiness(fromBackup.customers));
      expect(after.customers.find((c) => c.id === stray.id)).toBeUndefined();
      expect(inBusiness(after.expenses)).toEqual(inBusiness(fromBackup.expenses));
      expect(after.receipts).toEqual(fromBackup.receipts);
      expect(after.customers.find((c) => c.id === ids.otherCustomer)?.name).toBe('Other client, renamed');
      expect(after.memberships).toEqual(before.memberships);
      expect(await live.db.entitlementGrant.findUnique({ where: { id: grant.id } })).not.toBeNull();
      expect(after.audit).toBe(before.audit + 1);
      const restored = await live.db.auditEvent.findFirst({ where: { organizationId: ids.business, action: 'organization.restored' } });
      expect(restored?.actorType).toBe('SYSTEM');
      expect(await live.db.auditEvent.count({ where: { action: 'expense.deleted' } })).toBe(1);
      expect(r.out).toContain(`org/${ids.business}/expense-receipts/${ids.receipt}`);

      // Clean up the membership added for this test, so purge-user below starts from the seed.
      await live.db.membership.delete({ where: { userId_organizationId: { userId: ids.other, organizationId: ids.business } } });
    });
  });

  describe('profile-rows.sh purge-user', () => {
    const env = () => ({ DATABASE_URL: live.url });

    it('refuses while the person is still a member of a profile they do not own', async () => {
      await live.db.membership.create({ data: { userId: ids.owner, organizationId: ids.firm, createdAt: at } });
      try {
        const r = profileRows(env(), 'purge-user', '--user-id', ids.owner, '--yes');
        expect(r.status).not.toBe(0);
        expect(r.err).toContain('memberships');
        expect(r.err).toContain('revoke:user');
      } finally {
        await live.db.membership.delete({ where: { userId_organizationId: { userId: ids.owner, organizationId: ids.firm } } });
      }
    });

    it('refuses while rows in someone else\'s profile still point at the person', async () => {
      const expense = await live.db.expense.create({
        data: { organizationId: ids.firm, occurredOn: '2026-09-30', amountMinor: 100n, currency: 'ILS', createdByUserId: ids.owner, createdAt: at, updatedAt: at },
      });
      try {
        const r = profileRows(env(), 'purge-user', '--user-id', ids.owner, '--yes');
        expect(r.status).not.toBe(0);
        expect(r.err).toContain('expenses.createdByUserId');
      } finally {
        await live.db.expense.delete({ where: { id: expense.id } });
      }
    });

    it('deletes the person, every profile they own and its rows, their terms rows everywhere, and nothing of anyone else', async () => {
      await live.db.auditEvent.create({ data: { organizationId: ids.firm, actorType: 'USER', actorId: ids.owner, action: 'user.terms_accepted', entityType: 'user', entityId: ids.owner } });
      const othersBefore = { customers: await live.db.customer.count({ where: { organizationId: ids.otherPersonal } }), firmAudit: await live.db.auditEvent.count({ where: { organizationId: ids.firm } }) };

      const dry = profileRows(env(), 'purge-user', '--user-id', ids.owner, '--dry-run', '--bucket', 'demo-bucket');
      expect(dry.status, dry.err).toBe(0);
      expect(await live.db.user.count({ where: { id: ids.owner } })).toBe(1);

      const r = profileRows(env(), 'purge-user', '--user-id', ids.owner, '--yes', '--bucket', 'demo-bucket');
      expect(r.status, r.err).toBe(0);
      expect(await live.db.user.count({ where: { id: ids.owner } })).toBe(0);
      expect(await live.db.organization.count({ where: { id: { in: [ids.personal, ids.business] } } })).toBe(0);
      for (const table of ['customers', 'expenses', 'expense_receipts', 'expense_categories', 'audit_events', 'memberships']) {
        const rows = await live.db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${table} WHERE "organizationId" IN ('${ids.personal}', '${ids.business}')`);
        expect(Number(rows[0]?.n), table).toBe(0);
      }
      expect(await live.db.termsAcceptance.count({ where: { userId: ids.owner } })).toBe(0);
      expect(await live.db.auditEvent.count({ where: { action: 'user.terms_accepted', actorId: ids.owner } })).toBe(0);
      expect(await live.db.auditEvent.count({ where: { organizationId: ids.firm } })).toBe(othersBefore.firmAudit - 1);
      expect(await live.db.customer.count({ where: { organizationId: ids.otherPersonal } })).toBe(othersBefore.customers);
      expect(await live.db.user.count({ where: { id: ids.other } })).toBe(1);
      expect(r.out).toContain(`gcloud storage rm --recursive 'gs://demo-bucket/org/${ids.business}/'`);
      expect(existsSync(SCRIPT)).toBe(true);
    });
  });
}
