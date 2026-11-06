import { addDays, addMonths, compareIsoDates, endOfMonth, monthOf, todayIn, type IsoDate } from '../dates.js';

/**
 * MUT-560 (ADR-247): what a share link shows, as a range of money dates. The one place the period rule lives: the
 * link stores the resolved range at creation (frozen), and shareLinkAccess hands it to every read.
 *
 * Basel's decision (2026-11-06): "last N months" is the last N COMPLETE calendar months before the creation day, in
 * the profile's timezone (created 2026-11-06, three months = 2026-08-01 … 2026-10-31); the month the link is created
 * in is never included. "Whole profile" is everything up to and including the creation day. Entries dated after the
 * range's end (future-dated, MUT-392) never show.
 */

export const SHARE_LINK_PERIODS = ['LAST_1_MONTH', 'LAST_2_MONTHS', 'LAST_3_MONTHS', 'WHOLE_PROFILE'] as const;
export type ShareLinkPeriod = (typeof SHARE_LINK_PERIODS)[number];

/** Inclusive at both ends; `from: null` = from the profile's first record. */
export interface ShareLinkRange {
  from: IsoDate | null;
  to: IsoDate;
}

const MONTHS: Record<Exclude<ShareLinkPeriod, 'WHOLE_PROFILE'>, number> = { LAST_1_MONTH: 1, LAST_2_MONTHS: 2, LAST_3_MONTHS: 3 };

/** The range a link created on `today` (the profile's calendar day) shows. */
export function resolveShareLinkPeriod(period: ShareLinkPeriod, today: IsoDate): ShareLinkRange {
  if (period === 'WHOLE_PROFILE') return { from: null, to: today };
  const thisMonth = monthOf(today);
  return { from: `${addMonths(thisMonth, -MONTHS[period])}-01`, to: endOfMonth(`${addMonths(thisMonth, -1)}-01`) };
}

/** The range for a link created at `at` on a profile in `timezone`. */
export function shareLinkRangeAt(period: ShareLinkPeriod, timezone: string, at: Date): ShareLinkRange {
  return resolveShareLinkPeriod(period, todayIn(timezone, at));
}

/** The entries feed's bounds (`entries.list`): money date on or after `from`, before the day after `to` (exclusive). */
export function feedBoundsOf(range: ShareLinkRange): { occurredFrom?: IsoDate; occurredBefore: IsoDate } {
  return { ...(range.from !== null && { occurredFrom: range.from }), occurredBefore: addDays(range.to, 1) };
}

export function isInRange(day: IsoDate, range: ShareLinkRange): boolean {
  return (range.from === null || compareIsoDates(day, range.from) >= 0) && compareIsoDates(day, range.to) <= 0;
}

/**
 * MUT-575 (S5): a visitor's own money-date filters, clamped inside the link's range: never before its `from`, never
 * past its `to`. Absent filters are the range itself (`feedBoundsOf`). Narrows only; a from at or past before is an
 * empty page.
 */
export function clampToRange(range: ShareLinkRange, from: IsoDate | undefined, before: IsoDate | undefined): { occurredFrom?: IsoDate; occurredBefore: IsoDate } {
  const bounds = feedBoundsOf(range);
  const occurredFrom = from === undefined ? bounds.occurredFrom : bounds.occurredFrom === undefined || compareIsoDates(from, bounds.occurredFrom) > 0 ? from : bounds.occurredFrom;
  const occurredBefore = before !== undefined && compareIsoDates(before, bounds.occurredBefore) < 0 ? before : bounds.occurredBefore;
  return { ...(occurredFrom !== undefined && { occurredFrom }), occurredBefore };
}
