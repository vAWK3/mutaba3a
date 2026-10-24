import { PrismaClient } from '@prisma/client';
import { categoryNameKey } from '../expenses/names.js';
import { PrismaLedgerStore } from '../repositories/prisma.js';
import { vendorNameKey } from '../vendors/keys.js';

/**
 * MUT-254 (ADR-183, A9/A10): links expenses to their profile's vendors. The migration adds `expenses.vendorId` empty,
 * and the old revision keeps writing vendor text without a link while the roll runs (or after a rollback), so this
 * runs from post-roll on every deploy as well as by hand:
 *
 *   DATABASE_URL=… npm run backfill:vendors            # apply
 *   DATABASE_URL=… npm run backfill:vendors -- --dry   # report only, writes nothing
 *
 * Oldest first (so a vendor's name is its first spelling), over live expenses:
 * - vendor text, no link yet → resolve the text exactly as a write would (`vendors.resolve`, dated the expense's
 *   createdAt) and link;
 * - linked, but the text no longer names that vendor (the old revision changed it) → re-link the same way. Except a
 *   link made by registration number where another vendor holds the typed name (A5 leaves the name there): that
 *   link is right and stays. An old-revision edit on such a row to another vendor's name stays linked too (rare);
 * - linked, but the text was cleared or normalises to nothing → unlink. Unlinked text that normalises to nothing is
 *   rescanned each run (cheap).
 * `relinkSince` limits the linked rows checked to those updated since then: post-roll passes the last 7 days, which
 * covers a roll and a short rollback; after a longer rollback run it by hand without it.
 * Then every vendor's `lastUsedAt` catches up with its newest linked expense, and a vendor with no default takes the
 * category of its newest categorised expense (never the automatic Other).
 *
 * A link is housekeeping, not an edit: `version` and `updatedAt` stay, so no client's If-Match goes stale. Each
 * update is guarded on the text it read, so an edit landing meanwhile wins. Idempotent: a second run changes nothing.
 */

const PAGE = 500;
const OTHER_KEYS = [categoryNameKey('Other'), categoryNameKey('أخرى')];

export interface VendorBackfillResult {
  linked: number;
  relinked: number;
  unlinked: number;
  lastUsedCaughtUp: number;
  defaultsSet: number;
}

export async function backfillVendors(db: PrismaClient, options: { dry?: boolean; relinkSince?: Date } = {}): Promise<VendorBackfillResult> {
  const store = new PrismaLedgerStore(db);
  const result: VendorBackfillResult = { linked: 0, relinked: 0, unlinked: 0, lastUsedCaughtUp: 0, defaultsSet: 0 };
  let after: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const rows: Array<{ id: string; organizationId: string; vendor: string | null; vendorId: string | null; createdAt: Date }> = await db.expense.findMany({
      where: {
        deletedAt: null,
        AND: [
          { OR: [{ vendorId: null, vendor: { not: null } }, { vendorId: { not: null }, ...(options.relinkSince ? { updatedAt: { gte: options.relinkSince } } : {}) }] },
          ...(after ? [{ OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] }] : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: PAGE,
      select: { id: true, organizationId: true, vendor: true, vendorId: true, createdAt: true },
    });
    if (rows.length === 0) break;
    after = rows[rows.length - 1]!;

    const linkedIds = [...new Set(rows.flatMap((r) => (r.vendorId ? [r.vendorId] : [])))];
    const registered = new Set((await db.vendor.findMany({ where: { id: { in: linkedIds }, registrationKey: { not: null } }, select: { id: true } })).map((v) => v.id));
    const namesOf = new Map<string, Set<string>>();
    for (const n of await db.vendorName.findMany({ where: { vendorId: { in: linkedIds } }, select: { vendorId: true, nameKey: true } })) {
      (namesOf.get(n.vendorId) ?? namesOf.set(n.vendorId, new Set()).get(n.vendorId)!).add(n.nameKey);
    }

    for (const row of rows) {
      const key = vendorNameKey(row.vendor ?? '');
      if (!key) {
        if (row.vendorId) {
          result.unlinked += 1;
          if (!options.dry) await db.expense.updateMany({ where: { id: row.id, vendor: row.vendor }, data: { vendorId: null } });
        }
        continue;
      }
      if (row.vendorId && namesOf.get(row.vendorId)?.has(key)) continue;
      if (row.vendorId && registered.has(row.vendorId)) {
        // Linked by its registration number while another vendor holds this name (A5): right as it is.
        const owner = await db.vendorName.findUnique({ where: { organizationId_nameKey: { organizationId: row.organizationId, nameKey: key } }, select: { vendorId: true } });
        if (owner && owner.vendorId !== row.vendorId) continue;
      }
      if (row.vendorId) result.relinked += 1;
      else result.linked += 1;
      if (options.dry) continue;
      const vendor = await store.vendors.resolve({ organizationId: row.organizationId, name: row.vendor! }, row.createdAt);
      if (vendor) await db.expense.updateMany({ where: { id: row.id, vendor: row.vendor }, data: { vendorId: vendor.id } });
    }
  }
  if (options.dry) return result;

  result.lastUsedCaughtUp = await db.$executeRaw`
    UPDATE vendors v SET "lastUsedAt" = newest.at
    FROM (SELECT "vendorId", max("createdAt") AS at FROM expenses WHERE "vendorId" IS NOT NULL AND "deletedAt" IS NULL GROUP BY "vendorId") newest
    WHERE v.id = newest."vendorId" AND v."lastUsedAt" < newest.at`;
  result.defaultsSet = await db.$executeRaw`
    UPDATE vendors v SET "lastCategoryId" = latest."categoryId"
    FROM (
      SELECT DISTINCT ON (e."vendorId") e."vendorId", e."categoryId"
      FROM expenses e JOIN expense_categories c ON c.id = e."categoryId"
      WHERE e."vendorId" IS NOT NULL AND e."deletedAt" IS NULL AND c."nameKey" NOT IN (${OTHER_KEYS[0]}, ${OTHER_KEYS[1]})
      ORDER BY e."vendorId", e."createdAt" DESC, e.id DESC
    ) latest
    WHERE v.id = latest."vendorId" AND v."lastCategoryId" IS NULL`;
  return result;
}

const isMain = process.argv[1]?.endsWith('backfill-vendors.ts') || process.argv[1]?.endsWith('backfill-vendors.js');
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('backfill-vendors: DATABASE_URL is not set');
    process.exit(1);
  }
  const dry = process.argv.includes('--dry');
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const r = await backfillVendors(db, { dry });
    console.log(`backfill-vendors${dry ? ' (dry)' : ''}: ${r.linked} linked, ${r.relinked} re-linked, ${r.unlinked} unlinked, ${r.lastUsedCaughtUp} last-used caught up, ${r.defaultsSet} default categories set`);
  } finally {
    await db.$disconnect();
  }
}
