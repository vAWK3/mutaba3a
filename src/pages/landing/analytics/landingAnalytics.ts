import { useEffect } from 'react';
import type { PostHogConfig } from 'posthog-js';
import { posthogInitOptions } from '../../../lib/analytics/posthogConfig';
import type { AnalyticsLocale } from '../../../lib/analytics/contract';
import { APP_VERSION } from '../../../lib/appVersion';
import { HOSTED_OFFER_URL } from '../../../content/download-config';

/**
 * The landing pages' cookieless visit counts (MUT-154, ADR-090, D1). Only the
 * lazily loaded landing page chunks call `useLandingAnalytics`; nothing in
 * `main.tsx` or `LandingProviders` may, because the local app shares them and
 * must never carry the SDK (ADR-024). posthog-js is loaded with a dynamic
 * import into its own chunk, after the page is idle, and only when the build
 * has a key. Every event leaves through the contract guard (README rule 1).
 */

export type LandingCta = 'app_store' | 'play_store' | 'open_web_app' | 'hosted_offer' | 'malafat';

/** The slice of posthog-js the landing uses, so tests can hand in a fake. */
export interface PostHogLike {
  init: (key: string, options: Partial<PostHogConfig>) => unknown;
  capture: (event: string, properties?: Record<string, unknown>, options?: { send_instantly?: boolean }) => unknown;
}

interface StartDeps {
  key: string;
  load: () => Promise<PostHogLike>;
}

/** The build's key; Vitest has no build-time globals. */
export function landingPosthogKey(): string {
  return typeof __POSTHOG_KEY__ !== 'undefined' ? __POSTHOG_KEY__ : '';
}

const DEFAULT_DEPS = (): StartDeps => ({
  key: landingPosthogKey(),
  load: () => import('posthog-js').then((module) => module.default as unknown as PostHogLike),
});

const isPath = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** Which counted call to action `href` is, or null for anything else (desktop downloads, sign-in, anchors). */
export function ctaForHref(href: string, origin: string): LandingCta | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin === origin) {
    if (isPath(url.pathname, '/app')) return 'open_web_app';
    if (isPath(url.pathname, HOSTED_OFFER_URL)) return 'hosted_offer';
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname === 'apps.apple.com') return 'app_store';
  if (url.hostname === 'play.google.com') return 'play_store';
  if (url.hostname === 'malafat.app' || url.hostname.endsWith('.malafat.app')) return 'malafat';
  return null;
}

const visibleLocale = (): AnalyticsLocale => (document.documentElement.lang === 'en' ? 'en' : 'ar');

let started: Promise<PostHogLike | null> | null = null;
let clickListener: ((event: MouseEvent) => void) | null = null;

function listenForCtas(posthog: PostHogLike) {
  clickListener = (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const cta = anchor ? ctaForHref(anchor.getAttribute('href') ?? '', window.location.origin) : null;
    if (cta) posthog.capture('landing_cta_clicked', { cta }, { send_instantly: true });
  };
  document.addEventListener('click', clickListener, { capture: true });
}

async function start(deps: StartDeps): Promise<PostHogLike | null> {
  if (!deps.key) return null;
  try {
    const posthog = await deps.load();
    posthog.init(
      deps.key,
      posthogInitOptions(() => ({ surface: 'landing', appVersion: APP_VERSION, locale: visibleLocale(), origin: window.location.origin })),
    );
    listenForCtas(posthog);
    return posthog;
  } catch {
    // An ad blocker or a network failure must never break the page
    return null;
  }
}

/** Starts the landing's counting once per page load; a no-op without a key. */
export function startLandingAnalytics(deps: StartDeps = DEFAULT_DEPS()): Promise<PostHogLike | null> {
  started ??= start(deps);
  return started;
}

export function resetLandingAnalyticsForTests() {
  if (clickListener) document.removeEventListener('click', clickListener, { capture: true });
  clickListener = null;
  started = null;
}

/** Waits for the page to go idle (so the hero paints first), then starts counting. */
const FALLBACK_IDLE_MS = 1500;

export function useLandingAnalytics() {
  useEffect(() => {
    if (!landingPosthogKey()) return;
    const run = () => void startLandingAnalytics();
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: FALLBACK_IDLE_MS });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, FALLBACK_IDLE_MS);
    return () => window.clearTimeout(id);
  }, []);
}
