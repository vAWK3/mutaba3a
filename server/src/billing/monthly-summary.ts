import { addMonths, compareIsoDates, endOfMonth, monthOf, todayIn, type IsoDate } from '../dates.js';
import { isSupportedCurrency, parseMoney } from '../money.js';
import type { MonthlySummaryChoice } from '../repositories/ports.js';
import type { ProfileFigures } from '../summaries/profile-figures.js';

/**
 * MUT-535 (plan D3, D4, D7, D10): the monthly summary mail's rules, pure. The job (monthly-summary-mail.ts) reads;
 * these decide which month, which profiles, and what each profile's panel shows.
 */

/** D3: the month is Jerusalem's, like every billing job's day. */
export const SUMMARY_ZONE = 'Asia/Jerusalem';

export interface SummaryMonth {
  /** YYYY-MM: the idempotency key's month. */
  key: string;
  from: IsoDate;
  to: IsoDate;
}

/** A canonical decimal amount in one currency (the API's own strings); the template formats it. */
export interface SummaryMoney {
  currency: string;
  amount: string;
}

export interface ProfileBlock {
  profileId: string;
  name: string;
  cameIn: SummaryMoney[];
  owed: SummaryMoney[];
  overdue: SummaryMoney[];
  /** Overdue entries across the profile's currencies, as the Glance counts them. */
  overdueCount: number;
}

/** D3: the calendar month before the run's month in Jerusalem. */
export function summaryMonthOf(now: Date): SummaryMonth {
  const key = addMonths(monthOf(todayIn(SUMMARY_ZONE, now)), -1);
  const from = `${key}-01`;
  return { key, from, to: endOfMonth(from) };
}

/** D3: a profile whose own today is still inside the month (west of UTC) waits for the next run. */
export function monthEndedFor(today: IsoDate, month: SummaryMonth): boolean {
  return compareIsoDates(today, month.to) > 0;
}

/**
 * D4, D10: the profile's panel, or null when nothing in the month calls for one (no entry dated in it, or nothing to
 * show). Per currency, sorted by code, zero rows and retired currencies left out; never summed across currencies.
 */
export function profileBlockOf(profile: { id: string; name: string }, figures: ProfileFigures): ProfileBlock | null {
  if (!figures.entriesInRange) return null;
  const cameIn = nonZero(figures.activity.currencies.map((c) => ({ currency: c.currency, amount: c.received })));
  const owed = nonZero(figures.owed.currencies.map((c) => ({ currency: c.currency, amount: c.outstanding })));
  const overdue = nonZero(figures.owed.currencies.map((c) => ({ currency: c.currency, amount: c.overdue })));
  if (cameIn.length === 0 && owed.length === 0) return null;
  return { profileId: profile.id, name: profile.name, cameIn, owed, overdue, overdueCount: figures.owed.overdueCount };
}

function nonZero(rows: readonly SummaryMoney[]): SummaryMoney[] {
  return rows
    .filter((r) => isSupportedCurrency(r.currency) && parseMoney(r.amount, r.currency).minor !== 0n)
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** D7: which of the person's qualifying profiles the mail covers, by their choice. */
export function mailProfilesOf<P extends { malafatCovered: boolean }>(choice: MonthlySummaryChoice | null, profiles: readonly P[]): P[] {
  if (choice === 'OFF') return [];
  if (choice === 'ON_ALL') return [...profiles];
  return profiles.filter((p) => !p.malafatCovered);
}

/** D7: You › Account shows the switch on exactly when a mail would go (given a month with something to show). */
export function switchIsOn(choice: MonthlySummaryChoice | null, profiles: readonly { malafatCovered: boolean }[]): boolean {
  return mailProfilesOf(choice, profiles).length > 0;
}

/**
 * D7 (review R5): what turning the switch stores. Off is `OFF`; on is the default (null), unless the default would send
 * nothing because Malafat covers every profile, when it is `ON_ALL`.
 */
export function choiceForSwitch(on: boolean, profiles: readonly { malafatCovered: boolean }[]): MonthlySummaryChoice | null {
  if (!on) return 'OFF';
  return profiles.length > 0 && profiles.every((p) => p.malafatCovered) ? 'ON_ALL' : null;
}
