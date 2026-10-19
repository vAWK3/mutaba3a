import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors.js';
import {
  CachedFxRates,
  crossRates,
  DEFAULT_FX_FAILURE_BACKOFF_MS,
  FrankfurterSource,
  isPegged,
  MAX_RATE_AGE_DAYS,
  USD_PEGS,
  type EcbSnapshot,
  type FxRateSource,
} from '../fx-rates.js';
import { SUPPORTED_CURRENCIES } from '../money.js';

/** MUT-228 (ADR-087): reference rates for display, proxied from the ECB via Frankfurter. */

const SNAPSHOT: EcbSnapshot = { rateDate: '2026-10-15', perEur: { USD: 1.1208, ILS: 3.4769 } };
const rateOf = (rates: ReturnType<typeof crossRates>, currency: string) => rates.find((r) => r.currency === currency)!;

describe('crossRates', () => {
  it.each(SUPPORTED_CURRENCIES)('base %s: every supported currency in order, the base itself at 1', (base) => {
    const rates = crossRates(SNAPSHOT, base);
    expect(rates.map((r) => r.currency)).toEqual([...SUPPORTED_CURRENCIES]);
    expect(rateOf(rates, base)).toEqual({ currency: base, rate: 1, derived: false });
  });

  it('a EUR base reads the ECB snapshot as is', () => {
    const rates = crossRates(SNAPSHOT, 'EUR');
    expect(rateOf(rates, 'USD')).toEqual({ currency: 'USD', rate: 1.1208, derived: false });
    expect(rateOf(rates, 'ILS')).toEqual({ currency: 'ILS', rate: 3.4769, derived: false });
  });

  it('crosses two ECB currencies through the euro, rounded to 6 decimal places', () => {
    expect(rateOf(crossRates(SNAPSHOT, 'USD'), 'ILS').rate).toBe(3.102159); // 3.4769 / 1.1208
    expect(rateOf(crossRates(SNAPSHOT, 'ILS'), 'USD').rate).toBe(0.322356); // 1.1208 / 3.4769
    expect(rateOf(crossRates(SNAPSHOT, 'ILS'), 'EUR').rate).toBe(0.287613); // 1 / 3.4769
  });

  it('derives JOD from the USD peg', () => {
    expect(USD_PEGS.JOD).toBe(0.709);
    expect(rateOf(crossRates(SNAPSHOT, 'USD'), 'JOD')).toEqual({ currency: 'JOD', rate: 0.709, derived: true });
    expect(rateOf(crossRates(SNAPSHOT, 'JOD'), 'USD')).toEqual({ currency: 'USD', rate: 1.410437, derived: true });
    expect(rateOf(crossRates(SNAPSHOT, 'ILS'), 'JOD').rate).toBe(0.22855); // 1.1208 × 0.709 / 3.4769
  });

  // MUT-280 (ADR-098): literal pegs here, not USD_PEGS, so a typo in the table fails.
  const PEGS: Record<string, number> = { JOD: 0.709, AED: 3.6725, SAR: 3.75, QAR: 3.64, BHD: 0.376, OMR: 0.3845 };
  const perUsd: Record<string, number> = {
    USD: 1,
    EUR: 1 / SNAPSHOT.perEur.USD,
    ILS: SNAPSHOT.perEur.ILS / SNAPSHOT.perEur.USD,
    ...PEGS,
  };
  const round6 = (n: number) => Number(n.toFixed(6));

  it('prices every pair through USD: rate = perUsd[to] / perUsd[from] (9 × 9)', () => {
    for (const base of SUPPORTED_CURRENCIES) {
      for (const { currency, rate } of crossRates(SNAPSHOT, base)) {
        expect(rate, `${base}→${currency}`).toBe(base === currency ? 1 : round6(perUsd[currency]! / perUsd[base]!));
      }
    }
  });

  it('a pegged↔pegged rate is the plain ratio of the two pegs, with no ECB figure in it', () => {
    expect(rateOf(crossRates(SNAPSHOT, 'AED'), 'SAR').rate).toBe(1.021103); // 3.75 / 3.6725
    expect(rateOf(crossRates(SNAPSHOT, 'BHD'), 'OMR').rate).toBe(1.022606); // 0.3845 / 0.376
    expect(rateOf(crossRates(SNAPSHOT, 'JOD'), 'AED').rate).toBe(round6(3.6725 / 0.709));
    expect(rateOf(crossRates({ rateDate: '2026-10-15', perEur: { USD: 0.9, ILS: 4.2 } }, 'AED'), 'SAR').rate).toBe(1.021103);
  });

  it('marks a rate derived when either side of the pair is pegged, never base→base', () => {
    for (const base of SUPPORTED_CURRENCIES) {
      for (const { currency, derived } of crossRates(SNAPSHOT, base)) {
        expect(derived, `${base}→${currency}`).toBe(base !== currency && (base in PEGS || currency in PEGS));
      }
    }
    expect(crossRates(SNAPSHOT, 'AED').filter((r) => r.derived)).toHaveLength(8);
    expect(crossRates(SNAPSHOT, 'USD').filter((r) => r.derived).map((r) => r.currency)).toEqual(['JOD', 'AED', 'SAR', 'QAR', 'BHD', 'OMR']);
  });

  it('keeps the six central-bank pegs, and only those currencies are pegged', () => {
    expect(USD_PEGS).toEqual(PEGS);
    expect(SUPPORTED_CURRENCIES.filter(isPegged)).toEqual(['JOD', 'AED', 'SAR', 'QAR', 'BHD', 'OMR']);
  });
});

