import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-367 (ADR-178, D29): the PENDING_REVIEW value ships in its own migration, so the review table's migration never
 * uses an enum value added in its own transaction. Each runs in one transaction (as Prisma runs them), existing
 * links keep no domain verdict, and the CHECKs hold: only a SIGNUP link carries a verdict, a decision comes with its
 * time, and an open review always names its person.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const STATUS = '20261024090000_mut367_pending_review_status';
const REVIEWS = '20261024090100_mut367_signup_reviews';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-367 signup review migrations (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-367 signup review migrations', () => {
    it('apply one transaction each, keep existing links, enforce the review shapes and match the schema', async () => {
      const name = `mut367_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      expect(dirs.indexOf(REVIEWS)).toBe(dirs.indexOf(STATUS) + 1);
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(STATUS))));
      const nour = await insertUserWithPersonalRow(db, []);
      await db.$executeRawUnsafe(`INSERT INTO account_setup_tokens (id, "tokenDigest", purpose, email, locale, mailed, "createdAt", "expiresAt") VALUES (gen_random_uuid(), '${'b'.repeat(64)}', 'SIGNUP', 'old@studio.example', 'ar', true, now(), now() + interval '1 day')`);

      execute(dbUrl, `BEGIN;\n${sqlOf(STATUS)}\n;\nCOMMIT;`);
      execute(dbUrl, `BEGIN;\n${sqlOf(REVIEWS)}\n;\nCOMMIT;`);

      const old = await db.$queryRawUnsafe<Array<{ domainClass: string | null }>>(`SELECT "domainClass" FROM account_setup_tokens WHERE email = 'old@studio.example'`);
      expect(old).toEqual([{ domainClass: null }]);

      await db.$executeRawUnsafe(`UPDATE users SET status = 'PENDING_REVIEW' WHERE id = '${nour.userId}'`);
      const review = (values: string) => db.$executeRawUnsafe(`INSERT INTO signup_reviews (id, "userId", domain, classification, reasons, "createdAt", decision, "decidedAt") VALUES (gen_random_uuid(), ${values})`);
      // A person's link can't carry a verdict.
      await expect(
        db.$executeRawUnsafe(`INSERT INTO account_setup_tokens (id, "userId", "tokenDigest", purpose, "createdAt", "expiresAt", "domainClass") VALUES (gen_random_uuid(), '${nour.userId}', '${'c'.repeat(64)}', 'RESET', now(), now(), 'WEBMAIL')`),
      ).rejects.toThrow(/account_setup_tokens_domain_class_signup_only/);
      // A decision without its time; an open review with no person.
      await expect(review(`'${nour.userId}', 'gmail.com', 'WEBMAIL', ARRAY['webmail'], now(), 'APPROVED', NULL`)).rejects.toThrow(/signup_reviews_decided_together/);
      await expect(review(`NULL, 'gmail.com', 'WEBMAIL', ARRAY['webmail'], now(), NULL, NULL`)).rejects.toThrow(/signup_reviews_open_has_user/);
      // The good shape; and one review per person.
      await review(`'${nour.userId}', 'gmail.com', 'WEBMAIL', ARRAY['webmail'], now(), NULL, NULL`);
      await expect(review(`'${nour.userId}', 'gmail.com', 'WEBMAIL', ARRAY['webmail'], now(), NULL, NULL`)).rejects.toThrow(/23505/);

      const rest = dirs.slice(dirs.indexOf(REVIEWS) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
