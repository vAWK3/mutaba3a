import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { insertFirmRow } from './fixtures/raw-rows.js';

/**
 * MUT-303 (ADR-239): vendors gain a remembered currency and VAT. The migration seeds each vendor's currency from its
 * most recently entered live expense, in a currency the API supports (D5, review R9), and no VAT; the CHECK keeps
 * the VAT's two columns together. Runs on a scratch database built from the migrations before it.
 */
vi.setConfig({ testTimeout: 120_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT303 = '20261102180000_mut303_vendor_defaults';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
const inTransactions = (dirs: string[]) => dirs.map((dir) => `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`).join('\n');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-303 vendor defaults migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-303 vendor defaults migration', () => {
    it('seeds the last-entered supported currency, no VAT, enforces the VAT pair and matches the schema', async () => {
      const name = `mut303_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      execute(dbUrl, inTransactions(dirs.slice(0, dirs.indexOf(MUT303))));
      const firm = await insertFirmRow(db);
      const vendor = async (label: string) => {
        const id = randomUUID();
        await db.$executeRawUnsafe(`INSERT INTO vendors (id, "organizationId", "canonicalName", "lastUsedAt", "createdAt", "updatedAt") VALUES ('${id}', '${firm.id}', '${label}', now(), now(), now())`);
        return id;
      };
      const expense = (vendorId: string, currency: string, occurredOn: string, createdAt: string, deleted = false) =>
        db.$executeRawUnsafe(
          `INSERT INTO expenses (id, "organizationId", "occurredOn", "amountMinor", currency, "vendorId", "createdAt", "updatedAt", "deletedAt") VALUES ('${randomUUID()}', '${firm.id}', '${occurredOn}', 1000, '${currency}', '${vendorId}', '${createdAt}', '${createdAt}', ${deleted ? 'now()' : 'NULL'})`,
        );
      const bezeq = await vendor('Bezeq');
      const gulf = await vendor('Gulf Supplier');
      const quiet = await vendor('Never Used');
      // Entered last wins, even when back-dated (as touch learns); a deleted one never counts.
      await expense(bezeq, 'ILS', '2026-10-20', '2026-10-20T09:00:00Z');
      await expense(bezeq, 'EUR', '2026-09-01', '2026-10-25T09:00:00Z');
      await expense(bezeq, 'USD', '2026-10-30', '2026-10-30T09:00:00Z', true);
      // A currency the API no longer offers is never seeded.
      await expense(gulf, 'AED', '2026-10-01', '2026-10-01T09:00:00Z');

      execute(dbUrl, `BEGIN;\n${sqlOf(MUT303)}\n;\nCOMMIT;`);

      const rows = await db.$queryRawUnsafe<Array<{ id: string; lastCurrency: string | null; lastVatTreatment: string | null }>>(`SELECT id::text, "lastCurrency", "lastVatTreatment"::text FROM vendors`);
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(bezeq)).toMatchObject({ lastCurrency: 'EUR', lastVatTreatment: null });
      expect(byId.get(gulf)!.lastCurrency).toBeNull();
      expect(byId.get(quiet)!.lastCurrency).toBeNull();

      // The VAT's treatment and rate are set together or not at all.
      await expect(db.$executeRawUnsafe(`UPDATE vendors SET "lastVatTreatment" = 'STANDARD_RATED' WHERE id = '${bezeq}'`)).rejects.toThrow(/vendors_last_vat_both_or_none/);
      await expect(db.$executeRawUnsafe(`UPDATE vendors SET "lastVatRateBasisPoints" = 1600 WHERE id = '${bezeq}'`)).rejects.toThrow(/vendors_last_vat_both_or_none/);
      await db.$executeRawUnsafe(`UPDATE vendors SET "lastVatTreatment" = 'STANDARD_RATED', "lastVatRateBasisPoints" = 1600 WHERE id = '${bezeq}'`);

      const rest = dirs.slice(dirs.indexOf(MUT303) + 1);
      if (rest.length > 0) execute(dbUrl, inTransactions(rest));
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
