import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertUserWithPersonalRow } from './fixtures/raw-rows.js';

/**
 * MUT-752 (ADR-296): the pilot migration is additive. A grant and a person from before it keep everything, read null
 * in the new columns; the two CHECKs refuse a pilot without an expiry and an accountant without a pilot; deleting the
 * accountant keeps the grant and clears the name (SET NULL); and the schema matches.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const PILOT = '20261127210000_mut752_pilot_grants';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-752 pilot migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-752 pilot migration', () => {
    it('keeps old grants and people, enforces the pilot CHECKs, clears a deleted accountant, and matches the schema', async () => {
      const name = `mut752_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      expect(dirs).toContain(PILOT);
      expect(dirs.at(-1) === PILOT || dirs.indexOf(PILOT) > dirs.indexOf('20261127180000_mut734_plan_changes')).toBe(true);
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(PILOT))));
      const { userId } = await insertUserWithPersonalRow(db, []);
      const oldGrant = randomUUID();
      await db.$executeRawUnsafe(
        `INSERT INTO entitlement_grants (id, "userId", tier, reason, "grantedBy", "createdAt") VALUES ('${oldGrant}', '${userId}', 'BUSINESS', 'comp', 'admin', now())`,
      );

      execute(dbUrl, inTransactions([PILOT]));
      const rest = dirs.slice(dirs.indexOf(PILOT) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));

      expect(await db.entitlementGrant.findUniqueOrThrow({ where: { id: oldGrant }, select: { cohort: true, referredByUserId: true, reason: true } })).toEqual({ cohort: null, referredByUserId: null, reason: 'comp' });
      expect(await db.user.findUniqueOrThrow({ where: { id: userId }, select: { pilotWelcomeSeenAt: true } })).toEqual({ pilotWelcomeSeenAt: null });

      // A bare person (no profile), so deleting them is only the grant's SET NULL.
      const accountantId = randomUUID();
      await db.$executeRawUnsafe(
        `INSERT INTO users (id, email, "displayName", "passwordHash", locale, "passwordChangedAt", "createdAt", "updatedAt") VALUES ('${accountantId}', 'a-${accountantId.slice(0, 8)}@firm.ps', 'Nasser', 'x', 'en', now(), now(), now())`,
      );
      const base = { userId, tier: 'BUSINESS' as const, reason: 'pilot', grantedBy: 'admin', createdAt: new Date() };
      await expect(db.entitlementGrant.create({ data: { ...base, cohort: 'dec-2026' } })).rejects.toThrow(/pilot_expiry_check/);
      await expect(db.entitlementGrant.create({ data: { ...base, expiresAt: new Date(Date.now() + 86_400_000), referredByUserId: accountantId } })).rejects.toThrow(/pilot_referral_check/);
      const pilot = await db.entitlementGrant.create({ data: { ...base, expiresAt: new Date(Date.now() + 86_400_000), cohort: 'dec-2026', referredByUserId: accountantId } });

      await db.$executeRawUnsafe(`DELETE FROM users WHERE id = '${accountantId}'`);
      expect(await db.entitlementGrant.findUniqueOrThrow({ where: { id: pilot.id }, select: { cohort: true, referredByUserId: true } })).toEqual({ cohort: 'dec-2026', referredByUserId: null });

      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
