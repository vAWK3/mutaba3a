import { vi } from 'vitest';

/**
 * Runs fn with the clock at instant, in timeZone (Node applies a TZ change at
 * once). Only Date is faked, so Dexie's timers keep running.
 *
 * Pick an instant whose local and UTC calendar days differ (e.g. 01:30 in
 * Asia/Jerusalem) to pin a "today" bug that a test run in daytime can't see.
 */
export async function atInstantIn(timeZone: string, instant: string, fn: () => Promise<void>) {
  const savedTz = process.env.TZ;
  process.env.TZ = timeZone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  try {
    await fn();
  } finally {
    vi.useRealTimers();
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
}
