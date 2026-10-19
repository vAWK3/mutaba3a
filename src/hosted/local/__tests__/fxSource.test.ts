import { describe, expect, it, vi } from 'vitest';
import { CachedFxRates } from '../../../../server/src/fx-rates.js';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { createLocalApp } from '../createLocalApp.js';
import { FX_MEMORY_KEY, PUBLIC_FX_PATH, PublicFxRateSource } from '../fxSource.js';
import { mintLocalSession } from '../mintLocalSession.js';

/**
 * MUT-287 (MUT-285 D3, brief §7): signed out, the local app's own
 * GET /v1/fx-rates runs the server's CachedFxRates + crossRates over the
 * snapshot the server publishes at GET /v1/public/fx-rates. Offline, the
 * route answers 503 and the ≈ line hides through its existing failure path.
 */
const NOW = new Date('2026-10-19T09:00:00Z');
const BODY = { rateDate: '2026-10-17', perEur: { USD: 1.1208, ILS: 3.4769 }, fetchedAt: '2026-10-19T08:00:00.000Z', source: 'live' };

/** A Storage-shaped map, so each case starts with an empty device memory. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v) };
}

function respond(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn(async () => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } }));
}

describe('PublicFxRateSource', () => {
  it('reads the public snapshot without credentials and returns it as an ECB snapshot', async () => {
    const fetch = respond(BODY);

    const snapshot = await new PublicFxRateSource({ fetch, storage: memoryStorage(), now: () => NOW }).latest();

    expect(snapshot).toEqual({ rateDate: '2026-10-17', perEur: { USD: 1.1208, ILS: 3.4769 }, upstream: { fetchedAt: new Date('2026-10-19T08:00:00.000Z'), stale: false } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PUBLIC_FX_PATH);
    expect(PUBLIC_FX_PATH).toBe('/v1/public/fx-rates');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });

  it('fails on a non-2xx answer (rate-limited, or the server has no rates)', async () => {
    await expect(new PublicFxRateSource({ fetch: respond({ error: { code: 'RATE_LIMITED' } }, { status: 429 }), storage: memoryStorage(), now: () => NOW }).latest()).rejects.toThrow();
  });

  it('fails on a body that is not the snapshot shape', async () => {
    await expect(new PublicFxRateSource({ fetch: respond({ rateDate: '2026-10-17', perEur: { USD: -1 } }), storage: memoryStorage(), now: () => NOW }).latest()).rejects.toThrow();
  });

  it('fails when the network does', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(new PublicFxRateSource({ fetch: offline, storage: memoryStorage(), now: () => NOW }).latest()).rejects.toThrow();
  });

  it('relays the server\'s staleness and fetch time (D7)', async () => {
    const snapshot = await new PublicFxRateSource({ fetch: respond({ ...BODY, source: 'stale' }), storage: memoryStorage(), now: () => NOW }).latest();

    expect(snapshot.upstream).toEqual({ fetchedAt: new Date('2026-10-19T08:00:00.000Z'), stale: true });
  });

  it('remembers the snapshot on this device and reuses it for an hour, across page loads (D8)', async () => {
    const storage = memoryStorage();
    const fetch = respond(BODY);
    await new PublicFxRateSource({ fetch, storage, now: () => NOW }).latest();

    const nextPage = new PublicFxRateSource({ fetch, storage, now: () => new Date(NOW.getTime() + 59 * 60 * 1000) });
    await expect(nextPage.latest()).resolves.toMatchObject({ rateDate: '2026-10-17', upstream: { stale: false } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.items.get(FX_MEMORY_KEY)!).rateDate).toBe('2026-10-17');

    await new PublicFxRateSource({ fetch, storage, now: () => new Date(NOW.getTime() + 61 * 60 * 1000) }).latest();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a saved snapshot it cannot read, and works without storage at all', async () => {
    const storage = memoryStorage();
    storage.items.set(FX_MEMORY_KEY, '{not json');
    const fetch = respond(BODY);
    await expect(new PublicFxRateSource({ fetch, storage, now: () => NOW }).latest()).resolves.toMatchObject({ rateDate: '2026-10-17' });
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    await expect(new PublicFxRateSource({ fetch, storage: throwing, now: () => NOW }).latest()).resolves.toMatchObject({ rateDate: '2026-10-17' });
  });
});

describe('GET /v1/fx-rates signed out', () => {
  async function localApp(fetch: ReturnType<typeof vi.fn>) {
    const store = new MemoryLedgerStore();
    const { token } = await mintLocalSession(store, () => NOW);
    const fxRates = new CachedFxRates({ source: new PublicFxRateSource({ fetch, storage: memoryStorage(), now: () => NOW }), ttlMs: 60 * 60 * 1000, now: () => NOW });
    const app = createLocalApp({ store, now: () => NOW, fxRates });
    return (path: string) => app.fetch(new Request(`http://local${path}`, { headers: { Authorization: `Bearer ${token}` } }));
  }

  it('answers cross rates from the public snapshot, through the same crossRates as the server', async () => {
    const get = await localApp(respond(BODY));

    const response = await get('/v1/fx-rates?base=ILS');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { base: string; rateDate: string; rates: Array<{ currency: string; rate: number }> };
    expect(body.base).toBe('ILS');
    expect(body.rateDate).toBe('2026-10-17');
    expect(body.rates.find((r) => r.currency === 'USD')?.rate).toBe(Number((1.1208 / 3.4769).toFixed(6)));
  });

  it('answers 503 FX_RATES_UNAVAILABLE offline, so the ≈ line hides', async () => {
    const get = await localApp(
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const response = await get('/v1/fx-rates?base=ILS');

    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('FX_RATES_UNAVAILABLE');
  });

  it('asks the network once per cache window, however many times the page asks', async () => {
    const fetch = respond(BODY);
    const get = await localApp(fetch);

    await get('/v1/fx-rates?base=ILS');
    await get('/v1/fx-rates?base=USD');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('answers stale signed out when the server is serving stale rates, like signed in (D7)', async () => {
    const get = await localApp(respond({ ...BODY, source: 'stale' }));

    const body = (await (await get('/v1/fx-rates?base=ILS')).json()) as { source: string; fetchedAt: string };

    expect(body.source).toBe('stale');
    expect(body.fetchedAt).toBe('2026-10-19T08:00:00.000Z');
  });

  it('never serves the public route itself: that one lives only on the server', async () => {
    const get = await localApp(respond(BODY));

    expect((await get('/v1/public/fx-rates')).status).toBe(404);
  });
});
