/**
 * MUT-735 (ADR-281): a route's durations as a 12-bucket histogram (`route_usage_daily.b0…b11`), and its p95 read back
 * from the buckets: the upper bound of the bucket where the cumulative share crosses 95%, good to a bucket's width.
 * Pure.
 */

/** Upper bounds in ms; the last bucket holds everything over 10 s. */
export const BUCKET_UPPER_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, Number.POSITIVE_INFINITY] as const;
export const BUCKET_COUNT = BUCKET_UPPER_MS.length;

export function bucketOf(durationMs: number): number {
  const index = BUCKET_UPPER_MS.findIndex((upper) => durationMs <= upper);
  return index === -1 ? BUCKET_COUNT - 1 : index;
}

/** `p95Ms` is the bucket's upper bound; `over` means it fell in the last bucket (more than 10 s, p95Ms 10000). Null with no requests. */
export function p95Of(buckets: readonly number[]): { p95Ms: number; over: boolean } | null {
  const total = buckets.reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;
  let seen = 0;
  for (let i = 0; i < buckets.length; i += 1) {
    seen += buckets[i] ?? 0;
    if (seen / total >= 0.95) {
      const over = i === BUCKET_COUNT - 1;
      return { p95Ms: over ? 10_000 : BUCKET_UPPER_MS[i]!, over };
    }
  }
  return { p95Ms: 10_000, over: true };
}

/** The status class a route row is kept under. */
export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';

export function statusClassOf(status: number): StatusClass {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  return '2xx';
}
