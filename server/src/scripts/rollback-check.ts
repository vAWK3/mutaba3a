import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import { SENTRY_RULES } from '../observability/sentry-rules.js';

/**
 * MUT-347: deploy.sh's ROLLBACK_TO gate, run through the Cloud SQL proxy before the service rolls back. Read-only.
 *
 *   DATABASE_URL=… npm run --silent rollback:check -- --commit <full sha>
 *
 * A rollback never migrates (migrations are forward-only), so the database stays ahead of the old code. This
 * lists the migrations the rollback rolls back past (in `_prisma_migrations`, the source of truth, but not in the
 * commit's `server/prisma/migrations`), then runs the count query of each DEPLOYMENT.md §6 "Roll back past MUT-…"
 * row they touch. Exit 0: nothing rolled past. 2: rolled past, every count is 0 (deploy.sh asks for a typed
 * confirmation). 1: refuse (a count above 0, or the commit has a migration the database never ran).
 */
export interface RollbackHazard {
  ticket: string;
  /** The substring of its migration names, e.g. `_mut100_`. */
  migration: string;
  /** The count query, exactly as its DEPLOYMENT.md row shows it. */
  count: string;
  /** What an older revision does with those rows. */
  consequence: string;
}

export const ROLLBACK_HAZARDS: readonly RollbackHazard[] = [
  {
    ticket: 'MUT-100',
    migration: '_mut100_',
    count: `SELECT count(*) FROM agreements WHERE type = 'CONTINGENCY'`,
    consequence: "an older revision's Prisma client has no CONTINGENCY agreement type, so every read that returns one fails",
  },
  {
    ticket: 'MUT-235',
    migration: '_mut235_',
    count: `SELECT count(*) FROM users WHERE "passwordHash" IS NULL`,
    consequence: 'an older revision cannot read a NULL password (P2032): sign-in and every lookup of those people fail',
  },
  {
    ticket: 'MUT-255',
    migration: '_mut255_',
    count: `SELECT count(*) FROM expense_receipts WHERE "expenseId" IS NULL`,
    consequence: 'an older revision cannot read a receipt with no expense (P2032): expense details and records exports fail',
  },
  {
    ticket: 'MUT-182',
    migration: '_mut182_',
    count: `SELECT count(*) FROM organizations WHERE "ownerUserId" IS NOT NULL AND "personalOwnerUserId" IS NULL`,
    consequence: "an older revision treats people's own profiles as operator firms (API keys, Malafat binding, sharing)",
  },
  {
    ticket: 'MUT-333',
    migration: '_mut333_',
    count: `SELECT (SELECT count(*) FROM expenses WHERE "createdByUserId" IS NULL) + (SELECT count(*) FROM expense_receipts WHERE "uploadedByUserId" IS NULL) + (SELECT count(*) FROM conversions WHERE "createdByUserId" IS NULL) + (SELECT count(*) FROM expense_groups WHERE "createdByUserId" IS NULL)`,
    consequence: "an older revision cannot read a record whose creator closed their account (P2032): the profile's lists fail",
  },
  {
    ticket: 'MUT-115',
    migration: '_mut115_',
    count: `SELECT count(*) FROM passkeys`,
    consequence: 'an older revision has no passkey sign-in, and removing a passkey no longer signs out the sessions it opened',
  },
  {
    ticket: 'MUT-367',
    migration: '_mut367_',
    count: `SELECT count(*) FROM users WHERE status = 'PENDING_REVIEW'`,
    consequence: "an older revision's Prisma client has no PENDING_REVIEW status, so every read that returns such a person fails",
  },
  {
    ticket: 'MUT-480',
    migration: '_mut480_',
    count: `SELECT count(*) FROM agreement_supplements WHERE distribution = 'REDUCTION'`,
    consequence: "an older revision's Prisma client has no REDUCTION distribution, so reading those agreements' supplements (agreement details) fails",
  },
  {
    ticket: 'MUT-444',
    migration: '_mut444_',
    count: `SELECT (SELECT count(*) FROM payment_allocations WHERE "releasedAt" IS NOT NULL) + (SELECT count(*) FROM agreement_supplements WHERE distribution = 'CORRECTION')`,
    consequence: "an older revision counts released allocation rows, so a reversal releases twice and payment lists and statements double them; its Prisma client also has no CORRECTION distribution, so those agreements' details fail",
  },
  {
    ticket: 'MUT-302',
    migration: '_mut302_',
    count: `SELECT count(*) FROM expenses WHERE "vatTreatment" IS NOT NULL`,
    consequence: "an older revision's PATCH of a VAT expense's amount leaves the split behind, so the expenses_vat_adds_up CHECK refuses it (500); its expenses also read without their VAT",
  },
];

