import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from '../lib/theme';
import { ToastProvider } from './components/Toast';
import { HostedLanguageProvider } from './i18n/HostedLanguageProvider';
import type { PortalRouter } from './router';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { ReloadToContinue } from './pages/auth/BootScreens';
import { reportBoundaryError } from './observability/errorReporting';

/**
 * Providers for the hosted portal. The query cache lives in memory only: no
 * persister, no service worker (hosted-portal.md §7.5), so closing the tab
 * leaves no figure behind.
 */

export function PortalProviders({ queryClient, router }: { queryClient: QueryClient; router: PortalRouter }) {
  return (
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ThemeProvider>
          <ToastProvider>
            {/* MUT-149: a crash outside the router's own boundaries, shown translated and reported */}
            <ErrorBoundary fallback={<ReloadToContinue stop="CRASH" />} onError={(error, info) => reportBoundaryError(error, info.componentStack ?? undefined)}>
              <RouterProvider router={router} />
            </ErrorBoundary>
          </ToastProvider>
        </ThemeProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>
  );
}
