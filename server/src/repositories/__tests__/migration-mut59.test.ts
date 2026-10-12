import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';

/**
 * MUT-59: production applied the ORIGINAL M7 migration (acb1144) before M8
 * edited it in place, so its FeeProposalStatus enum and two columns predate
 * M8. The repair migration must bring such a database to M8's shape, keep a
 * record of what it changed, refuse data it cannot map, and do nothing on a
 * database that already has M8's shape. Each case runs on its own scratch
 * database built exactly as production got its schema.
 */
// Replaying the whole migration history through `prisma db execute` takes seconds, and more while the rest of
// test:db runs in parallel; the 5 s default turned load into failures (MUT-61 added a second file like this one).
vi.setConfig({ testTimeout: 60_000 });

const url = process.env.MUTABA3A_TEST_DATABASE_URL;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(SERVER, 'prisma/migrations');
const PRISMA = join(SERVER, 'node_modules/.bin/prisma');
const REPAIR = '20261011120000_mut59_fee_proposal_enum_repair';
const M7 = '20261009120000_m7_fee_proposals';
const ORIGINAL_M7 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/m7_fee_proposals.acb1144.sql'), 'utf8');

const migrationDirs = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');

function execute(dbUrl: string, sql: string): void {
  execFileSync(PRISMA, ['db', 'execute', '--stdin', '--url', dbUrl], { input: sql, cwd: SERVER, stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * One transaction per file, as `prisma migrate deploy` applies them: pasted into a single script the history would be
 * one implicit transaction, and Postgres refuses an enum value used in the transaction that added it (MUT-100's
 * CONTINGENCY, eng review D3).
 */
const asDeployed = (files: readonly string[]) => files.map((sql) => `BEGIN;\n${sql}\n;\nCOMMIT;`).join('\n');
/** Every migration but the repair, with M7 as production applied it. */
const legacyHistory = () => asDeployed(migrationDirs().filter((d) => d !== REPAIR).map((d) => (d === M7 ? ORIGINAL_M7 : sqlOf(d))));
/** Every migration as `main` has it, the repair included: a fresh database. */
const freshHistory = () => asDeployed(migrationDirs().map(sqlOf));

if (!url) {
  describe.skip('MUT-59 repair migration (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  const created: string[] = [];
  const clients: PrismaClient[] = [];

  async function scratch(): Promise<{ dbUrl: string; db: PrismaClient }> {
    const name = `mut59_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created.push(name);
    const u = new URL(url!);
    u.pathname = `/${name}`;
    const db = new PrismaClient({ datasources: { db: { url: u.toString() } } });
    clients.push(db);
    return { dbUrl: u.toString(), db };
  }

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.$disconnect()));
    for (const name of created) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  });

  const enumLabels = async (db: PrismaClient) =>
    (await db.$queryRawUnsafe<Array<{ label: string }>>(`SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'FeeProposalStatus' ORDER BY e.enumsortorder`)).map((r) => r.label);
  const columns = async (db: PrismaClient) =>
    (await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'fee_proposals'`)).map((r) => r.name);
  const rows = (db: PrismaClient) =>
    db.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT id::text, status::text, "clientApprovedOn", "clientApprovalNote", "agreedAmountMinor"::text AS "agreedAmountMinor", "agreementId"::text AS "agreementId", version FROM fee_proposals ORDER BY id`);
  const repairs = (db: PrismaClient) => db.$queryRawUnsafe<Array<{ entityId: string; actorType: string; metadata: Record<string, unknown> }>>(`SELECT "entityId", "actorType"::text AS "actorType", metadata FROM audit_events WHERE action = 'fee_proposal.repaired' ORDER BY "entityId"`);
  const noDrift = (dbUrl: string) => {
    try {
      execFileSync(PRISMA, ['migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', join(SERVER, 'prisma/schema.prisma'), '--exit-code'], { cwd: SERVER, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };

  /** An organization with projects and one real agreement, written by today's store (those tables are the same in both shapes). */
  async function firm(dbUrl: string) {
    const store = PrismaLedgerStore.connect(dbUrl);
    const at = new Date('2026-10-09T08:00:00Z');
    const org = await store.organizations.create({ name: 'Firm', slug: `firm-${randomUUID().slice(0, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const customer = await store.customers.create({ organizationId: org.id, name: 'Haddad', email: null, phone: null, notes: null }, at);
    const project = async (name: string) => store.projects.create({ organizationId: org.id, customerId: customer.id, name, currency: 'ILS' }, at);
    const [p1, p2, p3, p4, p5] = [await project('P1'), await project('P2'), await project('P3'), await project('P4'), await project('P5')];
    const { agreement } = await store.agreements.create(
      { organizationId: org.id, projectId: p3!.id, customerId: customer.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: 450_000n, netMinor: 450_000n, vatMinor: 0n, grossMinor: 450_000n, agreementDate: '2026-10-09', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments: [] },
      at,
    );
    await store.disconnect();
    return { org, customer, projects: [p1!, p2!, p3!, p4!, p5!] as const, agreement };
  }

  async function insertProposal(db: PrismaClient, f: Awaited<ReturnType<typeof firm>>, projectId: string, status: string, extra: Record<string, string | null> = {}) {
    const id = randomUUID();
    const cols = ['id', 'organizationId', 'projectId', 'customerId', 'currency', 'status', 'pricingBasis', 'proposedAmountMinor', 'proposedOn', ...Object.keys(extra)];
    const vals = [`'${id}'`, `'${f.org.id}'`, `'${projectId}'`, `'${f.customer.id}'`, `'ILS'`, `'${status}'`, `'VAT_EXCLUSIVE'`, `400000`, `'2026-10-08'`, ...Object.values(extra).map((v) => (v === null ? 'NULL' : `'${v}'`))];
    await db.$executeRawUnsafe(`INSERT INTO fee_proposals (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')})`);
    return id;
  }

  describe('MUT-59 repair migration on a database that applied the original M7', () => {
    it('maps every M7 status, keeps a record, drops the M7-only columns and leaves an M8-shaped schema', async () => {
      const { dbUrl, db } = await scratch();
      execute(dbUrl, legacyHistory());
      expect(await enumLabels(db)).toEqual(['PROPOSED', 'CLIENT_APPROVED', 'AGREED', 'CONVERTED', 'WITHDRAWN']);
      const f = await firm(dbUrl);
      const [p1, p2, p3, p4, p5] = f.projects;
      const open = await insertProposal(db, f, p1.id, 'PROPOSED');
      const clientApproved = await insertProposal(db, f, p2.id, 'CLIENT_APPROVED', { clientApprovedOn: '2026-10-09', clientApprovalNote: 'By phone' });
      const converted = await insertProposal(db, f, p3.id, 'CONVERTED', { clientApprovedOn: null, agreementId: f.agreement.id });
      const agreed = await insertProposal(db, f, p4.id, 'AGREED', { clientApprovedOn: '2026-10-09', agreedAmountMinor: '380000', agreedOn: '2026-10-10', agreedNote: 'Discounted' });
      const withdrawn = await insertProposal(db, f, p5.id, 'WITHDRAWN', { agreedNote: 'Old note' });

      execute(dbUrl, sqlOf(REPAIR));

      expect(await enumLabels(db)).toEqual(['PROPOSED', 'APPROVED', 'WITHDRAWN']);
      expect(await columns(db)).not.toEqual(expect.arrayContaining(['agreedOn']));
      expect(await columns(db)).not.toEqual(expect.arrayContaining(['agreedNote']));
      const byId = new Map((await rows(db)).map((r) => [r.id, r]));
      expect(byId.get(open)).toMatchObject({ status: 'PROPOSED', version: 1 });
      expect(byId.get(clientApproved)).toMatchObject({ status: 'PROPOSED', clientApprovedOn: null, clientApprovalNote: null, agreedAmountMinor: null, version: 2 });
      expect(byId.get(agreed)).toMatchObject({ status: 'PROPOSED', clientApprovedOn: null, agreedAmountMinor: null, version: 2 });
      // CONVERTED had an agreement: APPROVED, dated and priced from it since M7 left those fields empty.
      expect(byId.get(converted)).toMatchObject({ status: 'APPROVED', clientApprovedOn: '2026-10-09', agreedAmountMinor: '450000', agreementId: f.agreement.id, version: 2 });
      expect(byId.get(withdrawn)).toMatchObject({ status: 'WITHDRAWN', version: 1 });

      const audit = await repairs(db);
      expect(audit.map((a) => a.entityId).sort()).toEqual([clientApproved, converted, agreed, withdrawn].sort());
      for (const a of audit) expect(a.actorType).toBe('SYSTEM');
      const of = (id: string) => audit.find((a) => a.entityId === id)!.metadata;
      expect(of(agreed)).toEqual({ repair: 'MUT-59', fromStatus: 'AGREED', toStatus: 'PROPOSED', clientApprovedOn: '2026-10-09', agreedAmountMinor: '380000', agreedOn: '2026-10-10', agreedNote: 'Discounted' });
      expect(of(clientApproved)).toEqual({ repair: 'MUT-59', fromStatus: 'CLIENT_APPROVED', toStatus: 'PROPOSED', clientApprovedOn: '2026-10-09', clientApprovalNote: 'By phone' });
      expect(of(withdrawn)).toEqual({ repair: 'MUT-59', fromStatus: 'WITHDRAWN', toStatus: 'WITHDRAWN', agreedNote: 'Old note' });

      expect(noDrift(dbUrl)).toBe(true);

      // Today's store reads every row and can approve a formerly client-approved proposal.
      const store = PrismaLedgerStore.connect(dbUrl);
      const listed = await store.feeProposals.list(f.org.id, {}, { limit: 50, cursor: null });
      expect(listed.items).toHaveLength(5);
      const approved = await store.feeProposals.transition(f.org.id, clientApproved, ['PROPOSED'], { status: 'APPROVED', clientApprovedOn: '2026-10-11', agreedAmountMinor: 400_000n }, new Date());
      expect(approved).toMatchObject({ kind: 'updated', record: { status: 'APPROVED' } });
      await store.disconnect();
    });

    it('changes nothing the second time', async () => {
      const { dbUrl, db } = await scratch();
      execute(dbUrl, legacyHistory());
      const f = await firm(dbUrl);
      await insertProposal(db, f, f.projects[0]!.id, 'AGREED', { agreedOn: '2026-10-10' });
      execute(dbUrl, sqlOf(REPAIR));
      const before = { rows: await rows(db), audit: (await repairs(db)).length };
      execute(dbUrl, sqlOf(REPAIR));
      expect({ rows: await rows(db), audit: (await repairs(db)).length }).toEqual(before);
    });

    it.each([
      ['a CONVERTED proposal with no agreement', [['CONVERTED', 0, {}]]],
      ['a project that would end up with two open proposals', [['PROPOSED', 0, {}], ['CLIENT_APPROVED', 0, {}]]],
    ] as const)('refuses %s, and changes nothing', async (_label, proposals) => {
      const { dbUrl, db } = await scratch();
      execute(dbUrl, legacyHistory());
      const f = await firm(dbUrl);
      for (const [status, project, extra] of proposals) await insertProposal(db, f, f.projects[project]!.id, status, extra);
      const before = await rows(db);
      expect(() => execute(dbUrl, sqlOf(REPAIR))).toThrow(/MUT-59 repair refused/);
      expect(await enumLabels(db)).toEqual(['PROPOSED', 'CLIENT_APPROVED', 'AGREED', 'CONVERTED', 'WITHDRAWN']);
      expect(await columns(db)).toEqual(expect.arrayContaining(['agreedOn', 'agreedNote']));
      expect(await rows(db)).toEqual(before);
      expect(await repairs(db)).toEqual([]);
    });
  });

  describe('MUT-59 repair migration on a fresh database', () => {
    it('is a no-op: M8 enum, no audit rows, no drift', async () => {
      const { dbUrl, db } = await scratch();
      execute(dbUrl, freshHistory());
      expect(migrationDirs()).toContain(REPAIR);
      expect(await enumLabels(db)).toEqual(['PROPOSED', 'APPROVED', 'WITHDRAWN']);
      expect(await repairs(db)).toEqual([]);
      expect(noDrift(dbUrl)).toBe(true);
    });
  });
}
