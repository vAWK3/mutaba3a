import { capOf, NEAR_SHARE } from '../usage/caps.js';
import { meterOf, USAGE_METERS, type UsageMeter } from '../usage/kinds.js';
import { BUCKET_COUNT } from '../usage/route-buckets.js';
import type {
  RouteUsageDelta,
  RouteUsageTotal,
  UsageCounterRecord,
  UsageEventInput,
  UsagePeopleQuery,
  UsagePlanStanding,
  UsageRecordResult,
  UsageRepository,
} from './ports.js';

/**
 * MUT-735 (ADR-281): the usage ledger in memory, one definition with the Postgres one (the shared contract tests).
 * `recordNow` is synchronous: the memory store's issue and receipt writes call it with no await in between, its stand-in
 * for "the same transaction". At a cap it refuses before writing anything (the memory store has no rollback).
 */
export class MemoryUsage implements UsageRepository {
  private readonly events = new Map<string, UsageEventInput>();
  private readonly counters = new Map<string, UsageCounterRecord>();
  private readonly routes = new Map<string, RouteUsageDelta>();

  recordNow(event: UsageEventInput, cap: number | null): UsageRecordResult {
    const eventKey = `${event.kind}:${event.entityKey}`;
    if (this.events.has(eventKey)) return { kind: 'duplicate' };
    const meter = meterOf(event.kind);
    const counterKey = meter ? `${event.subjectKey}:${event.month}:${meter}` : null;
    const current = counterKey ? this.counters.get(counterKey) : undefined;
    const used = current?.count ?? 0;
    if (meter && cap !== null && used >= cap) return { kind: 'cap_reached', used, cap };
    this.events.set(eventKey, { ...event });
    if (!meter || !counterKey) return { kind: 'recorded', count: null };
    this.counters.set(counterKey, { subjectKey: event.subjectKey, month: event.month, meter, count: used + 1, plan: event.plan });
    return { kind: 'recorded', count: used + 1 };
  }

  /** Test seam: every event recorded, oldest first. */
  allEvents(): UsageEventInput[] {
    return [...this.events.values()].map((e) => ({ ...e }));
  }

  readonly record: UsageRepository['record'] = async (event, cap) => this.recordNow(event, cap);

  readonly countersFor: UsageRepository['countersFor'] = async (subjectKey, months) =>
    months.flatMap((month) => USAGE_METERS.map((meter) => ({ ...(this.counters.get(`${subjectKey}:${month}:${meter}`) ?? { subjectKey, month, meter, count: 0, plan: 'none' as const }) })));

  readonly rollup: UsageRepository['rollup'] = async (month) => {
    const groups = new Map<string, { plan: UsageEventInput['plan']; kind: UsageEventInput['kind']; events: number; subjects: Set<string> }>();
    for (const e of this.events.values()) {
      if (e.month !== month) continue;
      const key = `${e.plan}:${e.kind}`;
      const g = groups.get(key) ?? { plan: e.plan, kind: e.kind, events: 0, subjects: new Set<string>() };
      g.events += 1;
      g.subjects.add(e.subjectKey);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.plan.localeCompare(b.plan) || a.kind.localeCompare(b.kind)).map((g) => ({ plan: g.plan, kind: g.kind, events: g.events, subjects: g.subjects.size }));
  };

  private monthCounters(month: string): UsageCounterRecord[] {
    return [...this.counters.values()].filter((c) => c.month === month);
  }

  readonly standing: UsageRepository['standing'] = async (month) => {
    const per = new Map<string, { plan: UsageCounterRecord['plan']; near: boolean; capped: boolean; over: boolean }>();
    for (const c of this.monthCounters(month)) {
      const p = per.get(c.subjectKey) ?? { plan: c.plan, near: false, capped: false, over: false };
      if (c.plan > p.plan) p.plan = c.plan; // the same pick as Postgres's max(plan)
      p.near ||= matches(c, 'near');
      p.capped ||= matches(c, 'capped');
      p.over ||= matches(c, 'over');
      per.set(c.subjectKey, p);
    }
    const plans = new Map<string, UsagePlanStanding>();
    for (const p of per.values()) {
      const s = plans.get(p.plan) ?? { plan: p.plan, payers: 0, near: 0, capped: 0, over: 0 };
      s.payers += 1;
      s.near += Number(p.near);
      s.capped += Number(p.capped);
      s.over += Number(p.over);
      plans.set(p.plan, s);
    }
    return [...plans.values()].sort((a, b) => a.plan.localeCompare(b.plan));
  };

