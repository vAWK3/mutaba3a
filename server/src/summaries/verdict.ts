import { addMonths, endOfMonth, monthOf, type IsoDate, type IsoMonth } from '../dates.js';
import { convertToBase, type FxRate } from '../fx-rates.js';
import { formatMoney, parseMoney, type Currency } from '../money.js';
import type { ReceivableRecord } from '../repositories/ports.js';
import type { ActivitySummary, CurrencyActivity } from './activity.js';
import { countsOn, outstandingOf } from './compute.js';
import { firstCountedMonth } from './months.js';

/**
 * MUT-447: the verdict behind Reports' Glance — one line per profile a person holds, and what they kept, across
 * profiles and currencies (design R1–R8, eng review D2–D12). Pure: the route reads and posts, this shapes.
 *
 * Kept = Σ over every included profile of (received − spent). A business's net minus a personal profile's spending
 * plus its "came in" is that same sum; only the clients show a personal profile as "spent". Currencies are never
 * summed (ADR-004): every figure is per currency, plus one converted figure in `base` at one rate set (R4).
 */

export type VerdictProfileKind = 'BUSINESS' | 'PERSONAL' | 'FIRM';

/** Months before the period that "usual" may look at (R8). */
export const USUAL_MONTHS = 6;
/** Below this many complete months, there is no usual (R8, ADR-189 D3's stage rule). */
export const MIN_USUAL_MONTHS = 3;

export interface OwedBlock {
  currency: Currency;
  outstanding: string;
  overdue: string;
}

export interface Owed {
  currencies: OwedBlock[];
  overdueCount: number;
}

export interface VerdictProfileInput {
  profileId: string;
  name: string;
  kind: VerdictProfileKind;
  shared: boolean;
  createdAt: Date;
  defaultCurrency: Currency;
  timezone: string;
  /** Records exist before the read window (the activity route's earlierData, D9). */
  earlierData: boolean;
  activity: Pick<ActivitySummary, 'currencies' | 'history' | 'dataSince'>;
  owed: Owed;
}

export interface VerdictInput {
  from: IsoDate;
  to: IsoDate;
  base: Currency;
  /** null = no usable rates (D4): converted figures are null unless everything is already in `base`. */
  rates: readonly FxRate[] | null;
  profiles: readonly VerdictProfileInput[];
}

type Flow = { received: string; spent: string; net: string };

export interface VerdictProfile {
  profileId: string;
  name: string;
  kind: VerdictProfileKind;
  shared: boolean;
  currencies: Array<{ currency: Currency } & Flow>;
  converted: Flow | null;
  history: ActivitySummary['history'];
  owed: Owed;
}

export interface Verdict {
  base: Currency;
  profiles: VerdictProfile[];
  total: {
    label: 'kept' | 'businessNet';
    currencies: Array<{ currency: Currency; net: string }>;
    converted: string | null;
    inCurrencyOnly: Currency | null;
    sharedInFull: boolean;
  };
  usual: string | null;
  owed: Owed & { converted: string | null };
}

type Minor = { currency: Currency; minor: bigint };

export function composeVerdict(input: VerdictInput): Verdict {
  const { base, rates } = input;
  const fmt = (minor: bigint | null): string | null => (minor === null ? null : formatMoney({ minor, currency: base }));
  const profiles = input.profiles.map((p) => profileLine(p, base, rates));
  const net = sumByCurrency(input.profiles.flatMap((p) => p.activity.currencies.map((c) => ({ currency: c.currency, minor: netOf(c) }))));
  const converted = convertToBase(net, rates, base);
  const owedOutstanding = sumByCurrency(input.profiles.flatMap((p) => p.owed.currencies.map((o) => ({ currency: o.currency, minor: parseMoney(o.outstanding, o.currency).minor }))));
  const owedOverdue = sumByCurrency(input.profiles.flatMap((p) => p.owed.currencies.map((o) => ({ currency: o.currency, minor: parseMoney(o.overdue, o.currency).minor }))));
  return {
    base,
    profiles,
    total: {
      label: input.profiles.some((p) => p.kind === 'PERSONAL') ? 'kept' : 'businessNet',
      currencies: net.map(({ currency, minor }) => ({ currency, net: formatMoney({ minor, currency }) })),
      converted: fmt(converted),
      inCurrencyOnly: converted === null ? busiestCurrency(input.profiles.flatMap((p) => p.activity.currencies)) : null,
      sharedInFull: input.profiles.some((p) => p.shared),
    },
    usual: fmt(usualOf(input)),
    owed: {
      currencies: owedOutstanding.map(({ currency, minor }) => ({
        currency,
        outstanding: formatMoney({ minor, currency }),
        overdue: formatMoney({ minor: owedOverdue.find((o) => o.currency === currency)?.minor ?? 0n, currency }),
      })),
      converted: fmt(convertToBase(owedOutstanding, rates, base)),
      overdueCount: input.profiles.reduce((n, p) => n + p.owed.overdueCount, 0),
    },
  };
}

