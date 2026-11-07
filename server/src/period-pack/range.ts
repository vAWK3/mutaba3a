import { addMonths, compareIsoDates, endOfMonth, isIsoMonth, monthOf, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import type { ShareLinkRange } from '../share-links/period.js';

/**
 * MUT-314 (ADR-248, D11, D22): what a period download covers. Owners and accountants name whole calendar months
 * (`YYYY-MM`, inclusive, at most 24, never past the profile's current month); a share link brings its own frozen
 * range (MUT-560's ShareLinkRange, whose `from` is null for "whole profile"). Pure.
 */
export type PeriodRange = ShareLinkRange;

export const PERIOD_MAX_MONTHS = 24;
/** How far back a client may pin `asOf` (D22): the moment its screen showed the period. */
export const AS_OF_MAX_AGE_MS = 24 * 3_600_000;

function rangeRefused(message: string): ApiError {
  return new ApiError('VALIDATION_FAILED', message, { reason: 'PERIOD_RANGE', field: 'from' });
}

/** `from` … `to` as whole months, given the profile's `today`. */
export function monthRange(months: { from: string; to: string }, today: IsoDate): PeriodRange {
  const { from, to } = months;
  if (!isIsoMonth(from) || !isIsoMonth(to)) throw rangeRefused('from and to are months, YYYY-MM');
  if (from > to) throw rangeRefused('to comes before from');
  if (to > monthOf(today)) throw rangeRefused('A period can’t reach past the current month');
  if (addMonths(from, PERIOD_MAX_MONTHS - 1) < to) throw rangeRefused(`A period is at most ${PERIOD_MAX_MONTHS} months`);
  return { from: `${from}-01`, to: endOfMonth(`${to}-01`) };
}

/** The moment rows are counted up to: now, or a client's `asOf` within the last day. */
export function resolveAsOf(asOf: string | undefined, now: Date): Date {
  if (asOf === undefined) return now;
  const at = /^\d{4}-\d{2}-\d{2}T/.test(asOf) ? new Date(asOf) : new Date(Number.NaN);
  const age = now.getTime() - at.getTime();
  if (Number.isNaN(age) || age < 0 || age > AS_OF_MAX_AGE_MS) {
    throw new ApiError('VALIDATION_FAILED', 'asOf is a timestamp no later than now and at most 24 hours back', { reason: 'AS_OF', field: 'asOf' });
  }
  return at;
}

/** The period part of a download's name (D24): `2026-10`, `2026-08_2026-10`, or `to_2026-11` for a whole-profile link. */
export function periodLabel(range: PeriodRange): string {
  const last = monthOf(range.to);
  if (range.from === null) return `to_${last}`;
  const first = monthOf(range.from);
  return first === last ? first : `${first}_${last}`;
}

/** Whether the day is inside the range (both ends inclusive). */
export function inPeriod(day: IsoDate, range: PeriodRange): boolean {
  return (range.from === null || compareIsoDates(day, range.from) >= 0) && compareIsoDates(day, range.to) <= 0;
}
