import { z } from 'zod';
import { ApiError } from './errors.js';
import type { Logger } from './logger.js';
import { SUPPORTED_CURRENCIES, type Currency } from './money.js';

/**
 * Reference exchange rates for display (MUT-228, ADR-087).
 *
 * The ECB publishes a daily euro reference rate for USD and ILS; Frankfurter
 * serves it as JSON with no key. JOD is not in the ECB set, so it is derived
 * from the Central Bank of Jordan's USD peg. Rates here are a hint for people
 * entering money in another currency: nothing stores them on a record.
 *
 * The cache is in process, so it is per instance, the same honesty as the
 * rate limiter (TD-017): a new instance that starts while the provider is down
 * has nothing to serve and answers 503 until the provider is back.
 */

/** 1 USD = 0.709 JOD, the Central Bank of Jordan's peg since 1995. A change is a deploy, not an env flip. */
export const JOD_PER_USD = 0.709;
const RATE_DECIMALS = 6;
/** After a failed refresh, how long to answer from what we have before asking the provider again. */
export const DEFAULT_FX_FAILURE_BACKOFF_MS = 60_000;
/**
 * A snapshot whose ECB rate date is older than this is not served, live or stale. The ECB skips
 * weekends and TARGET holidays (Easter is the longest gap, under 6 days); anything older means the
 * provider is stuck or the outage is long, and an old rate beside a typed amount misleads.
 */
export const MAX_RATE_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One ECB reference day: units of each currency per 1 EUR. */
export interface EcbSnapshot {
  rateDate: string;
  perEur: { USD: number; ILS: number };
}

/** Units of `currency` per 1 base. `derived` = the USD peg was used (exactly one side is JOD). */
export interface FxRate {
  currency: Currency;
  rate: number;
  derived: boolean;
}

export function crossRates(snapshot: EcbSnapshot, base: Currency): FxRate[] {
  const perEur: Record<Currency, number> = {
    EUR: 1,
    USD: snapshot.perEur.USD,
    ILS: snapshot.perEur.ILS,
    JOD: snapshot.perEur.USD * JOD_PER_USD,
  };
  return SUPPORTED_CURRENCIES.map((currency) => ({
    currency,
    rate: currency === base ? 1 : Number((perEur[currency] / perEur[base]).toFixed(RATE_DECIMALS)),
    derived: currency !== base && (currency === 'JOD' || base === 'JOD'),
  }));
}

/** YYYY-MM-DD that names a real day: Date.parse would roll 2026-02-30 over to March and gives NaN for month 13. */
function isCalendarDate(value: string): boolean {
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

export interface FxRateSource {
  latest(): Promise<EcbSnapshot>;
}

const positiveRate = z.number().positive();
const FrankfurterLatestSchema = z.object({
  base: z.literal('EUR'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate, 'not a calendar date'),
  rates: z.object({ USD: positiveRate, ILS: positiveRate }),
});

export interface FrankfurterOptions {
  /** The `latest` endpoint, e.g. https://api.frankfurter.dev/v1/latest. */
  url: string;
  timeoutMs: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export class FrankfurterSource implements FxRateSource {
  constructor(private readonly options: FrankfurterOptions) {}

  async latest(): Promise<EcbSnapshot> {
    const url = new URL(this.options.url);
    url.searchParams.set('base', 'EUR');
    url.searchParams.set('symbols', 'USD,ILS');
    const doFetch = this.options.fetch ?? fetch;
    // A redirect is a failure, not rates to accept: the provider moved or its domain changed hands.
    const res = await doFetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs) });
    if (!res.ok) {
      // Release the connection now rather than at garbage collection.
      await res.body?.cancel();
      throw new Error(`FX provider answered ${res.status}`);
    }
    const body = FrankfurterLatestSchema.parse(await res.json());
    return { rateDate: body.date, perEur: { USD: body.rates.USD, ILS: body.rates.ILS } };
  }
}

export interface FxRatesReading {
  snapshot: EcbSnapshot;
  fetchedAt: Date;
  /** live = inside the cache window; stale = a refresh failed and this is the last good snapshot. */
  source: 'live' | 'stale';
}

export interface CachedFxRatesOptions {
  source: FxRateSource;
  ttlMs: number;
  /** After a failed refresh, how long to answer from what we have before asking the provider again. Default DEFAULT_FX_FAILURE_BACKOFF_MS. */
  failureBackoffMs?: number;
  now?: () => Date;
  logger?: Logger;
}

export class CachedFxRates {
  private cached: { snapshot: EcbSnapshot; fetchedAt: Date } | null = null;
  private lastFailureAt: number | null = null;
  private inFlight: Promise<FxRatesReading> | null = null;

  constructor(private readonly options: CachedFxRatesOptions) {}

  async get(): Promise<FxRatesReading> {
    const now = this.now().getTime();
    if (this.cached && now - this.cached.fetchedAt.getTime() < this.options.ttlMs && !this.isUnservable(this.cached.snapshot)) return { ...this.cached, source: 'live' };
    if (this.lastFailureAt !== null && now - this.lastFailureAt < (this.options.failureBackoffMs ?? DEFAULT_FX_FAILURE_BACKOFF_MS)) return this.staleOrRefuse();
    return this.shared(true);
  }

  /**
   * Fill the cache at startup. A failure is logged but does not start the backoff: a deploy-time
   * blip must not refuse the first real request for a minute without trying the provider.
   */
  async warm(): Promise<void> {
    await this.shared(false).catch(() => undefined);
  }

  /** Concurrent misses share one provider call. */
  private shared(recordFailure: boolean): Promise<FxRatesReading> {
    this.inFlight ??= this.refresh(recordFailure).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async refresh(recordFailure: boolean): Promise<FxRatesReading> {
    try {
      const snapshot = await this.options.source.latest();
      if (this.isUnservable(snapshot)) throw new Error(`FX provider rate date ${snapshot.rateDate} is unusable (more than ${MAX_RATE_AGE_DAYS} days old, in the future, or not a date)`);
      this.cached = { snapshot, fetchedAt: this.now() };
      this.lastFailureAt = null;
      return { ...this.cached, source: 'live' };
    } catch (error) {
      if (recordFailure) this.lastFailureAt = this.now().getTime();
      const hasServableRates = this.cached !== null && !this.isUnservable(this.cached.snapshot);
      this.options.logger?.warn({ err: error, hasServableRates }, 'FX rate provider refresh failed');
      return this.staleOrRefuse();
    }
  }

  private staleOrRefuse(): FxRatesReading {
    if (this.cached && !this.isUnservable(this.cached.snapshot)) return { ...this.cached, source: 'stale' };
    throw new ApiError('FX_RATES_UNAVAILABLE', 'Exchange rates are unavailable right now. Try again shortly.');
  }

  /**
   * Not servable: more than MAX_RATE_AGE_DAYS old, more than a day ahead of this clock (the ECB
   * dates in CET, so a few hours ahead is normal), or not a date at all (NaN would compare false).
   */
  private isUnservable(snapshot: EcbSnapshot): boolean {
    const rateDay = Date.parse(`${snapshot.rateDate}T00:00:00Z`);
    if (!Number.isFinite(rateDay)) return true;
    const age = this.now().getTime() - rateDay;
    return age > MAX_RATE_AGE_DAYS * DAY_MS || age < -DAY_MS;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
