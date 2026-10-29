import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hazardsRolledPast, migrationDiff, migrationsAtCommit, ROLLBACK_HAZARDS, rollbackCheck } from '../rollback-check.js';

/**
 * MUT-347: a rollback never migrates (migrations are forward-only), so before one rolls, the database's
 * applied migrations (_prisma_migrations, the source of truth) are diffed against the commit's, and every
 * "Roll back past MUT-…" row of DEPLOYMENT.md §6 runs its count query: above 0 means roll forward only.
 */
const AT = ['20261020120000_mut354_terms_client_release', '20261022090000_mut255_receipts_library'];
const APPLIED = [...AT, '20261024090000_mut367_pending_review_status', '20261024090100_mut367_signup_reviews', '20261025090000_mut115_passkeys'];

describe('migrationsAtCommit', () => {
  it('lists the migration directories git has at the commit, without the lock file', () => {
    const ls = (args: string[]) => {
      expect(args).toEqual(['ls-tree', '--full-tree', '--name-only', 'abc1234', 'server/prisma/migrations/']);
      return 'server/prisma/migrations/20261020120000_mut354_terms_client_release\nserver/prisma/migrations/migration_lock.toml\n';
    };
    expect(migrationsAtCommit('abc1234', ls)).toEqual(['20261020120000_mut354_terms_client_release']);
  });

  it('throws when the commit has no migrations directory (not this repo’s server, or not in the clone)', () => {
    expect(() => migrationsAtCommit('abc1234', () => '')).toThrow(/no migrations at abc1234/);
  });
});

describe('migrationDiff', () => {
  it('lists what the rollback rolls back past, in order', () => {
    expect(migrationDiff(APPLIED, AT)).toEqual({ rolledPast: APPLIED.slice(2), unapplied: [] });
  });

  it('lists migrations the commit has that the database never ran', () => {
    expect(migrationDiff(AT.slice(0, 1), AT)).toEqual({ rolledPast: [], unapplied: AT.slice(1) });
  });
});

describe('hazardsRolledPast', () => {
  it('names each ticket whose migration is rolled past, once', () => {
    expect(hazardsRolledPast(APPLIED.slice(2)).map((h) => h.ticket)).toEqual(['MUT-115', 'MUT-367']);
  });

  it('includes the rows MUT-347 added: MUT-333, MUT-115 and MUT-367', () => {
    expect(ROLLBACK_HAZARDS.map((h) => h.ticket)).toEqual(expect.arrayContaining(['MUT-100', 'MUT-235', 'MUT-255', 'MUT-182', 'MUT-333', 'MUT-115', 'MUT-367']));
  });

  it('MUT-480 and MUT-444 (R1): rolling back past their migrations runs their counts', () => {
    const mut480 = ['20261028170000_mut480_supplement_reduction', '20261028170100_mut480_reduction_columns'];
    const mut444 = ['20261029100000_mut444_supplement_correction', '20261029100100_mut444_allocation_released_at'];
    expect(hazardsRolledPast(mut444).map((h) => h.ticket)).toEqual(['MUT-444']);
    expect(hazardsRolledPast([...mut480, ...mut444]).map((h) => h.ticket)).toEqual(['MUT-480', 'MUT-444']);
    const byTicket = new Map(ROLLBACK_HAZARDS.map((h) => [h.ticket, h]));
    expect(byTicket.get('MUT-480')!.count).toBe(`SELECT count(*) FROM agreement_supplements WHERE distribution = 'REDUCTION'`);
    expect(byTicket.get('MUT-444')!.count).toBe(`SELECT (SELECT count(*) FROM payment_allocations WHERE "releasedAt" IS NOT NULL) + (SELECT count(*) FROM agreement_supplements WHERE distribution = 'CORRECTION')`);
  });

  it('MUT-444 refuses a rollback once a correction released a row or wrote a CORRECTION row', async () => {
    const lines: string[] = [];
    const applied = [...AT, '20261029100000_mut444_supplement_correction', '20261029100100_mut444_allocation_released_at'];
    const code = await rollbackCheck({ commit: 'abc1234', applied, atCommit: AT, count: async (sql) => (sql.includes('releasedAt') ? 2 : 0), log: (s) => lines.push(s) });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/MUT-444: 2 .*a reversal releases twice/);
  });

  it('every hazard’s migration name matches a real migration, so a typo can’t silently skip its check', () => {
    const migrations = readdirSync(resolve(process.cwd(), 'prisma/migrations'));
    for (const hazard of ROLLBACK_HAZARDS) expect(migrations.some((m) => m.includes(hazard.migration)), hazard.ticket).toBe(true);
  });

  it('every hazard is a DEPLOYMENT.md "Roll back past" row that shows its query, and every such row is a hazard', () => {
    const doc = readFileSync(resolve(process.cwd(), 'DEPLOYMENT.md'), 'utf8');
    const rows = [...doc.matchAll(/^\| Roll back past (MUT-\d+) \|(.*)$/gm)];
    expect(rows.map((r) => r[1]).sort()).toEqual(ROLLBACK_HAZARDS.map((h) => h.ticket).sort());
    for (const hazard of ROLLBACK_HAZARDS) {
      const row = rows.find((r) => r[1] === hazard.ticket)?.[2] ?? '';
      expect(row, hazard.ticket).toContain(hazard.count);
    }
  });
});

describe('rollbackCheck', () => {
  const run = async (applied: string[], atCommit: string[], counts: Record<string, number> = {}) => {
    const lines: string[] = [];
    const code = await rollbackCheck({
      commit: 'abc1234',
      applied,
      atCommit,
      count: async (sql) => counts[ROLLBACK_HAZARDS.find((h) => h.count === sql)!.ticket] ?? 0,
      log: (s) => lines.push(s),
    });
    return { code, text: lines.join('\n') };
  };

  it('is 0 when the rollback rolls back past no migration', async () => {
    expect(await run(AT, AT)).toMatchObject({ code: 0, text: expect.stringMatching(/no migration/) });
  });

  it('is 2 (confirm) when it rolls back past migrations whose hazards count 0, and lists them', async () => {
    const r = await run(APPLIED, AT);
    expect(r.code).toBe(2);
    expect(r.text).toContain('20261025090000_mut115_passkeys');
    expect(r.text).toMatch(/MUT-115: 0 /);
  });

  it('is 1 (refuse) when any hazard counts rows, naming the ticket and the count', async () => {
    const r = await run(APPLIED, AT, { 'MUT-367': 3 });
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/MUT-367: 3 .*roll forward only/);
  });

  it('is 1 when the commit has migrations the database never ran: a rollback never migrates', async () => {
    const r = await run(AT.slice(0, 1), AT);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/never ran.*mut255_receipts_library/s);
  });
});
