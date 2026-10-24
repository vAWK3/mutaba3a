import * as Sentry from '@sentry/browser';
import { browserSentryOptions } from '../../../lib/observability/browserSentry';
import { APP_VERSION } from '../../../lib/appVersion';
import { landingRoute } from '../marketingPath';

declare const __LANDING_SENTRY_DSN__: string | undefined;
declare const __LANDING_SENTRY_RELEASE__: string | undefined;
declare const __LANDING_SENTRY_ENVIRONMENT__: string | undefined;

/**
 * The landing's Sentry SDK (MUT-150, ADR-091): the one landing file that
 * imports it, loaded lazily by `landingErrorReporting.ts` on website pages
 * only, never on the local app's routes (ADR-024). Errors only: no tracing,
 * replay, feedback or user, and every event leaves through the shared
 * scrubber (`browserSentryOptions`).
 */

/** Reports one page load may send (eng R2): a crash loop can't spend the quota every surface shares (TD-200). */
export const MAX_REPORTS_PER_PAGE = 5;

export interface LandingReporter {
  /** A window error or unhandled rejection the gate held before the SDK arrived. */
  reportGlobal: (error: unknown) => void;
  /** A crash the landing's error boundary caught. */
  reportBoundary: (error: unknown, componentStack?: string) => void;
}

export interface LandingSentryModule {
  startLandingSentry: () => LandingReporter;
}

export interface LandingSentryConfig {
  dsn: string;
  release: string;
  environment: string;
  /** Tests record envelopes here instead of sending them. */
  transport?: Sentry.BrowserOptions['transport'];
}

const define = (value: string | undefined, fallback: string) => (value ? value : fallback);

/** From the web build's defines (vite.config.ts `landingSentry`). */
const BUILD_CONFIG: LandingSentryConfig = {
  dsn: define(typeof __LANDING_SENTRY_DSN__ !== 'undefined' ? __LANDING_SENTRY_DSN__ : undefined, ''),
  release: define(typeof __LANDING_SENTRY_RELEASE__ !== 'undefined' ? __LANDING_SENTRY_RELEASE__ : undefined, `mutaba3a-landing@${APP_VERSION}`),
  environment: define(typeof __LANDING_SENTRY_ENVIRONMENT__ !== 'undefined' ? __LANDING_SENTRY_ENVIRONMENT__ : undefined, 'development'),
};

/** Read at send time: nothing leaves once the page isn't a website page (eng R1, ADR-024). */
const currentRoute = () => landingRoute(window.location.pathname);

/** Navigation and fetch breadcrumbs only: no console (contract), no DOM clicks (their text can be what a visitor typed). */
const integrations = () => [
  Sentry.globalHandlersIntegration(),
  Sentry.breadcrumbsIntegration({ dom: false, sentry: false, xhr: false, fetch: true, history: true }),
  Sentry.linkedErrorsIntegration(),
  Sentry.dedupeIntegration(),
  Sentry.httpContextIntegration(),
];

/** The shared options, with the per-page cap counting only events that actually leave (eng R2). */
function landingOptions(config: LandingSentryConfig): Sentry.BrowserOptions {
  const options = browserSentryOptions('landing', {
    dsn: config.dsn,
    release: config.release,
    environment: config.environment,
    dropEvent: () => currentRoute() === null,
    tags: () => ({ locale: document.documentElement.lang || undefined, route: currentRoute() ?? undefined, app_build: APP_VERSION }),
  });
  const send = options.beforeSend;
  let left = MAX_REPORTS_PER_PAGE;
  return {
    ...options,
    beforeSend: (event, hint) => {
      if (left === 0 || !send) return null;
      const out = send(event, hint);
      if (out !== null) left -= 1;
      return out;
    },
  };
}

export function startLandingSentry(config: LandingSentryConfig = BUILD_CONFIG): LandingReporter {
  Sentry.init({
    ...landingOptions(config),
    integrations: integrations(),
    ...(config.transport ? { transport: config.transport } : {}),
  });
  return {
    reportGlobal: (error) => {
      Sentry.captureException(error);
    },
    reportBoundary: (error, componentStack) => {
      Sentry.captureException(error, { contexts: componentStack ? { react: { componentStack } } : {} });
    },
  };
}