function profileLine(p: VerdictProfileInput, base: Currency, rates: readonly FxRate[] | null): VerdictProfile {
  const minors = p.activity.currencies.map((c) => ({ currency: c.currency, received: parseMoney(c.received, c.currency).minor, spent: parseMoney(c.spent, c.currency).minor }));
  const received = convertToBase(minors.map((m) => ({ currency: m.currency, minor: m.received })), rates, base);
  const spent = convertToBase(minors.map((m) => ({ currency: m.currency, minor: m.spent })), rates, base);
  const fmt = (minor: bigint) => formatMoney({ minor, currency: base });
  return {
    profileId: p.profileId,
    name: p.name,
    kind: p.kind,
    shared: p.shared,
    currencies: minors.map((m) => ({
      currency: m.currency,
      received: formatMoney({ minor: m.received, currency: m.currency }),
      spent: formatMoney({ minor: m.spent, currency: m.currency }),
      net: formatMoney({ minor: m.received - m.spent, currency: m.currency }),
    })),
    converted: received === null || spent === null ? null : { received: fmt(received), spent: fmt(spent), net: fmt(received - spent) },
    history: p.activity.history,
    owed: p.owed,
  };
}

function netOf(c: Pick<CurrencyActivity, 'currency' | 'received' | 'spent'>): bigint {
  return parseMoney(c.received, c.currency).minor - parseMoney(c.spent, c.currency).minor;
}

/** One entry per currency, in code order (as every summary lists them). */
function sumByCurrency(amounts: readonly Minor[]): Minor[] {
  const totals = new Map<Currency, bigint>();
  for (const { currency, minor } of amounts) totals.set(currency, (totals.get(currency) ?? 0n) + minor);
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => ({ currency, minor }));
}

/** ADR-189 D3: without rates, the currency with the most records in view is the one shown "only". */
function busiestCurrency(blocks: readonly CurrencyActivity[]): Currency | null {
  const rows = new Map<Currency, number>();
  for (const b of blocks) {
    const count = [...b.byCustomer, ...b.byCategory].reduce((n, x) => n + x.count, 0);
    rows.set(b.currency, (rows.get(b.currency) ?? 0) + count);
  }
  let best: Currency | null = null;
  for (const [currency, count] of [...rows.entries()].sort(([a], [b]) => a.localeCompare(b))) if (best === null || count > rows.get(best)!) best = currency;
  return best;
}

/** R4: the oldest personal profile, else the oldest profile; null with none. */
export function baseProfileOf<P extends Pick<VerdictProfileInput, 'kind' | 'createdAt'>>(profiles: readonly P[]): P | null {
  const oldest = (list: readonly P[]) => list.reduce<P | null>((a, p) => (a === null || p.createdAt.getTime() < a.createdAt.getTime() ? p : a), null);
  return oldest(profiles.filter((p) => p.kind === 'PERSONAL')) ?? oldest(profiles);
}

/** True when from–to is exactly one calendar month (X4: usual is shown for Month only). */
export function isCalendarMonth(from: IsoDate, to: IsoDate): boolean {
  return from === `${monthOf(from)}-01` && to === endOfMonth(from);
}

/**
 * R8 with D9 and D11: the median kept over the up to USUAL_MONTHS months before the period, counting a month only when
 * every profile was complete in it (earlier data, or records that began by the month's 7th day). Null below
 * MIN_USUAL_MONTHS, outside a calendar month, or when a month needs a rate that is missing.
 */
function usualOf(input: VerdictInput): bigint | null {
  if (!isCalendarMonth(input.from, input.to)) return null;
  const months = Array.from({ length: USUAL_MONTHS }, (_, i) => addMonths(monthOf(input.from), i - USUAL_MONTHS)).filter((month) =>
    input.profiles.every((p) => completeIn(p, month)),
  );
  if (months.length < MIN_USUAL_MONTHS) return null;
  const kept: bigint[] = [];
  for (const month of months) {
    const blocks = input.profiles.flatMap((p) => p.activity.history.find((h) => h.month === month)?.currencies ?? []);
    const converted = convertToBase(sumByCurrency(blocks.map((c) => ({ currency: c.currency, minor: netOf(c) }))), input.rates, input.base);
    if (converted === null) return null;
    kept.push(converted);
  }
  return median(kept);
}

function completeIn(p: VerdictProfileInput, month: IsoMonth): boolean {
  if (p.earlierData) return true;
  return p.activity.dataSince !== null && firstCountedMonth(p.activity.dataSince) <= month;
}

function median(values: readonly bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return BigInt(Math.round(Number(sorted[mid - 1]! + sorted[mid]!) / 2));
}

/** One profile's open balance per currency as of `today`, with how many entries are overdue (the Overview's rules). */
export function owedOf(receivables: readonly ReceivableRecord[], today: IsoDate): Owed {
  const outstanding = new Map<Currency, bigint>();
  const overdue = new Map<Currency, bigint>();
  let overdueCount = 0;
  for (const r of receivables) {
    if (r.status !== 'OPEN' || !countsOn(r, today)) continue;
    const o = outstandingOf(r);
    if (o <= 0n) continue;
    const currency = r.currency as Currency;
    outstanding.set(currency, (outstanding.get(currency) ?? 0n) + o);
    if (r.dueDate < today) {
      overdue.set(currency, (overdue.get(currency) ?? 0n) + o);
      overdueCount += 1;
    }
  }
  return {
    currencies: [...outstanding.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, minor]) => ({ currency, outstanding: formatMoney({ minor, currency }), overdue: formatMoney({ minor: overdue.get(currency) ?? 0n, currency }) })),
    overdueCount,
  };
}
