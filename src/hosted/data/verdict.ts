import { parseAmountToMinor } from '../../lib/utils';
import type { Currency, HostedProfile, Me, Verdict } from '../api/client';
import { canReadReports, type Period } from './reports';
import { billingGateOf } from './trialPrompt';

/**
 * The Glance (MUT-448): GET /v1/summaries/verdict shaped into the ledger's hero, rows, owed line and footnote. The
 * server owns every money rule (ADR-204): nothing here converts, sums across currencies or takes a median. It only
 * turns decimal strings into minor units for display and picks which figure each line shows. Pure, so every state the
 * API can answer with has a unit test (plan P6–P9, design DD1, DD3, DD8, DD9).
 */

type VerdictProfile = Verdict['profiles'][number];

export interface Amount {
  minor: number;
  currency: Currency;
  /** ≈: other currencies were converted into this one at today's rate (DD8). */
  approximate: boolean;
}

export type RowKind = 'net' | 'spent' | 'incomeOnly';

export interface GlanceRow {
  profileId: string;
  name: string;
  kind: RowKind;
  shared: boolean;
  /** The row's figure: one amount, or the first currency when a rate is missing. */
  primary: Amount[];
  /** The muted line under it: "came in", or the row's other currencies when unconverted (DD9). */
  extra: Array<{ kind: 'cameIn' | 'more'; amount: Amount }>;
  empty: boolean;
  unavailable: 'locked' | 'failed' | null;
  link: boolean;
}

export interface GlanceHero {
  label: Verdict['total']['label'];
  figure: Amount | null;
  negative: boolean;
  /** The exact amount per currency behind a ≈ figure (the popover), or null when nothing was converted. */
  breakdown: Amount[] | null;
  /** Set when rates are missing: the figure is this currency's alone (ADR-189 D3). */
  inCurrencyOnly: Currency | null;
}

export interface Glance {
  hero: GlanceHero;
  usual: { direction: 'above' | 'below' | 'about'; delta: Amount } | null;
  leavesOut: string[];
  rows: GlanceRow[];
  owed: { none: boolean; figure: Amount | null; breakdown: Amount[] | null; overdueCount: number };
  footnote: { sharedInFull: boolean; rateDate: string | null; omitted: string[] };
}

export interface GlanceInput {
  period: Period;
  /** Profiles whose own Reports the person may open: only these rows are links (P14). */
  readable: ReadonlySet<string>;
}

const exact = (value: string, currency: Currency): Amount => ({ minor: parseAmountToMinor(value, currency), currency, approximate: false });
const isZero = (value: string) => Number(value) === 0;

function converted(value: string, base: Currency, currencies: readonly Currency[]): Amount {
  return { ...exact(value, base), approximate: currencies.some((c) => c !== base) };
}

/** Currencies that actually moved: a line of zeros never makes a figure ≈. */
function moving(lines: ReadonlyArray<{ currency: Currency; received: string; spent: string }>): Currency[] {
  return lines.filter((l) => !isZero(l.received) || !isZero(l.spent)).map((l) => l.currency);
}

function rowOf(p: VerdictProfile, base: Currency, readable: ReadonlySet<string>): GlanceRow {
  const personal = p.kind === 'PERSONAL';
  const field = personal ? 'spent' : 'net';
  const live = moving(p.currencies);
  const spentNothing = p.currencies.every((c) => isZero(c.spent));
  const kind: RowKind = personal ? 'spent' : spentNothing && live.length > 0 ? 'incomeOnly' : 'net';
  const extra: GlanceRow['extra'] = [];
  let primary: Amount[];
  if (p.converted) {
    primary = [converted(p.converted[field], base, live)];
    if (personal && !isZero(p.converted.received)) extra.push({ kind: 'cameIn', amount: converted(p.converted.received, base, live) });
  } else {
    const lines = p.currencies.filter((c) => live.includes(c.currency)).map((c) => exact(c[field], c.currency));
    primary = lines.slice(0, 1);
    for (const amount of lines.slice(1)) extra.push({ kind: 'more', amount });
    if (personal) for (const c of p.currencies) if (!isZero(c.received)) extra.push({ kind: 'cameIn', amount: exact(c.received, c.currency) });
  }
  return { profileId: p.profileId, name: p.name, kind, shared: p.shared, primary, extra, empty: live.length === 0, unavailable: null, link: readable.has(p.profileId) };
}

