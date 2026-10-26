import { addMonths, endOfMonth, monthOf, type IsoDate, type IsoMonth } from '../dates.js';
import { convertToBase, type FxRate } from '../fx-rates.js';
import { formatMoney, isSupportedCurrency, parseMoney, type Currency } from '../money.js';
import type { ReceivableRecord } from '../repositories/ports.js';
import type { ActivitySummary, CurrencyFlow } from './activity.js';
import { countsOn, outstandingOf } from './compute.js';
import { firstCountedMonth } from './months.js';

/**
 * MUT-447: the verdict behind Reports' Glance — one line per profile a person holds, and what they kept, across
 * profiles and currencies (design R1–R8, eng review D2–D12). Pure: the route reads and posts, this shapes.
 *
 * Kept = Σ over every included profile of (received − spent). A business's net minus a personal profile's spending
 * plus its "came in" is that same sum; only the clients show a personal profile as "spent". Currencies are never
 * summed (ADR-004): every figure is per currency, plus one converted figure in `base` at one rate set (R4).
 *
 * Rows in a currency this API no longer supports (MUT-388's retired Gulf codes) are left out of every figure and
 * named per profile in `omittedCurrencies` (qa-reconcile, Basel): they have no rate, and the phone decodes currency
 * codes strictly.
 */

export const VERDICT_PROFILE_KINDS = ['BUSINESS', 'PERSONAL', 'FIRM'] as const;
export type VerdictProfileKind = (typeof VERDICT_PROFILE_KINDS)[number];
export const VERDICT_TOTAL_LABELS = ['kept', 'businessNet'] as const;
export type VerdictTotalLabel = (typeof VERDICT_TOTAL_LABELS)[number];

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
  activity: { currencies: readonly CurrencyFlow[]; history: ReadonlyArray<{ month: IsoMonth; currencies: readonly CurrencyFlow[] }>; dataSince: ActivitySummary['dataSince'] };
  owed: Owed;
}

export interface VerdictInput {
  from: IsoDate;
  to: IsoDate;
  base: Currency;
  /** null = no usable rates (D4): converted figures are null unless everything is already in `base`. */
  rates: readonly FxRate[] | null;
  profiles: readonly VerdictProfileInput[];
  /** Some held profile was left out (locked or failed to read): the totals cover the rest, and usual is withheld. */
  partial?: boolean;
  /** The kinds of every profile held, read or not, so a failed personal profile doesn't turn "kept" into "businessNet". */
  heldKinds?: readonly VerdictProfileKind[];
}

type Flow = { received: string; spent: string; net: string };

export interface VerdictProfile {
  profileId: string;
  name: string;
  kind: VerdictProfileKind;
  shared: boolean;
  currencies: Array<{ currency: Currency } & Flow>;
  converted: Flow | null;
  /** The 12 months ending with to's month: in and out per currency only (the verdict needs no clients or categories). */
  history: Array<{ month: IsoMonth; currencies: CurrencyFlow[] }>;
  owed: Owed;
  /** Retired currency codes found in this profile's period, history or owed, and left out of every figure. */
  omittedCurrencies: string[];
}

export interface Verdict {
  base: Currency;
  profiles: VerdictProfile[];
  total: {
    label: VerdictTotalLabel;
    currencies: Array<{ currency: Currency; net: string }>;
    converted: string | null;
    inCurrencyOnly: Currency | null;
    sharedInFull: boolean;
    partial: boolean;
  };
  usual: string | null;
  owed: Owed & { converted: string | null };
}

type Minor = { currency: Currency; minor: bigint };

