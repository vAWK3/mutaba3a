import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertFirmRow, insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-300: the firm switch columns. Every membership that exists before the
 * migration comes out OWNER (inert until firm features are on, O10) and
 * every organization with firm features off and nothing requested. The two
 * CHECKs then hold every later write: a request names its requester, and the
 * built-in personal profile never gets firm features, while an owned
 * Business profile can (D4). Runs on a scratch database built from the
 * migrations before it.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT300 = '20261020090000_mut300_firm_flag';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-300 firm flag migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-300 firm flag migration', () => {
    it('backfills OWNER roles and firm-off organizations, enforces the CHECKs and matches the schema', async () => {
      const name = `mut300_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT300))));
      const firm = await insertFirmRow(db);
      const nour = await insertUserWithPersonalRow(db, [firm.id]);
      const business = randomUUID();
      await db.$executeRawUnsafe(
        `INSERT INTO organizations (id, name, slug, "defaultCurrency", timezone, "updatedAt", "ownerUserId", "profileType") VALUES ('${business}', 'Studio', 'studio-${business.slice(0, 8)}', 'ILS', 'Asia/Jerusalem', now(), '${nour.userId}', 'BUSINESS')`,
      );

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT300)}\n;\nCOMMIT;`);

      const roles = await db.$queryRawUnsafe<Array<{ role: string }>>(`SELECT role::text FROM memberships WHERE "userId" = '${nour.userId}'`);
      expect(roles.map((r) => r.role)).toEqual(['OWNER', 'OWNER']);
      const orgs = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM organizations WHERE "firmEnabledAt" IS NOT NULL OR "firmRequestedAt" IS NOT NULL OR "firmRequestedByUserId" IS NOT NULL`,
      );
      expect(Number(orgs[0]!.n)).toBe(0);

      // A request names its requester, and only a request does.
      await expect(db.$executeRawUnsafe(`UPDATE organizations SET "firmRequestedAt" = now() WHERE id = '${business}'`)).rejects.toThrow(/organizations_firm_request_pair_check/);
      await expect(db.$executeRawUnsafe(`UPDATE organizations SET "firmRequestedByUserId" = '${nour.userId}' WHERE id = '${business}'`)).rejects.toThrow(/organizations_firm_request_pair_check/);
      await db.$executeRawUnsafe(`UPDATE organizations SET "firmRequestedAt" = now(), "firmRequestedByUserId" = '${nour.userId}' WHERE id = '${business}'`);

      // The built-in personal profile never gets firm features; an owned Business profile and an operator firm can (D4).
      await expect(db.$executeRawUnsafe(`UPDATE organizations SET "firmEnabledAt" = now() WHERE id = '${nour.personalId}'`)).rejects.toThrow(/organizations_firm_not_personal_check/);
      await db.$executeRawUnsafe(`UPDATE organizations SET "firmEnabledAt" = now() WHERE id IN ('${business}', '${firm.id}')`);

      // Users are never hard-deleted while they have a request on file (RESTRICT, O8).
      await expect(db.$executeRawUnsafe(`DELETE FROM users WHERE id = '${nour.userId}'`)).rejects.toThrow();

      const rest = dirs.slice(dirs.indexOf(MUT300) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