const MIGRATIONS_DIR = 'server/prisma/migrations/';

/** The migration directories git has at `commit`. */
export function migrationsAtCommit(commit: string, git: (args: string[]) => string = gitOut): string[] {
  const names = git(['ls-tree', '--full-tree', '--name-only', commit, MIGRATIONS_DIR])
    .split('\n')
    .map((path) => path.slice(MIGRATIONS_DIR.length))
    .filter((name) => name && name !== 'migration_lock.toml');
  if (names.length === 0) throw new Error(`no migrations at ${commit} (${MIGRATIONS_DIR})`);
  return names;
}

function gitOut(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function migrationDiff(applied: readonly string[], atCommit: readonly string[]): { rolledPast: string[]; unapplied: string[] } {
  const at = new Set(atCommit);
  const done = new Set(applied);
  return { rolledPast: applied.filter((m) => !at.has(m)).sort(), unapplied: atCommit.filter((m) => !done.has(m)).sort() };
}

/** The hazards whose migrations are among `rolledPast`, in table order. */
export function hazardsRolledPast(rolledPast: readonly string[]): RollbackHazard[] {
  return ROLLBACK_HAZARDS.filter((h) => rolledPast.some((m) => m.includes(h.migration)));
}

export async function rollbackCheck(o: {
  commit: string;
  applied: readonly string[];
  atCommit: readonly string[];
  count: (sql: string) => Promise<number>;
  log: (line: string) => void;
}): Promise<0 | 1 | 2> {
  const { rolledPast, unapplied } = migrationDiff(o.applied, o.atCommit);
  if (unapplied.length > 0) {
    o.log(`rollback: ${o.commit} has migrations the database never ran, and a rollback never migrates:\n  ${unapplied.join('\n  ')}`);
    return 1;
  }
  if (rolledPast.length === 0) {
    o.log(`rollback: rolls back past no migration; the database is exactly at ${o.commit}'s schema`);
    return 0;
  }
  o.log(`rollback: the database keeps ${rolledPast.length} migration(s) ${o.commit} doesn't know (migrations are forward-only):\n  ${rolledPast.join('\n  ')}`);
  let blocked = false;
  for (const hazard of hazardsRolledPast(rolledPast)) {
    const n = await o.count(hazard.count);
    if (n > 0) {
      blocked = true;
      o.log(`rollback: ${hazard.ticket}: ${n} row(s): ${hazard.consequence}. Refused: roll forward only, or fix the rows as DEPLOYMENT.md §6 "Roll back past ${hazard.ticket}" says, then re-run`);
    } else {
      o.log(`rollback: ${hazard.ticket}: 0 rows, harmless`);
    }
  }
  return blocked ? 1 : 2;
}

const isMain = process.argv[1]?.endsWith('rollback-check.ts') || process.argv[1]?.endsWith('rollback-check.js');
if (isMain) {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { commit: { type: 'string' } } });
  const url = process.env.DATABASE_URL;
  if (!url || !values.commit) {
    console.error('rollback-check: needs DATABASE_URL and --commit <sha>');
    process.exit(1);
  }
  const commit = values.commit;
  const db = new PrismaClient({ datasources: { db: { url } }, errorFormat: SENTRY_RULES.serverPrismaErrorFormat });
  try {
    const rows = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
    process.exitCode = await rollbackCheck({
      commit,
      applied: rows.map((r) => r.migration_name),
      atCommit: migrationsAtCommit(commit),
      count: async (sql) => Number((await db.$queryRawUnsafe<{ n: bigint | number }[]>(`SELECT (${sql}) AS n`))[0]?.n ?? 0),
      log: (line) => console.log(line),
    });
  } catch (error) {
    console.error(`rollback-check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