export function composeVerdict(input: VerdictInput): Verdict {
  const { base, rates } = input;
  const partial = input.partial ?? false;
  const profiles = input.profiles.map(supportedOnly);
  const fmt = (minor: bigint | null): string | null => (minor === null ? null : formatMoney({ minor, currency: base }));
  const net = sumByCurrency(profiles.flatMap(({ profile }) => profile.activity.currencies.map(netMinor)));
  const converted = convertToBase(net, rates, base);
  const owedRows = profiles.flatMap(({ profile }) => profile.owed.currencies);
  const owedOutstanding = sumByCurrency(owedRows.map((o) => ({ currency: o.currency, minor: parseMoney(o.outstanding, o.currency).minor })));
  const owedOverdue = sumByCurrency(owedRows.map((o) => ({ currency: o.currency, minor: parseMoney(o.overdue, o.currency).minor })));
  const kinds = input.heldKinds ?? input.profiles.map((p) => p.kind);
  return {
    base,
    profiles: profiles.map(({ profile, omitted }) => profileLine(profile, omitted, base, rates)),
    total: {
      label: kinds.includes('PERSONAL') ? 'kept' : 'businessNet',
      currencies: net.map(({ currency, minor }) => ({ currency, net: formatMoney({ minor, currency }) })),
      converted: fmt(converted),
      inCurrencyOnly: converted === null ? busiestCurrency(profiles.flatMap(({ profile }) => profile.activity.currencies)) : null,
      sharedInFull: input.profiles.some((p) => p.shared),
      partial,
    },
    usual: partial ? null : fmt(usualOf(input, profiles.map(({ profile }) => profile))),
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

/** One profile with every retired-currency block removed, and the codes it held (#1). */
function supportedOnly(p: VerdictProfileInput): { profile: VerdictProfileInput; omitted: string[] } {
  const omitted = new Set<string>();
  const keep = <T extends { currency: string }>(rows: readonly T[]): T[] =>
    rows.filter((r) => {
      if (isSupportedCurrency(r.currency)) return true;
      omitted.add(r.currency);
      return false;
    });
  const profile: VerdictProfileInput = {
    ...p,
    activity: { ...p.activity, currencies: keep(p.activity.currencies), history: p.activity.history.map((h) => ({ month: h.month, currencies: keep(h.currencies) })) },
    owed: { ...p.owed, currencies: keep(p.owed.currencies) },
  };
  return { profile, omitted: [...omitted].sort() };
}

function profileLine(p: VerdictProfileInput, omitted: string[], base: Currency, rates: readonly FxRate[] | null): VerdictProfile {
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
    history: p.activity.history.map((h) => ({ month: h.month, currencies: h.currencies.map(({ currency, received, spent }) => ({ currency, received, spent })) })),
    owed: p.owed,
    omittedCurrencies: omitted,
  };
}

function netMinor(c: Pick<CurrencyFlow, 'currency' | 'received' | 'spent'>): Minor {
  return { currency: c.currency, minor: parseMoney(c.received, c.currency).minor - parseMoney(c.spent, c.currency).minor };
}

/** One entry per currency, in code order (as every summary lists them). */
function sumByCurrency(amounts: readonly Minor[]): Minor[] {
  const totals = new Map<Currency, bigint>();
  for (const { currency, minor } of amounts) totals.set(currency, (totals.get(currency) ?? 0n) + minor);
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => ({ currency, minor }));
}

/** ADR-189 D3: without rates, the currency with the most records in view is the one shown "only". */
function busiestCurrency(blocks: ReadonlyArray<CurrencyFlow & { byCustomer?: ReadonlyArray<{ count: number }>; byCategory?: ReadonlyArray<{ count: number }> }>): Currency | null {
  const rows = new Map<Currency, number>();
  for (const b of blocks) {
    const count = [...(b.byCustomer ?? []), ...(b.byCategory ?? [])].reduce((n, x) => n + x.count, 0);
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
 * every profile that has records was complete in it (earlier data, or records that began by the month's 7th day); a
 * profile with no records adds nothing to any month, so it never blocks (#3). Null below MIN_USUAL_MONTHS, when no
 * profile has records, outside a calendar month, or when a month needs a rate that is missing.
 */
function usualOf(input: VerdictInput, profiles: readonly VerdictProfileInput[]): bigint | null {
  if (!isCalendarMonth(input.from, input.to)) return null;
  const recording = profiles.filter((p) => p.earlierData || p.activity.dataSince !== null);
  if (recording.length === 0) return null;
  const months = Array.from({ length: USUAL_MONTHS }, (_, i) => addMonths(monthOf(input.from), i - USUAL_MONTHS)).filter((month) =>
    recording.every((p) => completeIn(p, month)),
  );
  if (months.length < MIN_USUAL_MONTHS) return null;
  const kept: bigint[] = [];
  for (const month of months) {
    const blocks = profiles.flatMap((p) => p.activity.history.find((h) => h.month === month)?.currencies ?? []);
    const converted = convertToBase(sumByCurrency(blocks.map(netMinor)), input.rates, input.base);
    if (converted === null) return null;
    kept.push(converted);
  }
  return median(kept);
}

function completeIn(p: VerdictProfileInput, month: IsoMonth): boolean {
  if (p.earlierData) return true;
  return p.activity.dataSince !== null && firstCountedMonth(p.activity.dataSince) <= month;
}

/** The median in integers; an even count averages the middle two, rounding half away from zero (#7). */
function median(values: readonly bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  const sum = sorted[mid - 1]! + sorted[mid]!;
  const half = sum / 2n;
  return sum % 2n === 0n ? half : half + (sum > 0n ? 1n : -1n);
}

/**
 * One profile's open balance per currency as of `today`, with how many entries are overdue (the Overview's rules).
 * Rows in a retired currency come back too, formatted as stored; composeVerdict leaves them out and names them.
 */
export function owedOf(receivables: readonly ReceivableRecord[], today: IsoDate): Owed {
  const rows = receivables.flatMap((r) => {
    const o = r.status === 'OPEN' && countsOn(r, today) ? outstandingOf(r) : 0n;
    return o > 0n ? [{ currency: r.currency as Currency, minor: o, overdue: r.dueDate < today }] : [];
  });
  const outstanding = sumByCurrency(rows);
  const overdue = sumByCurrency(rows.filter((r) => r.overdue));
  return {
    currencies: outstanding.map(({ currency, minor }) => ({ currency, outstanding: formatMoney({ minor, currency }), overdue: formatMoney({ minor: overdue.find((o) => o.currency === currency)?.minor ?? 0n, currency }) })),
    overdueCount: rows.filter((r) => r.overdue).length,
  };
}
