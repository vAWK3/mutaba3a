import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertFirmRow, insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-575 (plan test 15): `dismissedAt` on accountant grants. Additive: a database at MUT-559/560 keeps every grant,
 * each reading `dismissedAt = null` (shown, as before), and the schema matches after the remaining migrations.
 * Runs on a scratch database built from the migrations before it.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT575 = '20261107140000_mut575_client_books';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-575 grant dismissal migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-575 grant dismissal migration', () => {
    it('keeps every existing grant, each with dismissedAt null, and matches the schema', async () => {
      const name = `mut575_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      expect(dirs).toContain(MUT575);
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT575))));
      const firm = await insertFirmRow(db, 'A');
      const { userId } = await insertUserWithPersonalRow(db, []);
      const grant = (status: string, accountant: string | null) => {
        const id = randomUUID();
        return db
          .$executeRawUnsafe(
            `INSERT INTO accountant_grants (id, "organizationId", "inviteEmail", locale, "accountantUserId", status, "inviteExpiresAt", "acceptedAt", "revokedAt", "createdAt") VALUES ('${id}', '${firm.id}', 'acc-${id.slice(0, 6)}@books.ps', 'en', ${accountant ? `'${accountant}'` : 'NULL'}, '${status}', now(), ${accountant ? 'now()' : 'NULL'}, ${status === 'REVOKED' || status === 'LEFT' ? 'now()' : 'NULL'}, now())`,
          )
          .then(() => id);
      };
      const ids = [await grant('PENDING', null), await grant('REVOKED', userId), await grant('LEFT', userId)];

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT575)}\n;\nCOMMIT;`);

      const rows = await db.$queryRawUnsafe<Array<{ id: string; status: string; dismissedAt: Date | null }>>(`SELECT id, status::text, "dismissedAt" FROM accountant_grants ORDER BY "createdAt", id`);
      expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
      expect(rows.every((r) => r.dismissedAt === null)).toBe(true);

      const rest = dirs.slice(dirs.indexOf(MUT575) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
