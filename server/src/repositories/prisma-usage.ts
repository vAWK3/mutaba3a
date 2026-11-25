import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { capOf, NEAR_SHARE } from '../usage/caps.js';
import { meterOf, USAGE_METERS, USAGE_PLANS, type UsageKind, type UsageMeter, type UsagePlan } from '../usage/kinds.js';
import { BUCKET_COUNT, type StatusClass } from '../usage/route-buckets.js';
import type {
  RouteUsageTotal,
  UsageCounterRecord,
  UsageEventInput,
  UsagePeoplePage,
  UsagePeopleQuery,
  UsagePlanStanding,
  UsageRecordResult,
  UsageRepository,
} from './ports.js';

/**
 * MUT-735 (ADR-281): the usage ledger on Postgres. `recordUsageTx` is what the issue and receipt transactions call, so
 * the event and its counter commit (or roll back) with the action itself.
 */

type Tx = Prisma.TransactionClient;

/** Thrown inside a transaction when the meter is at its cap, so everything the transaction wrote rolls back. */
export class UsageCapReached extends Error {
  constructor(
    readonly used: number,
    readonly cap: number,
  ) {
    super(`usage cap reached (${used}/${cap})`);
  }
}

/**
 * The event, then (for a metered kind) the conditional increment. A duplicate (kind, entityKey) answers `duplicate`
 * having written nothing. At the cap it throws UsageCapReached (the caller's transaction rolls the event back).
 */
export async function recordUsageTx(tx: Tx, event: UsageEventInput, cap: number | null): Promise<Exclude<UsageRecordResult, { kind: 'cap_reached' }>> {
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "usage_events" ("id", "occurredAt", "month", "subjectKey", "actorUserId", "organizationId", "kind", "detail", "plan", "door", "entityKey")
    VALUES (${randomUUID()}::uuid, ${event.occurredAt}, ${event.month}, ${event.subjectKey}, ${event.actorUserId}::uuid, ${event.organizationId}::uuid,
            ${event.kind}, ${event.detail}, ${event.plan}, ${event.door}, ${event.entityKey})
    ON CONFLICT ("kind", "entityKey") DO NOTHING
    RETURNING "id"`;
  if (inserted.length === 0) return { kind: 'duplicate' };
  const meter = meterOf(event.kind);
  if (!meter) return { kind: 'recorded', count: null };
  // A cap of 0 (or less) admits nothing, not even the first row, which the INSERT below would write unchecked.
  if (cap !== null && cap <= 0) throw new UsageCapReached(0, cap);
  // Postgres re-checks the WHERE on the conflicting row after locking it: two writers at cap − 1 can't both pass.
  const counted = await tx.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "usage_counters" ("subjectKey", "month", "meter", "count", "plan", "updatedAt")
    VALUES (${event.subjectKey}, ${event.month}, ${meter}, 1, ${event.plan}, ${event.occurredAt})
    ON CONFLICT ("subjectKey", "month", "meter") DO UPDATE
      SET "count" = "usage_counters"."count" + 1, "plan" = EXCLUDED."plan", "updatedAt" = EXCLUDED."updatedAt"
      WHERE ${cap}::int IS NULL OR "usage_counters"."count" < ${cap}::int
    RETURNING "count"`;
  const [row] = counted;
  if (!row) {
    const [current] = await tx.$queryRaw<Array<{ count: number }>>`SELECT "count" FROM "usage_counters" WHERE "subjectKey" = ${event.subjectKey} AND "month" = ${event.month} AND "meter" = ${meter}`;
    throw new UsageCapReached(current?.count ?? 0, cap ?? 0);
  }
  return { kind: 'recorded', count: Number(row.count) };
}

const asPlan = (plan: string): UsagePlan => ((USAGE_PLANS as readonly string[]).includes(plan) ? (plan as UsagePlan) : 'none');

const toCounter = (r: { subjectKey: string; month: string; meter: string; count: number; plan: string }): UsageCounterRecord => ({
  subjectKey: r.subjectKey,
  month: r.month,
  meter: r.meter as UsageMeter,
  count: Number(r.count),
  plan: asPlan(r.plan),
});

