import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertFirmRow, insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-182: organizations gain an owner, a profile type and a version. Every
 * MUT-120 personal profile that exists before the migration must come out
 * owned by its user and PERSONAL; operator firms stay unowned and untyped.
 * The two CHECKs then hold every later write to that shape. Runs on a scratch
 * database built from the migrations before it (eng review M1, automated).
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT182 = '20261014120000_mut182_owned_profiles';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');

/** Each migration file in its own transaction, the way `prisma migrate deploy` applies them, as one script. */
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-182 owned profiles migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-182 owned profiles migration', () => {
    it('makes every personal profile owned and PERSONAL, leaves firms alone, enforces the shape and matches the schema', async () => {
      const name = `mut182_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      // One transaction per file, as `prisma migrate deploy` applies them (MUT-100 adds an enum value its next file
      // uses), but one `prisma db execute` process for the lot: a process per file took over a minute under load.
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT182))));
      const firm = await insertFirmRow(db);
      const nour = await insertUserWithPersonalRow(db, [firm.id]);
      const rana = await insertUserWithPersonalRow(db, []);

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT182)}\n;\nCOMMIT;`);

      const rows = await db.$queryRawUnsafe<Array<{ id: string; ownerUserId: string | null; profileType: string | null; version: number }>>(
        `SELECT id::text, "ownerUserId"::text, "profileType"::text, version FROM organizations`,
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[nour.personalId]).toEqual({ id: nour.personalId, ownerUserId: nour.userId, profileType: 'PERSONAL', version: 1 });
      expect(byId[rana.personalId]).toEqual({ id: rana.personalId, ownerUserId: rana.userId, profileType: 'PERSONAL', version: 1 });
      expect(byId[firm.id]).toEqual({ id: firm.id, ownerUserId: null, profileType: null, version: 1 });

      // The old revision still serves after this migration (roll window, rollback) and writes personal profiles
      // without the new columns: the CHECKs let that through on purpose, for post-roll to stamp (qa-reconcile D1).
      const legacy = await insertUserWithPersonalRow(db, []);
      const [legacyRow] = await db.$queryRawUnsafe<Array<{ ownerUserId: string | null; profileType: string | null }>>(
        `SELECT "ownerUserId"::text, "profileType"::text FROM organizations WHERE id = '${legacy.personalId}'`,
      );
      expect(legacyRow).toEqual({ ownerUserId: null, profileType: null });

      // The built-in personal profile can never become BUSINESS (D2), and owner and type travel together.
      await expect(db.$executeRawUnsafe(`UPDATE organizations SET "profileType" = 'BUSINESS' WHERE id = '${nour.personalId}'`)).rejects.toThrow(/organizations_personal_owned_check/);
      await expect(db.$executeRawUnsafe(`UPDATE organizations SET "ownerUserId" = '${nour.userId}' WHERE id = '${firm.id}'`)).rejects.toThrow(/organizations_owner_type_check/);

      const rest = dirs.slice(dirs.indexOf(MUT182) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
