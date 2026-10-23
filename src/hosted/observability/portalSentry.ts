import * as Sentry from '@sentry/browser';
import type { ErrorEvent, EventHint } from '@sentry/browser';
import { browserSentryOptions } from '../../lib/observability/browserSentry';
import { APP_VERSION } from '../../lib/appVersion';
import { ApiError } from '../api/client';
import { currentMode } from '../session/mode';

declare const __SENTRY_DSN__: string | undefined;
declare const __SENTRY_RELEASE__: string | undefined;
declare const __SENTRY_ENVIRONMENT__: string | undefined;

/**
 * The portal's Sentry SDK (MUT-149, ADR-091 am.11): the one portal file that
 * imports it, loaded lazily by `errorReporting.ts` and only while someone is
 * signed in. Errors only: no tracing, replay or feedback, and every event
 * leaves through the shared scrubber (`browserSentryOptions`).
 */

export interface PortalSentryHooks {
  /** The current route's id, a template like `/authed/p/$profileId/clients`, never the concrete path. */
  currentRouteId: () => string | undefined;
}

export interface PortalReporter {
  /** A window error or unhandled rejection the gate held before the SDK arrived. */
  reportGlobal: (error: unknown) => void;
  /** A crash an error boundary or the router caught. */
  reportBoundary: (error: unknown, componentStack?: string) => void;
  setUser: (id: string | null) => void;
  stop: () => void;
}

export interface PortalSentryModule {
  startPortalSentry: (hooks: PortalSentryHooks) => PortalReporter;
}

export interface PortalSentryConfig {
  dsn: string;
  release: string;
  environment: string;
  /** Tests record envelopes here instead of sending them. */
  transport?: Sentry.BrowserOptions['transport'];
}

const define = (value: string | undefined, fallback: string) => (value ? value : fallback);

/** From the hosted build's defines (vite.config.ts `sentryDefines`). */
const BUILD_CONFIG: PortalSentryConfig = {
  dsn: define(typeof __SENTRY_DSN__ !== 'undefined' ? __SENTRY_DSN__ : undefined, ''),
  release: define(typeof __SENTRY_RELEASE__ !== 'undefined' ? __SENTRY_RELEASE__ : undefined, `mutaba3a-portal@${APP_VERSION}`),
  environment: define(typeof __SENTRY_ENVIRONMENT__ !== 'undefined' ? __SENTRY_ENVIRONMENT__ : undefined, 'development'),
};

/** Errors a boundary or the router reported: a crash, even when it is an ApiError. */
const crashed = new WeakSet<object>();

/**
 * AC2 (eng F14): every ApiError that reaches the window is a failure the UI
 * owns, whatever its status; the server reports its own 5xx (MUT-148). Only
 * one that crashed a page is sent.
 */
export function dropHandled(_event: ErrorEvent, hint: EventHint): boolean {
  const error = hint.originalException;
  return error instanceof ApiError && !crashed.has(error);
}

/**
 * Signed out, nothing leaves (ADR-097 §10), even what the SDK's own window
 * handlers catch: another tab's sign-out may not have reached the gate (a
 * crash screen replaced the router that listens), and close() is async.
 * The mode is read live from storage at send time.
 */
const dropEvent = (event: ErrorEvent, hint: EventHint) => currentMode() !== 'remote' || dropHandled(event, hint);

/** Navigation and fetch breadcrumbs only: no console (contract), no DOM clicks (their text can be a client's name). */
const integrations = () => [
  Sentry.globalHandlersIntegration(),
  Sentry.breadcrumbsIntegration({ dom: false, sentry: false, xhr: false, fetch: true, history: true }),
  Sentry.linkedErrorsIntegration(),
  Sentry.dedupeIntegration(),
  Sentry.httpContextIntegration(),
];

export function startPortalSentry(hooks: PortalSentryHooks, config: PortalSentryConfig = BUILD_CONFIG): PortalReporter {
  Sentry.init({
    ...browserSentryOptions('portal', {
      dsn: config.dsn,
      release: config.release,
      environment: config.environment,
      dropEvent,
      tags: () => ({ locale: document.documentElement.lang || undefined, route: hooks.currentRouteId(), app_build: APP_VERSION }),
    }),
    integrations: integrations(),
    ...(config.transport ? { transport: config.transport } : {}),
  });

  // close() finishes asynchronously; nothing captured after stop() may still go out
  let stopped = false;
  return {
    reportGlobal: (error) => {
      if (!stopped) Sentry.captureException(error);
    },
    reportBoundary: (error, componentStack) => {
      if (stopped) return;
      if (typeof error === 'object' && error !== null) crashed.add(error);
      const requestId = error instanceof ApiError ? error.requestId : null;
      Sentry.captureException(error, {
        tags: requestId ? { request_id: requestId } : {},
        contexts: componentStack ? { react: { componentStack } } : {},
      });
    },
    setUser: (id) => {
      if (!stopped) Sentry.setUser(id ? { id } : null);
    },
    stop: () => {
      stopped = true;
      Sentry.setUser(null);
      void Sentry.close();
    },
  };
}
