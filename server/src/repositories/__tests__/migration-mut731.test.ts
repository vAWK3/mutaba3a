import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-731 (ADR-284, plan tests "Postgres contract"): the Starter migration is additive and nullable. A database just
 * before it keeps every user and subscription; afterwards the new columns read null on old rows, `activeBusinessIds`
 * (uuid[]) is written and read back through Prisma, and the schema matches. Each migration runs in its own transaction,
 * as `prisma migrate deploy` does.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const STARTER = '20261126120000_mut731_starter';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-731 Starter migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-731 Starter migration', () => {
    it('keeps old rows with the new columns null, round-trips the uuid[] column, and matches the schema', async () => {
      const name = `mut731_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      expect(dirs).toContain(STARTER);
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(STARTER))));
      const { userId } = await insertUserWithPersonalRow(db, []);

      execute(dbUrl, inTransactions([STARTER]));
      const rest = dirs.slice(dirs.indexOf(STARTER) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));

      const before = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { starterChosenAt: true, activeBusinessIds: true, paidTrialOfferedAt: true, paidTrialUsedAt: true } });
      expect(before).toEqual({ starterChosenAt: null, activeBusinessIds: [], paidTrialOfferedAt: null, paidTrialUsedAt: null });
      const [raw] = await db.$queryRawUnsafe<Array<{ ids: string[] | null }>>(`SELECT "activeBusinessIds" AS ids FROM users WHERE id = '${userId}'`);
      expect(raw!.ids).toBeNull();

      const nullable = await db.$queryRawUnsafe<Array<{ table_name: string; column_name: string; is_nullable: string; udt_name: string }>>(
        `SELECT table_name, column_name, is_nullable, udt_name FROM information_schema.columns
         WHERE (table_name = 'users' AND column_name IN ('starterChosenAt','activeBusinessIds','paidTrialOfferedAt','paidTrialUsedAt'))
            OR (table_name = 'billing_subscriptions' AND column_name IN ('endedReason','trialEnd'))
         ORDER BY table_name, column_name`,
      );
      expect(nullable).toHaveLength(6);
      expect(nullable.every((c) => c.is_nullable === 'YES')).toBe(true);
      expect(nullable.find((c) => c.column_name === 'activeBusinessIds')?.udt_name).toBe('_uuid');

      const ids = [randomUUID(), randomUUID()];
      await db.user.update({ where: { id: userId }, data: { activeBusinessIds: { set: ids }, starterChosenAt: new Date('2026-11-26T10:00:00Z') } });
      const after = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { activeBusinessIds: true, starterChosenAt: true } });
      expect(after.activeBusinessIds).toEqual(ids);
      expect(after.starterChosenAt?.toISOString()).toBe('2026-11-26T10:00:00.000Z');
      await db.user.update({ where: { id: userId }, data: { activeBusinessIds: { set: [] } } });
      expect((await db.user.findUniqueOrThrow({ where: { id: userId }, select: { activeBusinessIds: true } })).activeBusinessIds).toEqual([]);

      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
