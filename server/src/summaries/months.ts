import { addMonths, monthOf, type IsoDate, type IsoMonth } from '../dates.js';

/**
 * MUT-447 (D6/D8): the "complete month" rule the verdict's usual counts months by. The portal may not import server
 * code (ADR-097), so src/hosted/data/reports.ts keeps a copy for its Reports stage (MUT-175 DR14), and
 * reportsMonthParity.test.ts fails the moment the two disagree. Pure: no I/O.
 */

/** A month counts as complete only if records started by this day of it (DR14). */
export const COMPLETE_MONTH_CUTOFF_DAY = 7;

/** The first month that counts as complete-able: since's own month if records began by its 7th day, else the next. */
export function firstCountedMonth(since: IsoDate): IsoMonth {
  const day = Number(since.slice(8, 10));
  return day <= COMPLETE_MONTH_CUTOFF_DAY ? monthOf(since) : addMonths(monthOf(since), 1);
}
