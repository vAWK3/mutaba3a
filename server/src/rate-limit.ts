/**
 * Per-API-key rate limiting (plan §2 "API Gateway: Rate Limiting").
 *
 * Sliding window over the last 60 seconds. The default implementation is
 * in-process, which on Cloud Run means the budget is per instance; it still
 * stops a runaway client from exhausting one instance and is honest about
 * what it is. The port exists so a shared store (Redis) can replace it
 * without touching routes when the service scales past one instance.
 */
export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the oldest counted request leaves the window. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string, now: Date): Promise<RateLimitDecision>;
}

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly windowMs = 60_000;

  constructor(private readonly limitPerMinute: number) {}

  async check(key: string, now: Date): Promise<RateLimitDecision> {
    const t = now.getTime();
    const cutoff = t - this.windowMs;
    const stamps = (this.windows.get(key) ?? []).filter((s) => s > cutoff);
    if (stamps.length >= this.limitPerMinute) {
      const oldest = stamps[0] ?? t;
      this.windows.set(key, stamps);
      return {
        allowed: false,
        limit: this.limitPerMinute,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - t) / 1000)),
      };
    }
    stamps.push(t);
    this.windows.set(key, stamps);
    return { allowed: true, limit: this.limitPerMinute, remaining: this.limitPerMinute - stamps.length, retryAfterSeconds: 0 };
  }

  /** Drops windows with no recent activity; call periodically from the server loop. */
  prune(now: Date): void {
    const cutoff = now.getTime() - this.windowMs;
    for (const [key, stamps] of this.windows) {
      if (stamps.every((s) => s <= cutoff)) this.windows.delete(key);
    }
  }
}
