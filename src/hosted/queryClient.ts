import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { ME_KEY } from './session/me';

/**
 * The portal's query client. The cache lives in memory only: no persister, no
 * service worker (hosted-portal.md §7.5), so closing the tab leaves no figure.
 */

const STALE_MS = 30_000;
const TRANSIENT_RETRIES = 1;

/** Retry once when the server was unreachable or failed; never on an answer (4xx). */
function retryTransient(failureCount: number, error: unknown): boolean {
  const transient = error instanceof ApiError && (error.status === 0 || error.status >= 500);
  return transient && failureCount < TRANSIENT_RETRIES;
}

/**
 * MUT-361 (ADR-181): a refusal from the lapse gate means the profile's plan changed under the page (the trial ran out,
 * a payment lapsed). `/v1/me` is read again, so its banner, its disabled actions or the locked screen take over.
 */
export function isLapseRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'SUBSCRIPTION_LAPSED';
}

/** `defaultOptions` replaces the portal's own (tests: no retries, no stale time); the lapse handling stays. */
export function createPortalQueryClient(defaultOptions?: DefaultOptions): QueryClient {
  const rereadMe = (error: unknown) => {
    if (isLapseRefusal(error)) void client.invalidateQueries({ queryKey: ME_KEY });
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: rereadMe }),
    mutationCache: new MutationCache({ onError: rereadMe }),
    defaultOptions: defaultOptions ?? {
      queries: { staleTime: STALE_MS, retry: retryTransient },
      mutations: { retry: false },
    },
  });
  return client;
}
