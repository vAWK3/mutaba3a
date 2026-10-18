import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * MUT-267 (ADR-094): expense_groups and expense_group_overrides are purely
 * additive. Built from empty on a scratch database, the history ends at the
 * schema, and the mode CHECK refuses anything but the two marks.
 */
vi.setConfig({ testTimeout: 60_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-267 expense groups migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-267 expense groups migration', () => {
    it('builds from empty to the schema, and the mark CHECK accepts only excluded and included', async () => {
      const name = `mut267_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      execute(dbUrl, inTransactions(migrationDirs()));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });

      const orgId = randomUUID();
      const userId = randomUUID();
      const groupId = randomUUID();
      const expenseId = randomUUID();
      const at = '2026-10-18T10:00:00Z';
      await db.$executeRawUnsafe(`INSERT INTO organizations (id, name, slug, "defaultCurrency", timezone, "updatedAt") VALUES ('${orgId}', 'Firm', 'firm-${orgId.slice(0, 8)}', 'ILS', 'Asia/Jerusalem', '${at}')`);
      await db.$executeRawUnsafe(`INSERT INTO users (id, email, "displayName", "passwordHash", locale, "passwordChangedAt", "createdAt", "updatedAt") VALUES ('${userId}', 'n-${userId.slice(0, 8)}@firm.ps', 'Nour', 'x', 'en', '${at}', '${at}', '${at}')`);
      await db.$executeRawUnsafe(`INSERT INTO expenses (id, "organizationId", "occurredOn", "amountMinor", currency, "createdByUserId", "createdAt", "updatedAt") VALUES ('${expenseId}', '${orgId}', '2026-10-05', 1000, 'JOD', '${userId}', '${at}', '${at}')`);
      await db.$executeRawUnsafe(`INSERT INTO expense_groups (id, "organizationId", name, "startOn", "endOn", "createdByUserId", "createdAt", "updatedAt") VALUES ('${groupId}', '${orgId}', 'Jordan trip', '2026-10-03', NULL, '${userId}', '${at}', '${at}')`);
      const mark = (mode: string) =>
        db.$executeRawUnsafe(`INSERT INTO expense_group_overrides ("groupId", "expenseId", "organizationId", mode, "createdAt", "updatedAt") VALUES ('${groupId}', '${expenseId}', '${orgId}', '${mode}', '${at}', '${at}') ON CONFLICT ("groupId", "expenseId") DO UPDATE SET mode = EXCLUDED.mode`);
      await mark('excluded');
      await mark('included');
      await expect(mark('maybe')).rejects.toThrow(/expense_group_overrides_mode_check/);
    });
  });
}
