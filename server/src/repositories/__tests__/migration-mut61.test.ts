import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';

/**
 * MUT-61: payments gain `origin` and `captureSource`. Every payment a person
 * captured before the migration (MUT-65 income, MUT-66 filing, settle) carries
 * its creator and must come out CAPTURE; Malafat-fed ones never do and stay
 * INTEGRATION. Runs on a scratch database built from the migrations before it.
 */
// Replaying the whole migration history through `prisma db execute` takes seconds, and more while the rest of
// test:db runs in parallel; the 5 s default turned load into failures (MUT-61 added a second file like this one).
vi.setConfig({ testTimeout: 60_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const MUT61 = '20261012190000_mut61_payment_capture';

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

if (!url) {
  describe.skip('MUT-61 payment origin migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
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

  describe('MUT-61 payment origin migration', () => {
    it('backfills CAPTURE exactly where a person created the payment, leaves the rest INTEGRATION, and matches the schema', async () => {
      const name = `mut61_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
      const u = new URL(url);
      u.pathname = `/${name}`;
      const dbUrl = u.toString();
      const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      clients.push(db);

      const dirs = migrationDirs();
      execute(dbUrl, dirs.slice(0, dirs.indexOf(MUT61)).map(sqlOf).join('\n;\n'));

      // Tables this migration does not touch can be written by today's store.
      const store = PrismaLedgerStore.connect(dbUrl);
      const at = new Date('2026-10-12T08:00:00Z');
      const org = await store.organizations.create({ name: 'Firm', slug: `firm-${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const customer = await store.customers.create({ organizationId: org.id, name: 'Haddad', email: null, phone: null, notes: null }, at);
      const { user } = await store.users.create({ email: `n-${randomUUID().slice(0, 8)}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: org.id, personal: { name: 'Personal', slug: `personal-${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at });
      await store.disconnect();

      const insert = async (number: string, createdByUserId: string | null) => {
        const id = randomUUID();
        await db.$executeRawUnsafe(
          `INSERT INTO payments (id, "organizationId", "customerId", number, currency, "amountMinor", "receivedOn", method, "createdByUserId") VALUES ('${id}', '${org.id}', '${customer.id}', '${number}', 'ILS', 1000, '2026-10-10', 'CASH', ${createdByUserId ? `'${createdByUserId}'` : 'NULL'})`,
        );
        return id;
      };
      const malafat = await insert('PAY-2026-0001', null);
      const captured = await insert('PAY-2026-0002', user.id);

      execute(dbUrl, sqlOf(MUT61));

      const rows = await db.$queryRawUnsafe<Array<{ id: string; origin: string; captureSource: string | null }>>(`SELECT id::text, origin::text, "captureSource" FROM payments`);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[malafat]).toMatchObject({ origin: 'INTEGRATION', captureSource: null });
      expect(byId[captured]).toMatchObject({ origin: 'CAPTURE', captureSource: null });

      // The rest of the history (MUT-100 onwards), one transaction per file as `prisma migrate deploy` applies it, ends at the schema.
      for (const dir of dirs.slice(dirs.indexOf(MUT61) + 1)) execute(dbUrl, `BEGIN;\n${sqlOf(dir)}\n;\nCOMMIT;`);
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
    });
  });
}
