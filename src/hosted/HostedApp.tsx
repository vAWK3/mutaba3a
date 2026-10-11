import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from '../lib/theme';
import { ApiError } from './api/client';
import { ToastProvider } from './components/Toast';
import { HostedLanguageProvider } from './i18n/HostedLanguageProvider';
import type { PortalRouter } from './router';

/**
 * Providers for the hosted portal. The query cache lives in memory only: no
 * persister, no service worker (hosted-portal.md §7.5), so closing the tab
 * leaves no figure behind.
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

export function PortalProviders({ queryClient, router }: { queryClient: QueryClient; router: PortalRouter }) {
  return (
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ThemeProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </ThemeProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>
  );
}