function heroOf(v: Verdict): GlanceHero {
  const live = v.total.currencies.filter((c) => !isZero(c.net)).map((c) => c.currency);
  if (v.total.converted !== null) {
    const figure = converted(v.total.converted, v.base, live);
    return { label: v.total.label, figure, negative: figure.minor < 0, breakdown: figure.approximate ? v.total.currencies.map((c) => exact(c.net, c.currency)) : null, inCurrencyOnly: null };
  }
  const only = v.total.inCurrencyOnly;
  const line = only ? v.total.currencies.find((c) => c.currency === only) : undefined;
  const figure = line ? exact(line.net, line.currency) : null;
  return { label: v.total.label, figure, negative: (figure?.minor ?? 0) < 0, breakdown: null, inCurrencyOnly: only };
}

/** DD1: only a finished month is compared with the usual; a month still running would read as a bad one every 3rd. */
function usualOf(v: Verdict, period: Period): Glance['usual'] {
  const running = v.from <= v.asOf && v.asOf <= v.to;
  if (period !== 'month' || running || v.usual === null || v.total.converted === null) return null;
  const minor = parseAmountToMinor(v.total.converted, v.base) - parseAmountToMinor(v.usual, v.base);
  return { direction: minor > 0 ? 'above' : minor < 0 ? 'below' : 'about', delta: { minor: Math.abs(minor), currency: v.base, approximate: false } };
}

function owedOf(v: Verdict): Glance['owed'] {
  const live = v.owed.currencies.filter((c) => !isZero(c.outstanding));
  if (live.length === 0) return { none: true, figure: null, breakdown: null, overdueCount: v.owed.overdueCount };
  const currencies = live.map((c) => c.currency);
  if (v.owed.converted !== null) {
    const figure = converted(v.owed.converted, v.base, currencies);
    return { none: false, figure, breakdown: figure.approximate ? live.map((c) => exact(c.outstanding, c.currency)) : null, overdueCount: v.owed.overdueCount };
  }
  return { none: false, figure: exact(live[0]!.outstanding, live[0]!.currency), breakdown: live.map((c) => exact(c.outstanding, c.currency)), overdueCount: v.owed.overdueCount };
}

export function glanceOf(v: Verdict, { period, readable }: GlanceInput): Glance {
  const rows = v.profiles.map((p) => rowOf(p, v.base, readable));
  for (const u of v.unavailable) {
    rows.push({ profileId: u.profileId, name: u.name, kind: 'net', shared: false, primary: [], extra: [], empty: false, unavailable: u.code === 'SUBSCRIPTION_LAPSED' ? 'locked' : 'failed', link: false });
  }
  const omitted = [...new Set(v.profiles.flatMap((p) => p.omittedCurrencies))].sort();
  return {
    hero: heroOf(v),
    usual: usualOf(v, period),
    leavesOut: v.total.partial ? v.unavailable.map((u) => u.name) : [],
    rows,
    owed: owedOf(v),
    footnote: { sharedInFull: v.total.sharedInFull, rateDate: v.rates?.date ?? null, omitted },
  };
}

/** DD4: nothing recorded anywhere yet (no movement in the period or its 12-month history, nothing owed, nobody missing). */
export function isFirstRun(v: Verdict): boolean {
  const still = (lines: ReadonlyArray<{ received: string; spent: string }>) => lines.every((l) => isZero(l.received) && isZero(l.spent));
  return (
    v.unavailable.length === 0 &&
    v.owed.currencies.every((c) => isZero(c.outstanding)) &&
    v.profiles.every((p) => still(p.currencies) && p.history.every((h) => still(h.currencies)))
  );
}

/**
 * D8: the profile the shell keeps on `/reports` (its pill and You island). The page the person came from when it is open
 * and readable, else the first that is both, else the first open one: a locked profile hides the shell's chrome
 * (HostedShell `sections`), so it is never picked while another exists.
 */
export function glanceShellProfile(profiles: readonly HostedProfile[], backProfileId: string | undefined, me: Pick<Me, 'billingStanding'>): HostedProfile | null {
  const open = (p: HostedProfile) => billingGateOf(me, p) !== 'locked';
  const good = (p: HostedProfile) => open(p) && canReadReports(p);
  const back = profiles.find((p) => p.id === backProfileId);
  if (back && good(back)) return back;
  return profiles.find(good) ?? profiles.find(open) ?? null;
}

/** D7: every profile the person holds is locked, so the verdict would be refused; the page shows LockedScreen instead. */
export function allLocked(profiles: readonly HostedProfile[], me: Pick<Me, 'billingStanding'>): boolean {
  return profiles.length > 0 && profiles.every((p) => billingGateOf(me, p) === 'locked');
}