  readonly people: UsageRepository['people'] = async (query) => {
    const counters = this.monthCounters(query.month).filter((c) => !query.plan || c.plan === query.plan);
    const keys = [...new Set(counters.filter((c) => !query.filter || matches(c, query.filter)).map((c) => c.subjectKey))]
      .filter((k) => query.after === null || k > query.after)
      .sort();
    const page = keys.slice(0, query.limit);
    const meterOrder = (m: UsageMeter) => m;
    const items = page.map((subjectKey) => {
      const own = this.monthCounters(query.month)
        .filter((c) => c.subjectKey === subjectKey)
        .sort((a, b) => meterOrder(a.meter).localeCompare(meterOrder(b.meter)))
        .map((c) => ({ ...c }));
      return { subjectKey, plan: own[0]?.plan ?? ('none' as const), counters: own };
    });
    return { items, nextAfter: keys.length > query.limit ? (page.at(-1) ?? null) : null };
  };

  readonly byProfile: UsageRepository['byProfile'] = async (subjectKey, months) => {
    const groups = new Map<string, { organizationId: string | null; month: string; kind: UsageEventInput['kind']; events: number }>();
    for (const e of this.events.values()) {
      if (e.subjectKey !== subjectKey || !months.includes(e.month)) continue;
      const key = `${e.organizationId}:${e.month}:${e.kind}`;
      const g = groups.get(key) ?? { organizationId: e.organizationId, month: e.month, kind: e.kind, events: 0 };
      g.events += 1;
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.kind.localeCompare(b.kind));
  };

  readonly addRouteUsage: UsageRepository['addRouteUsage'] = async (deltas) => {
    for (const d of deltas) {
      const key = `${d.day}|${d.routeKey}|${d.plan}|${d.statusClass}`;
      const row = this.routes.get(key) ?? { ...d, count: 0, durationMsSum: 0, buckets: Array.from({ length: BUCKET_COUNT }, () => 0) };
      row.count += d.count;
      row.durationMsSum += Math.round(d.durationMsSum);
      row.buckets = row.buckets.map((n, i) => n + (d.buckets[i] ?? 0));
      this.routes.set(key, row);
    }
  };

  readonly routeTotals: UsageRepository['routeTotals'] = async (from, to) => {
    const totals = new Map<string, RouteUsageTotal>();
    for (const r of this.routes.values()) {
      if (r.day < from || r.day > to) continue;
      const key = `${r.routeKey}|${r.statusClass}`;
      const t = totals.get(key) ?? { routeKey: r.routeKey, statusClass: r.statusClass, count: 0, durationMsSum: 0, buckets: Array.from({ length: BUCKET_COUNT }, () => 0) };
      t.count += r.count;
      t.durationMsSum += r.durationMsSum;
      t.buckets = t.buckets.map((n, i) => n + (r.buckets[i] ?? 0));
      totals.set(key, t);
    }
    return [...totals.values()];
  };

  readonly prune: UsageRepository['prune'] = async (before) => {
    const removed = { events: 0, counters: 0, routes: 0 };
    for (const [k, e] of this.events) {
      if (!(e.occurredAt < before.events)) continue;
      this.events.delete(k);
      removed.events += 1;
    }
    for (const [k, c] of this.counters) {
      if (!(c.month < before.countersMonth)) continue;
      this.counters.delete(k);
      removed.counters += 1;
    }
    for (const [k, r] of this.routes) {
      if (!(r.day < before.routesDay)) continue;
      this.routes.delete(k);
      removed.routes += 1;
    }
    return removed;
  };

  /** Account purge (MUT-333): what Postgres does in the purge transaction (PURGE_PROFILE_TABLES, PURGE_UNKEYED_USER_COLUMNS). */
  forgetPerson(userId: string, deletedProfileIds: ReadonlySet<string>): void {
    const subjectKey = `user:${userId}`;
    for (const [k, e] of this.events) {
      if (e.subjectKey === subjectKey || (e.organizationId !== null && deletedProfileIds.has(e.organizationId))) this.events.delete(k);
      else if (e.actorUserId === userId) e.actorUserId = null;
    }
    for (const [k, c] of this.counters) if (c.subjectKey === subjectKey) this.counters.delete(k);
  }

  readonly purgeSubject: UsageRepository['purgeSubject'] = async (subjectKey) => {
    const removed = { events: 0, counters: 0 };
    for (const [k, e] of this.events) {
      if (!(e.subjectKey === subjectKey)) continue;
      this.events.delete(k);
      removed.events += 1;
    }
    for (const [k, c] of this.counters) {
      if (!(c.subjectKey === subjectKey)) continue;
      this.counters.delete(k);
      removed.counters += 1;
    }
    return removed;
  };
}

function matches(c: UsageCounterRecord, filter: NonNullable<UsagePeopleQuery['filter']>): boolean {
  const cap = capOf(c.plan, c.meter);
  if (cap === null) return false;
  if (filter === 'near') return c.count >= cap * NEAR_SHARE && c.count < cap;
  if (filter === 'capped') return c.count === cap;
  return c.count > cap;
}
