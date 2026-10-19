import type { EcbSnapshot, FxRateSource } from '../../../server/src/fx-rates.js';
import { PUBLIC_FX_RATES_PATH } from '../../../server/src/routes/fx-rates.js';
import { PublicFxRatesResponseSchema } from '../../../server/src/schemas.js';

/** The server's anonymous snapshot route (MUT-287), named once on the server. The one request signed-out mode ever sends past the first-visit check (D3). */
export const PUBLIC_FX_PATH = PUBLIC_FX_RATES_PATH;

/** Where this device keeps the last public snapshot it read (localStorage; review D8). */
export const FX_MEMORY_KEY = 'mut-local-fx';

/** Long enough that a stuck network never holds the ≈ line's request for long; it hides on failure. */
const FETCH_TIMEOUT_MS = 8_000;

/** How long a remembered snapshot is reused across page loads before asking again; the same window as the page's own cache. */
const MEMORY_MAX_AGE_MS = 60 * 60 * 1000;

type DeviceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface PublicFxRateSourceOptions {
  /** Injectable for tests; defaults to the page's own `fetch`. Never `api/client.ts`: signed out, that routes every `/v1` call back into this backend. */
  fetch?: typeof fetch;
  /** Injectable for tests; defaults to `localStorage`. Any failure reading or writing it is ignored. */
  storage?: DeviceStorage | null;
  now?: () => Date;
}

const PublicFxMemory = PublicFxRatesResponseSchema.extend({ savedAt: PublicFxRatesResponseSchema.shape.fetchedAt });
type PublicFxBody = ReturnType<typeof PublicFxRatesResponseSchema.parse>;

/**
 * The local backend's `FxRateSource` (MUT-287; MUT-285 D3, brief §7). Feeds
 * the server's own `CachedFxRates`, so the local GET /v1/fx-rates runs the
 * same `crossRates`, JOD peg, age rules and backoff as the server, and relays
 * the server's staleness (`upstream`, review D7) so signed out reads exactly
 * like signed in. The last snapshot is remembered on this device for an hour,
 * so reloads and new tabs don't each ask (review D8). Sent without
 * credentials: the route is public, and no cookie or local identity goes with
 * it. Any failure (offline, 429, 503, a bad body) throws, which the cache
 * turns into 503 FX_RATES_UNAVAILABLE and the ≈ line hides.
 */
export class PublicFxRateSource implements FxRateSource {
  constructor(private readonly options: PublicFxRateSourceOptions = {}) {}

  async latest(): Promise<EcbSnapshot> {
    const now = (this.options.now ?? (() => new Date()))();
    const remembered = this.recall(now);
    if (remembered) return toSnapshot(remembered);

    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(PUBLIC_FX_PATH, { headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', signal: timeoutSignal() });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Public FX rates answered ${response.status}`);
    }
    const body = PublicFxRatesResponseSchema.parse(await response.json());
    this.remember(body, now);
    return toSnapshot(body);
  }

  private storage(): DeviceStorage | null {
    if (this.options.storage !== undefined) return this.options.storage;
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private recall(now: Date): PublicFxBody | null {
    try {
      const raw = this.storage()?.getItem(FX_MEMORY_KEY);
      if (!raw) return null;
      const saved = PublicFxMemory.parse(JSON.parse(raw));
      const age = now.getTime() - Date.parse(saved.savedAt);
      return age >= 0 && age < MEMORY_MAX_AGE_MS ? saved : null;
    } catch {
      return null;
    }
  }

  private remember(body: PublicFxBody, now: Date): void {
    try {
      this.storage()?.setItem(FX_MEMORY_KEY, JSON.stringify({ ...body, savedAt: now.toISOString() }));
    } catch {
      // Private mode or storage full: the page's own cache still works.
    }
  }
}

function toSnapshot(body: PublicFxBody): EcbSnapshot {
  return { rateDate: body.rateDate, perEur: body.perEur, upstream: { fetchedAt: new Date(body.fetchedAt), stale: body.source === 'stale' } };
}

/** `AbortSignal.timeout` where the engine has it; an AbortController on a timer otherwise (iOS 15 Safari), so a stuck request always ends. */
function timeoutSignal(): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return controller.signal;
}
