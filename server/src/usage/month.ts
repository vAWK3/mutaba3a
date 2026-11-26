import { todayIn, type IsoDate, type IsoMonth } from '../dates.js';

/**
 * MUT-735 (ADR-281, MUT-704): usage is counted per Asia/Jerusalem calendar month, wherever the server runs. This is
 * the only place the month of a usage row is decided. Pure.
 */
export const USAGE_TIMEZONE = 'Asia/Jerusalem';

export function usageMonthOf(at: Date): IsoMonth {
  return todayIn(USAGE_TIMEZONE, at).slice(0, 7);
}

function shift(month: IsoMonth, by: number): IsoMonth {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The day the month's meters start again: the 1st of the next month. */
export function resetsOn(month: IsoMonth): IsoDate {
  return `${shift(month, 1)}-01`;
}

/** The `n` months ending with `month`, oldest first. */
export function lastMonths(month: IsoMonth, n: number): IsoMonth[] {
  return Array.from({ length: n }, (_, i) => shift(month, i - n + 1));
}

/** `month` moved by `by` months (negative = earlier). */
export function monthPlus(month: IsoMonth, by: number): IsoMonth {
  return shift(month, by);
}
