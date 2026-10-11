import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';

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

export function createPortalQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: STALE_MS, retry: retryTransient },
      mutations: { retry: false },
    },
  });
}
