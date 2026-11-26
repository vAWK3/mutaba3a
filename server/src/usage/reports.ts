import type { IsoDate, IsoMonth } from '../dates.js';
import type { LedgerStore, RouteUsageTotal, UsageCounterRecord, UsagePeopleFilter, UsagePlanStanding, UsageRollupRow } from '../repositories/ports.js';
import { meterView, type MeterView } from './caps.js';
import { USAGE_METERS, type UsageKind, type UsagePlan } from './kinds.js';
import { lastMonths } from './month.js';
import { p95Of } from './route-buckets.js';
import { userIdOfSubject, userSubjectKey } from './subject.js';

/**
 * MUT-735 (ADR-281): the operator's usage reports, read from the ledger (never PostHog, ADR-090). Each is a few grouped
 * reads; the CSV export writes the same rows.
 */

type ReportStore = Pick<LedgerStore, 'usage' | 'users' | 'organizations'>;

export interface PlanOverview extends UsagePlanStanding {
  kinds: Array<{ kind: UsageKind; events: number; payers: number }>;
}

/** Per plan: payers this month, near / at / over a cap, and events per kind. */
export async function usageOverview(store: ReportStore, month: IsoMonth): Promise<PlanOverview[]> {
  const [rollup, standing] = await Promise.all([store.usage.rollup(month), store.usage.standing(month)]);
  const plans = new Map<UsagePlan, PlanOverview>();
  const planOf = (plan: UsagePlan) => {
    let p = plans.get(plan);
    if (!p) {
      p = { plan, payers: 0, near: 0, capped: 0, over: 0, kinds: [] };
      plans.set(plan, p);
    }
    return p;
  };
  for (const s of standing) Object.assign(planOf(s.plan), s);
  for (const r of rollup as UsageRollupRow[]) planOf(r.plan).kinds.push({ kind: r.kind, events: r.events, payers: r.subjects });
  return [...plans.values()].sort((a, b) => a.plan.localeCompare(b.plan));
}

export interface UsagePerson {
  subjectKey: string;
  userId: string | null;
  /** The person's email, or for an owner-less firm null. */
  email: string | null;
  /** The person's display name, or the firm's name. */
  name: string;
  plan: UsagePlan;
  meters: MeterView[];
}

function metersOf(counters: readonly UsageCounterRecord[], plan: UsagePlan): MeterView[] {
  return USAGE_METERS.map((meter) => meterView(meter, counters.find((c) => c.meter === meter)?.count ?? 0, plan));
}

/** The people list ("upgrade leads"): payers with counters this month, filtered, keyset-paged. */
export async function usagePeople(
  store: ReportStore,
  query: { month: IsoMonth; plan?: UsagePlan; filter?: UsagePeopleFilter; limit: number; after: string | null },
): Promise<{ items: UsagePerson[]; nextCursor: string | null }> {
  const page = await store.usage.people(query);
  const items = await Promise.all(
    page.items.map(async ({ subjectKey, plan, counters }): Promise<UsagePerson> => {
      const userId = userIdOfSubject(subjectKey);
      const user = userId ? await store.users.getById(userId) : null;
      const firm = userId ? null : await store.organizations.getById(subjectKey.slice('org:'.length));
      return { subjectKey, userId, email: user?.email ?? null, name: user?.displayName ?? firm?.name ?? subjectKey, plan, meters: metersOf(counters, plan) };
    }),
  );
  return { items, nextCursor: page.nextAfter };
}

export interface AccountUsage {
  months: Array<{ month: IsoMonth; plan: UsagePlan; meters: MeterView[] }>;
  profiles: Array<{ organizationId: string | null; name: string | null; months: Array<{ month: IsoMonth; documents: number; scans: number; other: number }> }>;
}

/** One account's last `n` months: its meters against the plan it had, and its documents and scans per profile. */
export async function accountUsage(store: ReportStore, userId: string, month: IsoMonth, n = 6): Promise<AccountUsage> {
  const months = lastMonths(month, n);
  const subjectKey = userSubjectKey(userId);
  const [counters, rows] = await Promise.all([store.usage.countersFor(subjectKey, months), store.usage.byProfile(subjectKey, months)]);
  const byMonth = months.map((m) => {
    const own = counters.filter((c) => c.month === m);
    // The plan the month's last count was made under; a month with no count shows none.
    const plan = own.find((c) => c.plan !== 'none')?.plan ?? 'none';
    return { month: m, plan, meters: metersOf(own, plan) };
  });
  const ids = [...new Set(rows.map((r) => r.organizationId))];
  const names = new Map(await Promise.all(ids.map(async (id) => [id, id ? ((await store.organizations.getById(id))?.name ?? null) : null] as const)));
  const profiles = ids.map((organizationId) => ({
    organizationId,
    name: names.get(organizationId) ?? null,
    months: months.map((m) => {
      const of = rows.filter((r) => r.organizationId === organizationId && r.month === m);
      const sum = (pick: (k: UsageKind) => boolean) => of.filter((r) => pick(r.kind)).reduce((total, r) => total + r.events, 0);
      return { month: m, documents: sum((k) => k === 'DOCUMENT_ISSUED'), scans: sum((k) => k === 'SCAN'), other: sum((k) => k !== 'DOCUMENT_ISSUED' && k !== 'SCAN') };
    }),
  }));
  return { months: byMonth, profiles };
}

