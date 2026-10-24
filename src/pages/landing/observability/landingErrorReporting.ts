import { afterLoadIdle } from '../afterLoadIdle';
import { landingRoute } from '../marketingPath';
import type { LandingReporter, LandingSentryModule } from './landingSentry';

declare const __LANDING_SENTRY_ENABLED__: boolean | undefined;

/**
 * The landing's error-report gate (MUT-150, ADR-091). In the web entry, and
 * small: the Sentry SDK is a lazy chunk (`landingSentry.ts`), loaded after the
 * page has loaded and gone idle, and only on a website page (`landingRoute`),
 * never on the local app's routes, which send nothing (ADR-024). A web build
 * without a DSN turns the gate off at compile time, so that chunk isn't
 * emitted at all; the desktop build never calls it.
 *
 * `main.tsx` starts it before React renders (eng O5). Until the chunk arrives
 * the gate holds the first few window errors, unhandled rejections and
 * boundary crashes, and hands them over once the SDK is up; after that the
 * SDK's own handlers own window errors, so nothing is sent twice (eng O8).
 */

/** True in a web build with a landing DSN (vite.config.ts); false in every other build and in Vitest. */
export const LANDING_SENTRY_ENABLED: boolean = typeof __LANDING_SENTRY_ENABLED__ !== 'undefined' && __LANDING_SENTRY_ENABLED__ === true;

/** How many errors the gate holds before the SDK arrives, as the portal's (MUT-149 D2). */
export const EARLY_QUEUE_LIMIT = 10;

type Held = { source: 'global'; error: unknown } | { source: 'boundary'; error: unknown; componentStack: string | undefined };

export interface LandingErrorReportingOptions {
  enabled: boolean;
  /** Loads the SDK chunk; tests pass a fake. */
  load?: () => Promise<LandingSentryModule>;
  /** When to load it; tests fire it by hand. */
  schedule?: (run: () => void) => () => void;
}

let started = false;
let reporter: LandingReporter | null = null;
let held: Held[] = [];

const loadChunk = LANDING_SENTRY_ENABLED ? () => import('./landingSentry') : null;

/** Only website pages may report (eng R1): a page that became something else holds nothing. */
const onWebsitePage = () => landingRoute(window.location.pathname) !== null;

function hold(entry: Held) {
  if (!onWebsitePage() || held.length >= EARLY_QUEUE_LIMIT) return;
  held.push(entry);
}

/** No error object means a cross-origin script's "Script error.": nothing in it to act on. */
function onError(event: ErrorEvent) {
  if (!reporter && event.error != null) hold({ source: 'global', error: event.error });
}

/** A rejection with no reason carries nothing to act on either. */
function onRejection(event: PromiseRejectionEvent) {
  if (!reporter && event.reason != null) hold({ source: 'global', error: event.reason });
}

function stopListening() {
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
}

function replay(target: LandingReporter) {
  const queue = held;
  held = [];
  if (!onWebsitePage()) return;
  for (const entry of queue) {
    if (entry.source === 'global') target.reportGlobal(entry.error);
    else target.reportBoundary(entry.error, entry.componentStack);
  }
}

function load(loader: () => Promise<LandingSentryModule>) {
  loader()
    .then(({ startLandingSentry }) => {
      if (!onWebsitePage()) {
        held = [];
        return;
      }
      reporter = startLandingSentry();
      replay(reporter);
    })
    .catch(() => {
      // An ad blocker, a flaky network or a stale tab after a deploy: report nothing, never throw,
      // and hold nothing more for the rest of this page load
      held = [];
      stopListening();
    });
}

/** Called once by `main.tsx`, before React renders, on the web build only. */
export function startLandingErrorReporting(options: LandingErrorReportingOptions): void {
  if (started || !options.enabled || typeof window === 'undefined' || !onWebsitePage()) return;
  const loader = options.load ?? loadChunk;
  if (!loader) return;
  started = true;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  (options.schedule ?? afterLoadIdle)(() => load(loader));
}

/** A crash the landing's error boundary caught (its `onError`). */
export function reportLandingCrash(error: unknown, componentStack?: string): void {
  if (!started) return;
  if (reporter) reporter.reportBoundary(error, componentStack);
  else hold({ source: 'boundary', error, componentStack });
}

export function resetLandingErrorReportingForTests(): void {
  if (started) stopListening();
  started = false;
  reporter = null;
  held = [];
}
