import { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import { BootSplash } from '../../components/brand/BootSplash';
import { LandingProviders } from './LandingProviders';
import { reportLandingCrash } from './observability/landingErrorReporting';
import { LandingCrashScreen } from './observability/LandingCrashScreen';

/**
 * A website page as `src/main.tsx` mounts it (MUT-150): the landing's
 * providers, a crash screen in the visitor's language that reports the crash
 * once (with its component stack), and the lazy page chunk's splash.
 */
export function LandingShell({ children }: { children: ReactNode }) {
  return (
    <LandingProviders>
      <ErrorBoundary onError={(error, info) => reportLandingCrash(error, info.componentStack ?? undefined)} fallback={<LandingCrashScreen />}>
        <Suspense fallback={<BootSplash />}>{children}</Suspense>
      </ErrorBoundary>
    </LandingProviders>
  );
}