describe('peg fixture docs/fx/pegs.json (MUT-280)', () => {
  it('mirrors USD_PEGS exactly, so the web and phone tests compare against the server', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../docs/fx/pegs.json', import.meta.url), 'utf8')) as { unitsPerUsd: Record<string, number> };
    const expected = JSON.stringify({ unitsPerUsd: USD_PEGS });
    expect(fixture.unitsPerUsd, `docs/fx/pegs.json is out of date; its unitsPerUsd should be ${expected}`).toEqual(USD_PEGS);
  });
});

describe('FrankfurterSource', () => {
  const URL_ = 'https://frankfurter.test/v1/latest';
  const answering = (status: number, body: unknown): { fetch: typeof fetch; calls: string[] } => {
    const calls: string[] = [];
    const fake = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { fetch: fake, calls };
  };
  const OK = { amount: 1, base: 'EUR', date: '2026-10-15', rates: { ILS: 3.4769, USD: 1.1208 } };

  it('asks for USD and ILS against the euro and reads the snapshot', async () => {
    const f = answering(200, OK);
    await expect(new FrankfurterSource({ url: URL_, timeoutMs: 1000, fetch: f.fetch }).latest()).resolves.toEqual(SNAPSHOT);
    const asked = new URL(f.calls[0]!);
    expect(asked.origin + asked.pathname).toBe(URL_);
    expect(asked.searchParams.get('base')).toBe('EUR');
    expect(asked.searchParams.get('symbols')).toBe('USD,ILS');
  });

  it('refuses a non-2xx answer', async () => {
    await expect(new FrankfurterSource({ url: URL_, timeoutMs: 1000, fetch: answering(502, { message: 'bad gateway' }).fetch }).latest()).rejects.toThrow(/502/);
  });

  it.each([
    ['a missing rate', { ...OK, rates: { USD: 1.1208 } }],
    ['a zero rate', { ...OK, rates: { ILS: 0, USD: 1.1208 } }],
    ['a negative rate', { ...OK, rates: { ILS: -3.4769, USD: 1.1208 } }],
    ['a non-numeric rate', { ...OK, rates: { ILS: 'NaN', USD: 1.1208 } }],
    ['a malformed date', { ...OK, date: '15/10/2026' }],
    ['a date that is not on the calendar', { ...OK, date: '2026-02-30' }],
    ['a month that does not exist', { ...OK, date: '2026-13-01' }],
    ['another base', { ...OK, base: 'USD' }],
  ])('refuses %s', async (_label, body) => {
    await expect(new FrankfurterSource({ url: URL_, timeoutMs: 1000, fetch: answering(200, body).fetch }).latest()).rejects.toThrow();
  });

  it('refuses to follow a redirect, so a moved or re-pointed provider counts as a failure', async () => {
    let init: RequestInit | undefined;
    const fake = (async (_input: string | URL | Request, given?: RequestInit) => {
      init = given;
      return new Response(JSON.stringify(OK), { status: 200 });
    }) as typeof fetch;
    await new FrankfurterSource({ url: URL_, timeoutMs: 1000, fetch: fake }).latest();
    expect(init?.redirect).toBe('error');
  });

  it('gives up on a provider that hangs past the timeout', async () => {
    const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
    await expect(new FrankfurterSource({ url: URL_, timeoutMs: 20, fetch: hanging }).latest()).rejects.toThrow();
  });
});