/** The thresholds of every capped (plan, meter), as a VALUES list the people and standing reads join. */
function capRows(): Prisma.Sql {
  const rows = USAGE_PLANS.flatMap((plan) => USAGE_METERS.flatMap((meter) => {
    const cap = capOf(plan, meter);
    return cap === null ? [] : [Prisma.sql`(${plan}::text, ${meter}::text, ${cap}::int)`];
  }));
  return Prisma.join(rows);
}

function filterSql(filter: UsagePeopleQuery['filter']): Prisma.Sql {
  switch (filter) {
    case 'near':
      return Prisma.sql`c."count" >= caps.cap * ${NEAR_SHARE}::float AND c."count" < caps.cap`;
    case 'capped':
      return Prisma.sql`c."count" = caps.cap`;
    case 'over':
      return Prisma.sql`c."count" > caps.cap`;
    default:
      return Prisma.sql`TRUE`;
  }
}

export function prismaUsage(prisma: () => PrismaClient): UsageRepository {
  return {
    record: async (event, cap) => {
      try {
        return await prisma().$transaction((tx) => recordUsageTx(tx, event, cap));
      } catch (err) {
        if (err instanceof UsageCapReached) return { kind: 'cap_reached', used: err.used, cap: err.cap };
        throw err;
      }
    },
    countersFor: async (subjectKey, months) => {
      const rows = await prisma().usageCounter.findMany({ where: { subjectKey, month: { in: [...months] } } });
      const found = new Map(rows.map((r) => [`${r.month}:${r.meter}`, toCounter(r)]));
      return months.flatMap((month) => USAGE_METERS.map((meter) => found.get(`${month}:${meter}`) ?? { subjectKey, month, meter, count: 0, plan: 'none' as const }));
    },
    rollup: async (month) => {
      const rows = await prisma().$queryRaw<Array<{ plan: string; kind: string; events: bigint; subjects: bigint }>>`
        SELECT "plan", "kind", count(*) AS events, count(DISTINCT "subjectKey") AS subjects
        FROM "usage_events" WHERE "month" = ${month}
        GROUP BY "plan", "kind" ORDER BY "plan", "kind"`;
      return rows.map((r) => ({ plan: asPlan(r.plan), kind: r.kind as UsageKind, events: Number(r.events), subjects: Number(r.subjects) }));
    },
    standing: async (month) => {
      const rows = await prisma().$queryRaw<Array<{ plan: string; payers: bigint; near: bigint; capped: bigint; over: bigint }>>`
        WITH caps(plan, meter, cap) AS (VALUES ${capRows()}),
        per AS (
          SELECT c."subjectKey", max(c."plan") AS plan,
            bool_or(caps.cap IS NOT NULL AND c."count" >= caps.cap * ${NEAR_SHARE}::float AND c."count" < caps.cap) AS near,
            bool_or(caps.cap IS NOT NULL AND c."count" = caps.cap) AS capped,
            bool_or(caps.cap IS NOT NULL AND c."count" > caps.cap) AS over
          FROM "usage_counters" c LEFT JOIN caps ON caps.plan = c."plan" AND caps.meter = c."meter"
          WHERE c."month" = ${month}
          GROUP BY c."subjectKey"
        )
        SELECT plan, count(*) AS payers, count(*) FILTER (WHERE near) AS near, count(*) FILTER (WHERE capped) AS capped, count(*) FILTER (WHERE over) AS over
        FROM per GROUP BY plan ORDER BY plan`;
      return rows.map((r): UsagePlanStanding => ({ plan: asPlan(r.plan), payers: Number(r.payers), near: Number(r.near), capped: Number(r.capped), over: Number(r.over) }));
    },
    people: async (query): Promise<UsagePeoplePage> => {
      const plan = query.plan ? Prisma.sql`AND c."plan" = ${query.plan}` : Prisma.empty;
      const after = query.after ? Prisma.sql`AND c."subjectKey" COLLATE "C" > ${query.after}` : Prisma.empty;
      const filtered = query.filter
        ? Prisma.sql`JOIN (VALUES ${capRows()}) AS caps(plan, meter, cap) ON caps.plan = c."plan" AND caps.meter = c."meter" AND ${filterSql(query.filter)}`
        : Prisma.empty;
      const keys = await prisma().$queryRaw<Array<{ subjectKey: string }>>`
        SELECT c."subjectKey" FROM "usage_counters" c ${filtered}
        WHERE c."month" = ${query.month} ${plan} ${after}
        GROUP BY c."subjectKey"
        ORDER BY c."subjectKey" COLLATE "C" LIMIT ${query.limit + 1}`;
      const page = keys.slice(0, query.limit).map((k) => k.subjectKey);
      const counters = page.length === 0 ? [] : await prisma().usageCounter.findMany({ where: { month: query.month, subjectKey: { in: page } }, orderBy: [{ meter: 'asc' }] });
      const items = page.map((subjectKey) => {
        const own = counters.filter((c) => c.subjectKey === subjectKey).map(toCounter);
        return { subjectKey, plan: own[0]?.plan ?? ('none' as const), counters: own };
      });
      return { items, nextAfter: keys.length > query.limit ? (page.at(-1) ?? null) : null };
    },
    byProfile: async (subjectKey, months) => {
      const rows = await prisma().usageEvent.groupBy({ by: ['organizationId', 'month', 'kind'], where: { subjectKey, month: { in: [...months] } }, _count: { _all: true }, orderBy: [{ month: 'asc' }, { kind: 'asc' }] });
      return rows.map((r) => ({ organizationId: r.organizationId, month: r.month, kind: r.kind as UsageKind, events: r._count._all }));
    },
    addRouteUsage: async (deltas) => {
      if (deltas.length === 0) return;
      const values = deltas.map((d) => {
        const b = Array.from({ length: BUCKET_COUNT }, (_, i) => d.buckets[i] ?? 0);
        return Prisma.sql`(${d.day}, ${d.routeKey}, ${d.plan}, ${d.statusClass}, ${d.count}::int, ${BigInt(Math.round(d.durationMsSum))}::bigint, ${Prisma.join(b.map((n) => Prisma.sql`${n}::int`))})`;
      });
      const bucketCols = Array.from({ length: BUCKET_COUNT }, (_, i) => `"b${i}"`).join(', ');
      const bucketSets = Array.from({ length: BUCKET_COUNT }, (_, i) => `"b${i}" = "route_usage_daily"."b${i}" + EXCLUDED."b${i}"`).join(', ');
      await prisma().$executeRaw`
        INSERT INTO "route_usage_daily" ("day", "routeKey", "plan", "statusClass", "count", "durationMsSum", ${Prisma.raw(bucketCols)})
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("day", "routeKey", "plan", "statusClass") DO UPDATE SET
          "count" = "route_usage_daily"."count" + EXCLUDED."count",
          "durationMsSum" = "route_usage_daily"."durationMsSum" + EXCLUDED."durationMsSum",
          ${Prisma.raw(bucketSets)}`;
    },
    routeTotals: async (from, to) => {
      const sums = Array.from({ length: BUCKET_COUNT }, (_, i) => `sum("b${i}")::bigint AS "b${i}"`).join(', ');
      const rows = await prisma().$queryRaw<Array<Record<string, bigint | string>>>`
        SELECT "routeKey", "statusClass", sum("count")::bigint AS "count", sum("durationMsSum")::bigint AS "durationMsSum", ${Prisma.raw(sums)}
        FROM "route_usage_daily" WHERE "day" >= ${from} AND "day" <= ${to}
        GROUP BY "routeKey", "statusClass"`;
      return rows.map(
        (r): RouteUsageTotal => ({
          routeKey: String(r.routeKey),
          statusClass: r.statusClass as StatusClass,
          count: Number(r.count),
          durationMsSum: Number(r.durationMsSum),
          buckets: Array.from({ length: BUCKET_COUNT }, (_, i) => Number(r[`b${i}`])),
        }),
      );
    },
    prune: async (before) => {
      const [events, counters, routes] = await prisma().$transaction([
        prisma().usageEvent.deleteMany({ where: { occurredAt: { lt: before.events } } }),
        prisma().usageCounter.deleteMany({ where: { month: { lt: before.countersMonth } } }),
        prisma().routeUsageDaily.deleteMany({ where: { day: { lt: before.routesDay } } }),
      ]);
      return { events: events.count, counters: counters.count, routes: routes.count };
    },
    purgeSubject: async (subjectKey) => {
      const [events, counters] = await prisma().$transaction([prisma().usageEvent.deleteMany({ where: { subjectKey } }), prisma().usageCounter.deleteMany({ where: { subjectKey } })]);
      return { events: events.count, counters: counters.count };
    },
  };
}
