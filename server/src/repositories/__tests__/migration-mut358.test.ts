import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertFirmRow, insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-358 (ADR-160, P1): the billing tables and the pre-billing backfill. Everyone who exists when the migration runs
 * gets an OPERATOR grant on their own profiles, and every operator firm one on itself, so MUT-361's lapse gate can't
 * turn them read-only. Owned profiles get none of their own: their owner's grant covers them. A grant names exactly
 * one target. Runs on a scratch database built from the migrations before it.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT358 = '20261020200000_mut358_billing_core';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-358 billing core migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-358 billing core migration', () => {
    it('grants everyone who exists and every operator firm, enforces one target per grant and matches the schema', async () => {
      const name = `mut358_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT358))));
      const firm = await insertFirmRow(db);
      const nour = await insertUserWithPersonalRow(db, [firm.id]);
      const business = randomUUID();
      await db.$executeRawUnsafe(
        `INSERT INTO organizations (id, name, slug, "defaultCurrency", timezone, "updatedAt", "ownerUserId", "profileType") VALUES ('${business}', 'Studio', 'studio-${business.slice(0, 8)}', 'ILS', 'Asia/Jerusalem', now(), '${nour.userId}', 'BUSINESS')`,
      );

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT358)}\n;\nCOMMIT;`);

      const grants = await db.$queryRawUnsafe<Array<{ userId: string | null; organizationId: string | null; tier: string; reason: string; grantedBy: string; expiresAt: Date | null }>>(
        `SELECT "userId", "organizationId", tier::text, reason, "grantedBy", "expiresAt" FROM entitlement_grants ORDER BY "userId" NULLS LAST`,
      );
      expect(grants).toEqual([
        { userId: nour.userId, organizationId: null, tier: 'FREELANCER', reason: 'pre-billing', grantedBy: 'migration:mut358', expiresAt: null },
        { userId: null, organizationId: firm.id, tier: 'FIRM', reason: 'pre-billing', grantedBy: 'migration:mut358', expiresAt: null },
      ]);
      const trials = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM users WHERE "trialStartedAt" IS NOT NULL`);
      expect(Number(trials[0]!.n)).toBe(0);

      // A grant covers a person's own profiles or one profile, never both and never neither.
      await expect(db.$executeRawUnsafe(`INSERT INTO entitlement_grants (id, tier, reason, "grantedBy") VALUES (gen_random_uuid(), 'FIRM', 'x', 'test')`)).rejects.toThrow(/entitlement_grants_one_target_check/);
      await expect(
        db.$executeRawUnsafe(`INSERT INTO entitlement_grants (id, "userId", "organizationId", tier, reason, "grantedBy") VALUES (gen_random_uuid(), '${nour.userId}', '${business}', 'FIRM', 'x', 'test')`),
      ).rejects.toThrow(/entitlement_grants_one_target_check/);

      const rest = dirs.slice(dirs.indexOf(MUT358) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
