import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * MUT-194 (ADR-075): conversions gain `version`, `updatedAt` and `deletedAt`.
 * A conversion logged before the migration must come out at version 1, with
 * updatedAt equal to its createdAt and not deleted. Runs on a scratch database
 * built from the migrations before it, like migration-mut61.test.ts.
 */
vi.setConfig({ testTimeout: 60_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT194 = '20261014180000_mut194_conversion_versions';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
// One BEGIN/COMMIT per file, as `prisma migrate deploy` applies them, in a single `prisma db execute` (as migration-mut182.test.ts).
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-194 conversion versions migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-194 conversion versions migration', () => {
    it('backfills version 1 and updatedAt = createdAt on existing rows, leaves them live, and matches the schema', async () => {
      const name = `mut194_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      // Not one plain batch: a later migration (MUT-100) uses an enum value an earlier one added, which Postgres refuses in one transaction.
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT194))));

      // Raw SQL throughout: today's client knows columns that later migrations add (conversions here, and MUT-191's
      // users.malafatSuggestions), and the pre-migration tables don't have them.
      const orgId = randomUUID();
      const userId = randomUUID();
      await db.$executeRawUnsafe(
        `INSERT INTO organizations (id, name, slug, "defaultCurrency", timezone, "updatedAt") VALUES ('${orgId}', 'Firm', 'firm-${orgId.slice(0, 8)}', 'ILS', 'Asia/Jerusalem', '2026-10-05T08:00:00Z')`,
      );
      await db.$executeRawUnsafe(
        `INSERT INTO users (id, email, "displayName", "passwordHash", locale, "passwordChangedAt", "createdAt", "updatedAt") VALUES ('${userId}', 'n-${userId.slice(0, 8)}@firm.ps', 'Nour', 'x', 'en', '2026-10-05T08:00:00Z', '2026-10-05T08:00:00Z', '2026-10-05T08:00:00Z')`,
      );
      const insert = async (createdAt: string) => {
        const id = randomUUID();
        await db.$executeRawUnsafe(
          `INSERT INTO conversions (id, "organizationId", "occurredOn", "amountMinor", currency, "toAmountMinor", "toCurrency", "createdByUserId", "createdAt") VALUES ('${id}', '${orgId}', '2026-10-05', 10000, 'USD', 36500, 'ILS', '${userId}', '${createdAt}')`,
        );
        return id;
      };
      const older = await insert('2026-10-05T08:00:00.000Z');
      const newer = await insert('2026-10-13T16:30:00.123Z');

      execute(dbUrl, inTransactions([MUT194]));

      const rows = await db.$queryRawUnsafe<Array<{ id: string; version: number; createdAt: Date; updatedAt: Date; deletedAt: Date | null }>>(
        `SELECT id::text, version, "createdAt", "updatedAt", "deletedAt" FROM conversions`,
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      for (const id of [older, newer]) {
        expect(byId[id]).toMatchObject({ version: 1, deletedAt: null });
        expect(byId[id]!.updatedAt.toISOString()).toBe(byId[id]!.createdAt.toISOString());
      }
      expect(byId[newer]!.updatedAt.toISOString()).toBe('2026-10-13T16:30:00.123Z');

      // The rest of the history, one transaction per file as `prisma migrate deploy` applies it, ends at the schema.
      const rest = dirs.slice(dirs.indexOf(MUT194) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