export interface RouteReportRow {
  routeKey: string;
  count: number;
  clientErrors: number;
  serverErrors: number;
  meanMs: number;
  p95Ms: number | null;
  /** p95 fell in the last bucket: more than 10 s. */
  p95Over: boolean;
}

/** Number of routes the report keeps, busiest first. */
export const TOP_ROUTES = 50;

/** Every route over [from, to], its status classes together: volume, errors, mean and p95 (from the buckets). */
export function routeReport(totals: readonly RouteUsageTotal[]): RouteReportRow[] {
  const routes = new Map<string, { count: number; clientErrors: number; serverErrors: number; durationMsSum: number; buckets: number[] }>();
  for (const t of totals) {
    const r = routes.get(t.routeKey) ?? { count: 0, clientErrors: 0, serverErrors: 0, durationMsSum: 0, buckets: t.buckets.map(() => 0) };
    r.count += t.count;
    r.durationMsSum += t.durationMsSum;
    if (t.statusClass === '4xx') r.clientErrors += t.count;
    if (t.statusClass === '5xx') r.serverErrors += t.count;
    r.buckets = r.buckets.map((n, i) => n + (t.buckets[i] ?? 0));
    routes.set(t.routeKey, r);
  }
  return [...routes.entries()]
    .map(([routeKey, r]) => {
      const p95 = p95Of(r.buckets);
      return { routeKey, count: r.count, clientErrors: r.clientErrors, serverErrors: r.serverErrors, meanMs: r.count ? Math.round(r.durationMsSum / r.count) : 0, p95Ms: p95?.p95Ms ?? null, p95Over: p95?.over ?? false };
    })
    .sort((a, b) => b.count - a.count || a.routeKey.localeCompare(b.routeKey))
    .slice(0, TOP_ROUTES);
}

export async function usageRoutes(store: ReportStore, from: IsoDate, to: IsoDate): Promise<RouteReportRow[]> {
  return routeReport(await store.usage.routeTotals(from, to));
}

// ---- CSV ----------------------------------------------------------------------------------------------------------

/** UTF-8 with a byte-order mark, so a spreadsheet opens Arabic names right. */
export const CSV_BOM = '﻿';

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  return CSV_BOM + [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function overviewCsv(month: IsoMonth, plans: readonly PlanOverview[]): string {
  const rows = plans.flatMap((p) => (p.kinds.length > 0 ? p.kinds : [{ kind: '', events: 0, payers: 0 }]).map((k) => [month, p.plan, p.payers, p.near, p.capped, p.over, k.kind, k.events, k.payers]));
  return toCsv(['month', 'plan', 'payers', 'near', 'capped', 'over', 'kind', 'events', 'kind_payers'], rows);
}

export function peopleCsv(month: IsoMonth, people: readonly UsagePerson[]): string {
  const rows = people.map((p) => {
    const m = (meter: 'documents' | 'scans') => p.meters.find((v) => v.meter === meter)!;
    return [month, p.name, p.email, p.plan, m('documents').used, m('documents').limit, m('documents').level, m('scans').used, m('scans').limit, m('scans').level];
  });
  return toCsv(['month', 'name', 'email', 'plan', 'documents', 'documents_limit', 'documents_level', 'scans', 'scans_limit', 'scans_level'], rows);
}

export function routesCsv(from: IsoDate, to: IsoDate, routes: readonly RouteReportRow[]): string {
  return toCsv(
    ['from', 'to', 'route', 'requests', 'client_errors', 'server_errors', 'mean_ms', 'p95_ms', 'p95_over_10s'],
    routes.map((r) => [from, to, r.routeKey, r.count, r.clientErrors, r.serverErrors, r.meanMs, r.p95Ms, r.p95Over ? 'yes' : 'no']),
  );
}
