import { z } from 'zod';
import { ApiError } from './errors.js';
import type { Logger } from './logger.js';
import { SUPPORTED_CURRENCIES, type Currency } from './money.js';

/**
 * Reference exchange rates for display (MUT-228, ADR-087).
 *
 * The ECB publishes a daily euro reference rate for USD and ILS; Frankfurter
 * serves it as JSON with no key. JOD is not in the ECB set; it is fixed to
 * the US dollar by its central bank, so its rate comes from that peg (USD_PEGS,
 * ADR-098, narrowed to JOD by ADR-166). Every pair is priced through USD.
 * Rates here are a hint for people entering money in another currency:
 * nothing stores them on a record.
 *
 * The cache is in process, so it is per instance, the same honesty as the
 * rate limiter (TD-017): a new instance that starts while the provider is down
 * has nothing to serve and answers 503 until the provider is back.
 */

/** The currencies the ECB snapshot prices directly. Every other supported currency must have a USD peg. */
type EcbCurrency = 'USD' | 'EUR' | 'ILS';
export type PeggedCurrency = Exclude<Currency, EcbCurrency>;

/**
 * Units per 1 USD, each fixed by its central bank (ADR-087 §3, ADR-098). Keyed by every currency the ECB
 * doesn't price, so a new code with no rate source fails typecheck. A re-peg is a deploy, not an env flip;
 * docs/fx/pegs.json mirrors this table for the web and phone tests.
 */
export const USD_PEGS: Readonly<Record<PeggedCurrency, number>> = {
  JOD: 0.709, // Central Bank of Jordan, since 1995
};

export function isPegged(currency: Currency): currency is PeggedCurrency {
  return Object.hasOwn(USD_PEGS, currency);
}
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
  /**
   * Set by a source that relays another cache's reading (the portal's
   * signed-out source reads this server's GET /v1/public/fx-rates, MUT-287):
   * that cache's fetch time and staleness are what the reading reports. This
   * cache's own window still runs on when *it* fetched.
   */
  upstream?: { fetchedAt: Date; stale: boolean };
}

/** Units of `currency` per 1 base. `derived` = a USD peg was used (either side is pegged, not base→base). */
export interface FxRate {
  currency: Currency;
  rate: number;
  derived: boolean;
}

/** Every pair goes through USD (D3): rate(base → currency) = perUsd[currency] / perUsd[base]. */
export function crossRates(snapshot: EcbSnapshot, base: Currency): FxRate[] {
  const perUsd: Record<Currency, number> = {
    USD: 1,
    EUR: 1 / snapshot.perEur.USD,
    ILS: snapshot.perEur.ILS / snapshot.perEur.USD,
    ...USD_PEGS,
  };
  return SUPPORTED_CURRENCIES.map((currency) => ({
    currency,
    rate: currency === base ? 1 : Number((perUsd[currency] / perUsd[base]).toFixed(RATE_DECIMALS)),
    derived: currency !== base && (isPegged(currency) || isPegged(base)),
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

/** This cache's view, or the relayed cache's when the snapshot carries one: whichever is staler wins. */
function reading(cached: { snapshot: EcbSnapshot; fetchedAt: Date }, source: 'live' | 'stale'): FxRatesReading {
  const upstream = cached.snapshot.upstream;
  return { snapshot: cached.snapshot, fetchedAt: upstream?.fetchedAt ?? cached.fetchedAt, source: source === 'stale' || upstream?.stale ? 'stale' : 'live' };
}

export class CachedFxRates {
  private cached: { snapshot: EcbSnapshot; fetchedAt: Date } | null = null;
  private lastFailureAt: number | null = null;
  private inFlight: Promise<FxRatesReading> | null = null;

  constructor(private readonly options: CachedFxRatesOptions) {}

  async get(): Promise<FxRatesReading> {
    const now = this.now().getTime();
    if (this.cached && now - this.cached.fetchedAt.getTime() < this.options.ttlMs && !this.isUnservable(this.cached.snapshot)) return reading(this.cached, 'live');
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
      return reading(this.cached, 'live');
    } catch (error) {
      if (recordFailure) this.lastFailureAt = this.now().getTime();
      const hasServableRates = this.cached !== null && !this.isUnservable(this.cached.snapshot);
      this.options.logger?.warn({ err: error, hasServableRates }, 'FX rate provider refresh failed');
      return this.staleOrRefuse();
    }
  }

  private staleOrRefuse(): FxRatesReading {
    if (this.cached && !this.isUnservable(this.cached.snapshot)) return reading(this.cached, 'stale');
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
