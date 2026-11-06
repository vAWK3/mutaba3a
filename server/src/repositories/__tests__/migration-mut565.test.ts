import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertFirmRow, insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-565 (ADR-251, plan tests 8–9): the ACCOUNTANT billing tier and its grant CHECK. Additive: a database at MUT-575
 * keeps every grant; afterwards an ACCOUNTANT grant on a person inserts, one on an organization is refused by the
 * CHECK (a raw insert, past the 422 the operator action gives), and the schema matches. Each migration runs in its own
 * transaction, as `prisma migrate deploy` does (Postgres refuses a new enum value in the transaction that adds it).
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const TIER = '20261108120000_mut565_accountant_tier';
const CHECK = '20261108120100_mut565_accountant_grant_check';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-565 accountant tier migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-565 accountant tier migration', () => {
    it('keeps every grant, admits an ACCOUNTANT grant on a person, refuses one on an organization, and matches the schema', async () => {
      const name = `mut565_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      expect(dirs).toEqual(expect.arrayContaining([TIER, CHECK]));
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(TIER))));
      const firm = await insertFirmRow(db, 'A');
      const { userId } = await insertUserWithPersonalRow(db, []);
      const grant = (tier: string, target: { userId?: string; organizationId?: string }) =>
        db.$executeRawUnsafe(
          `INSERT INTO entitlement_grants (id, "userId", "organizationId", tier, reason, "grantedBy") VALUES ('${randomUUID()}', ${target.userId ? `'${target.userId}'` : 'NULL'}, ${target.organizationId ? `'${target.organizationId}'` : 'NULL'}, '${tier}', 'test', 'admin')`,
        );
      await grant('FREELANCER', { userId });
      await grant('FIRM', { organizationId: firm.id });

      execute(dbUrl, inTransactions([TIER, CHECK]));

      const rows = await db.$queryRawUnsafe<Array<{ tier: string }>>(`SELECT tier::text FROM entitlement_grants ORDER BY tier::text`);
      expect(rows.map((r) => r.tier)).toEqual(['FIRM', 'FREELANCER']);
      await grant('ACCOUNTANT', { userId });
      await expect(grant('ACCOUNTANT', { organizationId: firm.id })).rejects.toThrow(/entitlement_grants_accountant_person_check/);

      const rest = dirs.slice(dirs.indexOf(CHECK) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
