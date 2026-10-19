import type { EcbSnapshot, FxRateSource } from '../../../server/src/fx-rates.js';
import { PublicFxRatesResponseSchema } from '../../../server/src/schemas.js';

/** The server's anonymous snapshot route (MUT-287). The one request signed-out mode ever sends past the first-visit check (D3). */
export const PUBLIC_FX_PATH = '/v1/public/fx-rates';

/** Long enough that a stuck network never holds the ≈ line's request for long; it hides on failure. */
const FETCH_TIMEOUT_MS = 8_000;

export interface PublicFxRateSourceOptions {
  /** Injectable for tests; defaults to the page's own `fetch`. Never `api/client.ts`: signed out, that routes every `/v1` call back into this backend. */
  fetch?: typeof fetch;
}

/**
 * The local backend's `FxRateSource` (MUT-287; MUT-285 D3, brief §7). Feeds
 * the server's own `CachedFxRates`, so the local GET /v1/fx-rates runs the
 * same `crossRates`, JOD peg, age rules and backoff as the server. Sent
 * without credentials: the route is public, and no cookie or local identity
 * goes with it. Any failure (offline, 429, 503, a bad body) throws, which the
 * cache turns into 503 FX_RATES_UNAVAILABLE and the ≈ line hides.
 */
export class PublicFxRateSource implements FxRateSource {
  constructor(private readonly options: PublicFxRateSourceOptions = {}) {}

  async latest(): Promise<EcbSnapshot> {
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(PUBLIC_FX_PATH, { headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', signal: timeoutSignal() });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Public FX rates answered ${response.status}`);
    }
    const body = PublicFxRatesResponseSchema.parse(await response.json());
    return { rateDate: body.rateDate, perEur: body.perEur };
  }
}

function timeoutSignal(): AbortSignal | null {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : null;
}
