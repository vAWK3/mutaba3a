import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-777 (ADR-333): the watched-sessions yes is one additive nullable column on users. A person from before it reads
 * null (not asked), the column takes an instant, and the schema matches.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const CONSENT = '20261127230000_mut777_pilot_watch_consent';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-777 watch-consent migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-777 watch-consent migration', () => {
    it('comes after the pilot migration, keeps old people as not asked, stores an instant, and matches the schema', async () => {
      const name = `mut777_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      expect(dirs.indexOf(CONSENT)).toBeGreaterThan(dirs.indexOf('20261127210000_mut752_pilot_grants'));
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(CONSENT))));
      const { userId } = await insertUserWithPersonalRow(db, []);

      execute(dbUrl, inTransactions(dirs.slice(dirs.indexOf(CONSENT))));
      expect(await db.user.findUniqueOrThrow({ where: { id: userId }, select: { pilotWatchConsentAt: true } })).toEqual({ pilotWatchConsentAt: null });
      const at = new Date('2026-12-01T10:00:00.000Z');
      await db.user.update({ where: { id: userId }, data: { pilotWatchConsentAt: at } });
      expect(await db.user.findUniqueOrThrow({ where: { id: userId }, select: { pilotWatchConsentAt: true } })).toEqual({ pilotWatchConsentAt: at });

      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
