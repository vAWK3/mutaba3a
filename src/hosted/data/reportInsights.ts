import type { Stage } from './reports';

/**
 * Reports' insights (MUT-175): deterministic rules, no LLM (the MUT-252
 * privacy line). They describe the latest complete months only, so they never
 * change while the person steps through periods (DR16). Copy is factual and
 * never judges (DR19). Amounts are minor units in one unit currency (D3); the
 * page formats them.
 */

/** One complete month, in the unit currency's minor units. */
export interface MonthPoint {
  month: string;
  received: number;
  spent: number;
  categories: ReadonlyArray<{ key: string; name: string; amount: number }>;
  /** `none` marks money with no client: counted in totals, never named as a top client. */
  clients: ReadonlyArray<{ key: string; name: string; amount: number; none?: boolean }>;
}

export type InsightValue = { kind: 'money'; minor: number } | { kind: 'month'; month: string } | { kind: 'text'; text: string } | { kind: 'percent'; value: number };

/** One sentence: an i18n key under `hosted.reports`, its values, and a count for `tp` plurals. */
export interface InsightPart {
  key: string;
  values: Record<string, InsightValue>;
  count?: number;
}

export type InsightKind = 'recap' | 'mover' | 'concentration' | 'daysToPaid' | 'best' | 'trend' | 'average';

export interface Insight {
  id: InsightKind;
  parts: InsightPart[];
  /** What the insight says, as an id: when it changes, the insight ranks first (DR18). */
  fact: string;
  weight: number;
}

export interface InsightInput {
  stage: Stage;
  /** Complete months, oldest first. */
  months: readonly MonthPoint[];
  /** The median days to get paid, or null below the server's sample minimum (D2). */
  daysToPaid: number | null;
}

/** A category's change must be at least this share of the month's spending… */
export const MOVER_MIN_SHARE = 0.1;
/** …and at least this change on its own previous amount. */
export const MOVER_MIN_PCT = 0.25;
/** A client paying at least this share of the last months' received is named. */
export const CONCENTRATION_SHARE = 0.35;
/** Received moving at least this much month on month is a trend worth a sentence. */
export const TREND_MIN_PCT = 0.1;
/** The average and the concentration look at this many latest complete months. */
export const RECENT_MONTHS = 3;
/** The best month needs at least this many complete months to mean anything. */
export const BEST_MIN_MONTHS = 3;
export const MAX_INSIGHTS = 3;
/** A fact shown on this many earlier visits ranks below fresh ones (DR18). */
export const STALE_AFTER_VIEWS = 3;
/** DR29: the order of kinds, before size. */
const KIND_ORDER: readonly InsightKind[] = ['recap', 'mover', 'concentration', 'daysToPaid', 'best', 'trend', 'average'];
const PERCENT = 100;

const money = (minor: number): InsightValue => ({ kind: 'money', minor });
const monthValue = (month: string): InsightValue => ({ kind: 'month', month });
const text = (value: string): InsightValue => ({ kind: 'text', text: value });

const largest = <T extends { amount: number }>(rows: readonly T[]): T | undefined => [...rows].sort((a, b) => b.amount - a.amount)[0];

function recap(m: MonthPoint): Insight {
  const parts: InsightPart[] = [{ key: 'insights.recap.base', values: { month: monthValue(m.month), received: money(m.received), spent: money(m.spent) } }];
  const category = largest(m.categories.filter((c) => c.amount > 0));
  if (category) parts.push({ key: 'insights.recap.topCategory', values: { category: text(category.name) } });
  const client = largest(m.clients.filter((c) => !c.none && c.amount > 0));
  if (client) parts.push({ key: 'insights.recap.topClient', values: { client: text(client.name) } });
  return { id: 'recap', parts, fact: m.month, weight: m.received };
}

function mover(previous: MonthPoint, latest: MonthPoint): Insight | null {
  const keys = new Set([...previous.categories, ...latest.categories].map((c) => c.key));
  const floor = MOVER_MIN_SHARE * Math.max(previous.spent, latest.spent);
  const candidates = [...keys].flatMap((key) => {
    const before = previous.categories.find((c) => c.key === key)?.amount ?? 0;
    const now = latest.categories.find((c) => c.key === key);
    const after = now?.amount ?? 0;
    const delta = after - before;
    const bigEnough = Math.abs(delta) >= floor && (before === 0 ? after > 0 : Math.abs(delta) / before >= MOVER_MIN_PCT);
    const name = now?.name ?? previous.categories.find((c) => c.key === key)!.name;
    return delta !== 0 && bigEnough ? [{ key, name, after, delta }] : [];
  });
  const top = [...candidates].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (!top) return null;
  const direction = top.delta > 0 ? 'up' : 'down';
  return {
    id: 'mover',
    parts: [{ key: `insights.mover.${direction}`, values: { category: text(top.name), amount: money(top.after), month: monthValue(latest.month), delta: money(Math.abs(top.delta)), previous: monthValue(previous.month) } }],
    fact: `${top.key}:${direction}:${latest.month}`,
    weight: Math.abs(top.delta),
  };
}

