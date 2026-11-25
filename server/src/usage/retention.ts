import { addDays, todayIn, type IsoDate } from '../dates.js';
import type { UsagePruneBefore } from '../repositories/ports.js';
import { monthPlus, USAGE_TIMEZONE, usageMonthOf } from './month.js';

/**
 * MUT-735 (ADR-281 §12, Basel 2026-11-25): how long usage is kept, counted in Asia/Jerusalem months and days. These
 * periods go into the privacy text (MUT-732).
 */
export const USAGE_RETENTION = {
  /** Usage events: this month and the 12 before it. */
  eventMonths: 13,
  /** Monthly counters: this month and the 24 before it (a year-on-year view). */
  counterMonths: 25,
  /** Route statistics. */
  routeDays: 90,
} as const;

/** What the daily prune deletes before, at `now`. Pure. */
export function pruneCutoffs(now: Date): UsagePruneBefore & { today: IsoDate } {
  const month = usageMonthOf(now);
  const today = todayIn(USAGE_TIMEZONE, now);
  return {
    today,
    eventsMonth: monthPlus(month, -(USAGE_RETENTION.eventMonths - 1)),
    countersMonth: monthPlus(month, -(USAGE_RETENTION.counterMonths - 1)),
    routesDay: addDays(today, -(USAGE_RETENTION.routeDays - 1)),
  };
}
