import { addDays, compareIsoDates, type IsoDate } from '../dates.js';

/**
 * MUT-339 (ADR-177): a personal profile's logging streak, worked from its distinct logged days, newest first
 * (`entries.loggedDays`). Pure: the route passes `today` in the profile's timezone.
 */
export interface Streak {
  /** Consecutive logged days ending today or yesterday (D3: alive until a whole day passes with nothing). */
  current: number;
  startedOn: IsoDate | null;
  lastLoggedOn: IsoDate | null;
  /** The UTC instant the current streak ends unless something is logged: the end of lastLoggedOn + 1, in the zone. */
  aliveUntil: string | null;
  /** The run before the gap, when it was at least `MIN_SHOWN` days and ended within `PREVIOUS_WINDOW_DAYS`. */
  previous: { days: number; lastDay: IsoDate } | null;
}

export const MIN_SHOWN = 3;
export const PREVIOUS_WINDOW_DAYS = 7;
/** S4: a phone's capturedAt is trusted this far back. */
export const LOGGED_AT_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Runs of consecutive days in `days` (newest first): [[newest…oldest], …]. */
function runsOf(days: readonly IsoDate[]): IsoDate[][] {
  const runs: IsoDate[][] = [];
  for (const day of days) {
    const run = runs.at(-1);
    if (run && addDays(run.at(-1)!, -1) === day) run.push(day);
    else runs.push([day]);
  }
  return runs;
}

export function computeStreak(days: readonly IsoDate[], today: IsoDate, timezone: string): Streak {
  const runs = runsOf(days);
  const latest = runs[0];
  const lastLoggedOn = latest?.[0] ?? null;
  const alive = lastLoggedOn !== null && compareIsoDates(lastLoggedOn, addDays(today, -1)) >= 0;
  const current = alive ? latest! : null;
  const before = alive ? runs[1] : runs[0];
  const previous =
    before && before.length >= MIN_SHOWN && compareIsoDates(before[0]!, addDays(today, -PREVIOUS_WINDOW_DAYS)) >= 0
      ? { days: before.length, lastDay: before[0]! }
      : null;
  return {
    current: current?.length ?? 0,
    startedOn: current?.at(-1) ?? null,
    lastLoggedOn,
    aliveUntil: current ? zonedMidnightUtc(addDays(current[0]!, 2), timezone).toISOString() : null,
    previous,
  };
}

/** The UTC instant of 00:00 on `date` in `timezone` (two passes, so a DST change on that day still lands). */
export function zonedMidnightUtc(date: IsoDate, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  for (let i = 0; i < 2; i += 1) guess = target - offsetMs(timezone, new Date(guess));
  return new Date(guess);
}

/** How far `timezone`'s wall clock is ahead of UTC at `at`. */
function offsetMs(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(at.getTime() / 1000) * 1000;
}

/** S4: when an entry was logged, from the phone's capturedAt clamped to [now − 48 h, now]; now when none. */
export function loggedAtOf(capturedAt: string | undefined, now: Date): Date {
  if (capturedAt === undefined) return now;
  const at = new Date(capturedAt).getTime();
  return new Date(Math.min(now.getTime(), Math.max(now.getTime() - LOGGED_AT_WINDOW_MS, at)));
}
