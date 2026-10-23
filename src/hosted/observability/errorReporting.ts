import { currentMode, subscribeMode } from '../session/mode';
import type { PortalReporter, PortalSentryModule, PortalSentryHooks } from './portalSentry';

declare const __SENTRY_ENABLED__: boolean | undefined;

/**
 * The portal's crash-reporting gate (MUT-149 D1, ADR-091 am.11). Always in the
 * entry, and small: the Sentry SDK is a lazy chunk (`portalSentry.ts`), loaded
 * only while someone is signed in (`remote` mode), never signed out (ADR-097
 * §10). A build without a DSN turns the gate off at compile time, so that
 * chunk isn't emitted at all.
 *
 * A crash at start-up happens before the chunk can arrive, so until it does
 * the gate catches window errors, unhandled rejections and boundary reports
 * itself, holds the first few in memory, and hands them over once the SDK is
 * up (eng R1). It drops them the moment the visit turns out to be signed out.
 * After that the SDK's own handlers own window errors, so nothing is sent twice.
 */

/** True in a hosted build with a DSN (vite.config.ts); false in every other build and in Vitest. */
export const SENTRY_ENABLED: boolean = typeof __SENTRY_ENABLED__ !== 'undefined' && __SENTRY_ENABLED__ === true;

/** How many errors the gate holds before the SDK arrives: enough for a boot crash and what follows it. */
export const EARLY_QUEUE_LIMIT = 10;

type Held = { source: 'global'; error: unknown } | { source: 'boundary'; error: unknown; componentStack: string | undefined };

export interface ErrorReportingOptions extends PortalSentryHooks {
  enabled: boolean;
  /** Loads the SDK chunk; tests pass a fake. */
  load?: () => Promise<PortalSentryModule>;
}

let started = false;
let options: ErrorReportingOptions | null = null;
let reporter: PortalReporter | null = null;
let loading = false;
/** Set when the chunk failed to load; the next mode change is the next try (F11). */
let failed = false;
let held: Held[] = [];
let user: string | null = null;
let unsubscribe: (() => void) | null = null;

const loadChunk = SENTRY_ENABLED ? () => import('./portalSentry') : null;

function hold(entry: Held) {
  if (currentMode() === 'local' || held.length >= EARLY_QUEUE_LIMIT) return;
  held.push(entry);
}

/** No error object means a cross-origin script's "Script error.": nothing in it to act on. */
function onError(event: ErrorEvent) {
  if (!reporter && event.error != null) hold({ source: 'global', error: event.error });
}

function onRejection(event: PromiseRejectionEvent) {
  if (!reporter) hold({ source: 'global', error: event.reason });
}

function replay(target: PortalReporter) {
  const queue = held;
  held = [];
  for (const entry of queue) {
    if (entry.source === 'global') target.reportGlobal(entry.error);
    else target.reportBoundary(entry.error, entry.componentStack);
  }
}

function load(current: ErrorReportingOptions) {
  const loader = current.load ?? loadChunk;
  if (!loader) return;
  loading = true;
  loader()
    .then(({ startPortalSentry }) => {
      loading = false;
      // Signed out while the chunk downloaded: that wins
      if (options !== current || currentMode() !== 'remote') return;
      reporter = startPortalSentry({ currentRouteId: current.currentRouteId });
      reporter.setUser(user);
      replay(reporter);
    })
    .catch(() => {
      // An ad blocker, a flaky network or a stale tab after a deploy: report nothing, never throw
      loading = false;
      failed = true;
      held = [];
    });
}

/** Follows the mode: load when signed in, stop and forget everything when signed out. */
function sync() {
  const current = options;
  if (!current) return;
  const mode = currentMode();
  if (mode === 'local') {
    held = [];
    user = null;
    failed = false;
    reporter?.stop();
    reporter = null;
    return;
  }
  if (mode === 'remote' && !reporter && !loading && !failed) load(current);
}

/** Called once by `main.tsx`, before React renders. */
export function startErrorReporting(next: ErrorReportingOptions): void {
  if (started || !next.enabled || typeof window === 'undefined') return;
  started = true;
  options = next;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  unsubscribe = subscribeMode(sync);
  sync();
}

/** A crash an error boundary or the router caught: always a crash, even an `ApiError` (eng F14). */
export function reportBoundaryError(error: unknown, componentStack?: string): void {
  if (!started) return;
  if (reporter) reporter.reportBoundary(error, componentStack);
  else hold({ source: 'boundary', error, componentStack });
}

/** The signed-in person's internal id, the only user field reports carry (AC3, eng D5); null forgets it. */
export function setReporterUser(id: string | null): void {
  user = id;
  reporter?.setUser(id);
}

export function resetErrorReportingForTests(): void {
  if (started) {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  options = null;
  reporter = null;
  loading = false;
  failed = false;
  held = [];
  user = null;
}
