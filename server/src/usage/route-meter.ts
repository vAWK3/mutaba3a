import type { RouteUsageDelta } from '../repositories/ports.js';
import type { UsagePlan } from './kinds.js';
import { todayIn } from '../dates.js';
import { USAGE_TIMEZONE } from './month.js';
import { BUCKET_COUNT, bucketOf, statusClassOf } from './route-buckets.js';

/** A flush is due once the last one is this old. */
export const ROUTE_FLUSH_EVERY_MS = 60_000;

export interface RouteMeterDeps {
  /** Adds the aggregates (UsageRepository.addRouteUsage on the unguarded store). */
  sink: (deltas: readonly RouteUsageDelta[]) => Promise<void>;
  now: () => Date;
  logError: (err: unknown) => void;
}

/**
 * MUT-735 (ADR-281): requests per Jerusalem day × route template × plan × status class, kept in memory and added to
 * `route_usage_daily` in one statement. `observe` is an in-memory increment (no I/O on the request path); a flush is
 * started by the request that finds the last one a minute old, fire and forget, because Cloud Run's `cpu_idle`
 * stops timers between requests; and once more on SIGTERM. A failed flush is logged and its batch dropped
 * (statistics, not money).
 */
export class RouteMeter {
  private pending = new Map<string, RouteUsageDelta>();
  private lastFlushAt: number;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly deps: RouteMeterDeps) {
    this.lastFlushAt = deps.now().getTime();
  }

  observe(request: { routeKey: string; plan: UsagePlan | 'unknown'; status: number; durationMs: number }): void {
    const at = this.deps.now();
    const day = todayIn(USAGE_TIMEZONE, at);
    const statusClass = statusClassOf(request.status);
    const key = `${day}|${request.routeKey}|${request.plan}|${statusClass}`;
    let row = this.pending.get(key);
    if (!row) {
      row = { day, routeKey: request.routeKey, plan: request.plan, statusClass, count: 0, durationMsSum: 0, buckets: new Array<number>(BUCKET_COUNT).fill(0) };
      this.pending.set(key, row);
    }
    row.count += 1;
    row.durationMsSum += request.durationMs;
    row.buckets[bucketOf(request.durationMs)]! += 1;
    if (!this.inFlight && at.getTime() - this.lastFlushAt >= ROUTE_FLUSH_EVERY_MS) void this.flush();
  }

  /** Sends what is pending; never throws. Waits for a flush already running first. */
  async flush(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    this.lastFlushAt = this.deps.now().getTime();
    const batch = [...this.pending.values()];
    this.pending = new Map();
    if (batch.length === 0) return;
    this.inFlight = this.deps
      .sink(batch)
      .catch((err: unknown) => this.deps.logError(err))
      .finally(() => {
        this.inFlight = null;
      });
    await this.inFlight;
  }
}