describe('CachedFxRates', () => {
  const TTL = 4 * 60 * 60 * 1000;
  const BACKOFF = 60_000;

  function harness() {
    const clock = { now: new Date('2026-10-15T12:00:00Z') };
    const state = { calls: 0, fail: false, snapshot: SNAPSHOT };
    let release: (() => void) | null = null;
    const gate = { hold: false };
    const source: FxRateSource = {
      async latest() {
        state.calls += 1;
        if (gate.hold) await new Promise<void>((resolve) => (release = resolve));
        if (state.fail) throw new Error('provider down');
        return state.snapshot;
      },
    };
    const cache = new CachedFxRates({ source, ttlMs: TTL, failureBackoffMs: BACKOFF, now: () => clock.now });
    const advance = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));
    return { cache, clock, state, gate, advance, release: () => release?.() };
  }

  it('fetches on first use and answers live', async () => {
    const h = harness();
    await expect(h.cache.get()).resolves.toEqual({ snapshot: SNAPSHOT, fetchedAt: new Date('2026-10-15T12:00:00Z'), source: 'live' });
    expect(h.state.calls).toBe(1);
  });

  it('shares one provider call between concurrent cold requests', async () => {
    const h = harness();
    h.gate.hold = true;
    const pending = Array.from({ length: 100 }, () => h.cache.get());
    await Promise.resolve();
    h.release();
    const readings = await Promise.all(pending);
    expect(h.state.calls).toBe(1);
    expect(readings.every((r) => r.source === 'live')).toBe(true);
  });

  it('answers from memory inside the window and refreshes once it has passed', async () => {
    const h = harness();
    await h.cache.get();
    h.advance(TTL - 1);
    await h.cache.get();
    expect(h.state.calls).toBe(1);
    h.advance(1);
    h.state.snapshot = { rateDate: '2026-10-16', perEur: { USD: 1.12, ILS: 3.48 } };
    await expect(h.cache.get()).resolves.toMatchObject({ snapshot: { rateDate: '2026-10-16' }, source: 'live' });
    expect(h.state.calls).toBe(2);
  });

  it('serves the last snapshot as stale when a refresh fails', async () => {
    const h = harness();
    await h.cache.get();
    h.advance(TTL);
    h.state.fail = true;
    await expect(h.cache.get()).resolves.toEqual({ snapshot: SNAPSHOT, fetchedAt: new Date('2026-10-15T12:00:00Z'), source: 'stale' });
  });

  it('relays a source that is itself a cache: its staleness and fetch time are reported, while this cache\'s window runs on its own fetch (MUT-287)', async () => {
    const h = harness();
    const upstreamFetchedAt = new Date('2026-10-15T08:00:00Z');
    h.state.snapshot = { ...SNAPSHOT, upstream: { fetchedAt: upstreamFetchedAt, stale: true } };
    await expect(h.cache.get()).resolves.toMatchObject({ fetchedAt: upstreamFetchedAt, source: 'stale', snapshot: { rateDate: '2026-10-15' } });
    h.advance(TTL - 1);
    await expect(h.cache.get()).resolves.toMatchObject({ source: 'stale' });
    expect(h.state.calls).toBe(1);
    h.advance(1);
    h.state.snapshot = { ...SNAPSHOT, upstream: { fetchedAt: new Date('2026-10-15T16:00:00Z'), stale: false } };
    await expect(h.cache.get()).resolves.toMatchObject({ fetchedAt: new Date('2026-10-15T16:00:00Z'), source: 'live' });
  });

  it('refuses with FX_RATES_UNAVAILABLE when nothing is cached and the provider fails', async () => {
    const h = harness();
    h.state.fail = true;
    const error = await h.cache.get().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'FX_RATES_UNAVAILABLE', status: 503 });
  });

  it('does not call a failing provider again inside the backoff, then recovers to live', async () => {
    const h = harness();
    await h.cache.get();
    h.advance(TTL);
    h.state.fail = true;
    await h.cache.get();
    expect(h.state.calls).toBe(2);
    h.advance(BACKOFF - 1);
    await expect(h.cache.get()).resolves.toMatchObject({ source: 'stale' });
    expect(h.state.calls).toBe(2);
    h.advance(1);
    h.state.fail = false;
    await expect(h.cache.get()).resolves.toMatchObject({ source: 'live' });
    expect(h.state.calls).toBe(3);
  });

  it('defaults the failure backoff to one minute', async () => {
    expect(DEFAULT_FX_FAILURE_BACKOFF_MS).toBe(60_000);
    const clock = { now: new Date('2026-10-15T12:00:00Z') };
    let calls = 0;
    const cache = new CachedFxRates({
      source: {
        async latest() {
          calls += 1;
          throw new Error('provider down');
        },
      },
      ttlMs: TTL,
      now: () => clock.now,
    });
    await cache.get().catch(() => undefined);
    clock.now = new Date(clock.now.getTime() + DEFAULT_FX_FAILURE_BACKOFF_MS - 1);
    await cache.get().catch(() => undefined);
    expect(calls).toBe(1);
    clock.now = new Date(clock.now.getTime() + 1);
    await cache.get().catch(() => undefined);
    expect(calls).toBe(2);
  });

  it('a failing cold burst shares one call, every request is refused, and the first miss after the backoff retries', async () => {
    const h = harness();
    h.gate.hold = true;
    h.state.fail = true;
    const pending = Array.from({ length: 10 }, () => h.cache.get().catch((e: unknown) => e));
    await Promise.resolve();
    h.release();
    const results = await Promise.all(pending);
    expect(h.state.calls).toBe(1);
    expect(results.every((e) => e instanceof ApiError && e.code === 'FX_RATES_UNAVAILABLE')).toBe(true);
    h.gate.hold = false;
    h.state.fail = false;
    h.advance(BACKOFF);
    await expect(h.cache.get()).resolves.toMatchObject({ source: 'live' });
    expect(h.state.calls).toBe(2);
  });

  it(`refuses a provider snapshot whose rate date is more than ${MAX_RATE_AGE_DAYS} days old, and accepts one inside`, async () => {
    expect(MAX_RATE_AGE_DAYS).toBe(7);
    const old = harness();
    old.state.snapshot = { rateDate: '2026-10-08', perEur: SNAPSHOT.perEur }; // 7.5 days before 2026-10-15T12:00Z
    await expect(old.cache.get()).rejects.toMatchObject({ code: 'FX_RATES_UNAVAILABLE' });
    const recent = harness();
    recent.state.snapshot = { rateDate: '2026-10-09', perEur: SNAPSHOT.perEur }; // 6.5 days
    await expect(recent.cache.get()).resolves.toMatchObject({ source: 'live', snapshot: { rateDate: '2026-10-09' } });
  });

  it(`stops serving the last snapshot as stale once its rate date is more than ${MAX_RATE_AGE_DAYS} days old`, async () => {
    const h = harness();
    await h.cache.get(); // rateDate 2026-10-15, fetched 2026-10-15T12:00Z
    h.state.fail = true;
    h.advance(6 * 24 * 60 * 60 * 1000); // 6.5 days after the rate date
    await expect(h.cache.get()).resolves.toMatchObject({ source: 'stale' });
    h.advance(24 * 60 * 60 * 1000); // 7.5 days, past the backoff too
    await expect(h.cache.get()).rejects.toMatchObject({ code: 'FX_RATES_UNAVAILABLE' });
  });

  it('stops serving a live snapshot inside its window once the rate date passes the age cap', async () => {
    const clock = { now: new Date('2026-10-15T12:00:00Z') };
    let calls = 0;
    let fail = false;
    const cache = new CachedFxRates({
      source: {
        async latest() {
          calls += 1;
          if (fail) throw new Error('provider down');
          return { rateDate: '2026-10-09', perEur: SNAPSHOT.perEur }; // 6.5 days old
        },
      },
      ttlMs: 24 * 60 * 60 * 1000,
      now: () => clock.now,
    });
    await expect(cache.get()).resolves.toMatchObject({ source: 'live' });
    clock.now = new Date(clock.now.getTime() + 12 * 60 * 60 * 1000 + 1); // 7 days and 1 ms, still inside the 24 h window
    fail = true;
    await expect(cache.get()).rejects.toMatchObject({ code: 'FX_RATES_UNAVAILABLE' });
    expect(calls).toBe(2);
  });

  it.each([
    ['in the future', '2026-10-17'],
    ['not a calendar date', '2026-13-01'],
  ])('treats a rate date %s as unusable', async (_label, rateDate) => {
    const h = harness();
    h.state.snapshot = { rateDate, perEur: SNAPSHOT.perEur };
    await expect(h.cache.get()).rejects.toMatchObject({ code: 'FX_RATES_UNAVAILABLE' });
  });

  it('accepts a rate date up to a day ahead of the server clock (the ECB publishes in CET)', async () => {
    const h = harness();
    h.state.snapshot = { rateDate: '2026-10-16', perEur: SNAPSHOT.perEur }; // 12 h ahead of 2026-10-15T12:00Z
    await expect(h.cache.get()).resolves.toMatchObject({ source: 'live' });
  });

  it.each([
    ['too old', '2026-10-01'],
    ['in the future', '2026-10-20'],
  ])('a provider answer %s does not replace good cached rates: they keep coming back as stale', async (_label, rateDate) => {
    const h = harness();
    await h.cache.get();
    h.advance(TTL);
    h.state.snapshot = { rateDate, perEur: { USD: 9, ILS: 9 } };
    await expect(h.cache.get()).resolves.toEqual({ snapshot: SNAPSHOT, fetchedAt: new Date('2026-10-15T12:00:00Z'), source: 'stale' });
    expect(h.state.calls).toBe(2);
  });

  it('a request that joins a failing warm-up is refused, and the next request tries the provider again', async () => {
    const h = harness();
    h.gate.hold = true;
    h.state.fail = true;
    const warming = h.cache.warm();
    const joined = h.cache.get().catch((e: unknown) => e);
    await Promise.resolve();
    h.release();
    await warming;
    expect(await joined).toMatchObject({ code: 'FX_RATES_UNAVAILABLE' });
    expect(h.state.calls).toBe(1);
    h.gate.hold = false;
    h.state.fail = false;
    await expect(h.cache.get()).resolves.toMatchObject({ source: 'live' });
    expect(h.state.calls).toBe(2);
  });

  it('warm() fills the cache, so the first request does not call the provider', async () => {
    const h = harness();
    await h.cache.warm();
    expect(h.state.calls).toBe(1);
    await expect(h.cache.get()).resolves.toMatchObject({ source: 'live' });
    expect(h.state.calls).toBe(1);
  });

  it('a failed warm() does not start the backoff: the first request still tries the provider', async () => {
    const h = harness();
    h.state.fail = true;
    await expect(h.cache.warm()).resolves.toBeUndefined();
    h.state.fail = false;
    await expect(h.cache.get()).resolves.toMatchObject({ source: 'live' });
    expect(h.state.calls).toBe(2);
  });

  it('keeps refusing inside the backoff when nothing was ever cached', async () => {
    const h = harness();
    h.state.fail = true;
    await h.cache.get().catch(() => undefined);
    h.advance(BACKOFF - 1);
    await expect(h.cache.get()).rejects.toMatchObject({ code: 'FX_RATES_UNAVAILABLE' });
    expect(h.state.calls).toBe(1);
  });
});