function concentration(recent: readonly MonthPoint[]): Insight | null {
  const total = recent.reduce((sum, m) => sum + m.received, 0);
  if (total <= 0) return null;
  const byClient = new Map<string, { name: string; amount: number }>();
  for (const m of recent) for (const c of m.clients) {
    if (c.none) continue;
    byClient.set(c.key, { name: c.name, amount: (byClient.get(c.key)?.amount ?? 0) + c.amount });
  }
  const [key, top] = [...byClient.entries()].sort(([, a], [, b]) => b.amount - a.amount)[0] ?? [];
  if (!key || !top || top.amount / total < CONCENTRATION_SHARE) return null;
  const percent = Math.round((top.amount / total) * PERCENT);
  return { id: 'concentration', parts: [{ key: 'insights.concentration', values: { client: text(top.name), percent: { kind: 'percent', value: percent } } }], fact: key, weight: top.amount };
}

function daysToPaid(days: number): Insight {
  const part: InsightPart = days === 0 ? { key: 'insights.daysToPaidSameDay', values: {} } : { key: 'insights.daysToPaid', values: {}, count: days };
  return { id: 'daysToPaid', parts: [part], fact: String(days), weight: days };
}

function best(months: readonly MonthPoint[]): Insight | null {
  if (months.length < BEST_MIN_MONTHS) return null;
  const top = [...months].sort((a, b) => b.received - a.received || (a.month < b.month ? 1 : -1))[0]!;
  if (top.received <= 0) return null;
  return { id: 'best', parts: [{ key: 'insights.best', values: { month: monthValue(top.month), amount: money(top.received) } }], fact: top.month, weight: top.received };
}

function trend(previous: MonthPoint, latest: MonthPoint): Insight | null {
  const delta = latest.received - previous.received;
  if (delta === 0 || previous.received <= 0 || Math.abs(delta) / previous.received < TREND_MIN_PCT) return null;
  const direction = delta > 0 ? 'up' : 'down';
  return {
    id: 'trend',
    parts: [{ key: `insights.trend.${direction}`, values: { month: monthValue(latest.month), amount: money(latest.received), delta: money(Math.abs(delta)), previous: monthValue(previous.month) } }],
    fact: `${latest.month}:${direction}`,
    weight: Math.abs(delta),
  };
}

function average(months: readonly MonthPoint[]): Insight | null {
  if (months.length < RECENT_MONTHS) return null;
  const recent = months.slice(-RECENT_MONTHS);
  const mean = Math.round(recent.reduce((sum, m) => sum + m.received, 0) / RECENT_MONTHS);
  if (mean <= 0) return null;
  return { id: 'average', parts: [{ key: 'insights.average', values: { amount: money(mean) } }], fact: String(mean), weight: mean };
}

function candidates({ stage, months, daysToPaid: days }: InsightInput): Insight[] {
  if (stage === 1 || months.length === 0) return [];
  if (stage === 2) return [recap(months[0]!)];
  const latest = months.at(-1)!;
  const previous = months.at(-2);
  return [
    previous ? mover(previous, latest) : null,
    concentration(months.slice(-RECENT_MONTHS)),
    days === null ? null : daysToPaid(days),
    best(months),
    previous ? trend(previous, latest) : null,
    average(months),
  ].filter((i): i is Insight => i !== null);
}

export type SeenInsights = Readonly<Record<string, { fact: string; views: number }>>;

/** DR18: 0 = a changed fact, 1 = fresh, 2 = the same fact seen on enough earlier visits. */
function tier(insight: Insight, seen: SeenInsights): number {
  const before = seen[insight.id];
  if (!before) return 1;
  if (before.fact !== insight.fact) return 0;
  return before.views >= STALE_AFTER_VIEWS ? 2 : 1;
}

/** Up to three insights: changed facts first, then by kind (DR29), then by size. */
export function buildInsights(input: InsightInput, seen: SeenInsights = {}): Insight[] {
  return candidates(input)
    .sort((a, b) => tier(a, seen) - tier(b, seen) || KIND_ORDER.indexOf(a.id) - KIND_ORDER.indexOf(b.id) || b.weight - a.weight)
    .slice(0, MAX_INSIGHTS);
}

/** Counts a visit for each shown insight; a changed fact starts its count again. */
export function recordViews(seen: SeenInsights, shown: readonly Insight[]): SeenInsights {
  const next: Record<string, { fact: string; views: number }> = { ...seen };
  for (const insight of shown) {
    const before = seen[insight.id];
    next[insight.id] = before && before.fact === insight.fact ? { fact: insight.fact, views: before.views + 1 } : { fact: insight.fact, views: 1 };
  }
  return next;
}
