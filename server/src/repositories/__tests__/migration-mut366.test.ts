import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-366 (ADR-175): SIGNUP links. The migration runs inside one transaction (as Prisma runs it) even though it adds
 * an enum value its CHECKs name (R1), keeps every existing link valid, and its CHECKs hold the shape: a SIGNUP link
 * has an address and a language and no user; every other link has a user and neither.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT366 = '20261023180000_mut366_signup_links';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-366 signup links migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-366 signup links migration', () => {
    it('applies in one transaction, keeps existing links, enforces the SIGNUP shape and matches the schema', async () => {
      const name = `mut366_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT366))));
      const nour = await insertUserWithPersonalRow(db, []);
      const existing = randomUUID();
      await db.$executeRawUnsafe(
        `INSERT INTO account_setup_tokens (id, "userId", "tokenDigest", purpose, "createdAt", "expiresAt") VALUES ('${existing}', '${nour.userId}', '${'a'.repeat(64)}', 'SETUP', now(), now() + interval '72 hours')`,
      );

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT366)}\n;\nCOMMIT;`);

      const kept = await db.$queryRawUnsafe<Array<{ userId: string; email: string | null; mailed: boolean }>>(`SELECT "userId", email, mailed FROM account_setup_tokens WHERE id = '${existing}'`);
      expect(kept).toEqual([{ userId: nour.userId, email: null, mailed: false }]);
      const verified = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM users WHERE "emailVerifiedAt" IS NOT NULL`);
      expect(Number(verified[0]!.n)).toBe(0);

      const insert = (columns: string, values: string) =>
        db.$executeRawUnsafe(`INSERT INTO account_setup_tokens (id, "tokenDigest", "createdAt", "expiresAt", ${columns}) VALUES (gen_random_uuid(), md5(random()::text) || md5(random()::text), now(), now() + interval '1 day', ${values})`);
      // Each bad row breaks one or more of the three CHECKs; Postgres names the first it tries.
      const SHAPE_REFUSED = /account_setup_tokens_(signup_has_no_user|email_iff_no_user|locale_iff_email)/;
      // The good shapes.
      await insert(`purpose, email, locale, mailed`, `'SIGNUP', 'rana@studio.example', 'ar', true`);
      await insert(`purpose, "userId", mailed`, `'RESET', '${nour.userId}', true`);
      // A SIGNUP link with a user, without an address, without a language; a person's link with an address.
      await expect(insert(`purpose, "userId", email, locale`, `'SIGNUP', '${nour.userId}', 'rana@studio.example', 'ar'`)).rejects.toThrow(SHAPE_REFUSED);
      await expect(insert(`purpose, locale`, `'SIGNUP', 'ar'`)).rejects.toThrow(SHAPE_REFUSED);
      await expect(insert(`purpose, email`, `'SIGNUP', 'rana@studio.example'`)).rejects.toThrow(SHAPE_REFUSED);
      await expect(insert(`purpose, "userId", email, locale`, `'SETUP', '${nour.userId}', 'rana@studio.example', 'ar'`)).rejects.toThrow(SHAPE_REFUSED);
      await expect(insert(`purpose`, `'RESET'`)).rejects.toThrow(SHAPE_REFUSED);

      const rest = dirs.slice(dirs.indexOf(MUT366) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
