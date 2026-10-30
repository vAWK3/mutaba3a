import type { PostHogConfig } from 'posthog-js';
import { guardEvent, type AnalyticsCapture, type GuardContext } from './guard';
import type { AnalyticsLocale } from './contract';

/**
 * PostHog Cloud EU, project "Mutaba3a" (ADR-090). Fixed rather than
 * configurable: the portal's Content-Security-Policy names this host, and the
 * data must stay in the EU.
 */
export const POSTHOG_HOST = 'https://eu.i.posthog.com';

/** The interface language as the page shows it (`<html lang>`, set by the language providers). */
export function documentLocale(): AnalyticsLocale {
  return typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'ar';
}

/** Everything README rule 7 turns off, the same on every surface. */
const FEATURES_OFF: Partial<PostHogConfig> = {
  autocapture: false,
  rageclick: false,
  capture_pageleave: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_performance: false,
  capture_heatmaps: false,
  enable_heatmaps: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_web_experiments: true,
  disable_external_dependency_loading: true,
  advanced_disable_flags: true,
  advanced_disable_feature_flags: true,
  person_profiles: 'never',
};

/**
 * Per-surface options: the landing counts cookieless, the portal keeps its
 * random ID in localStorage only. On the portal the SDK is opted out unless
 * its consent record says otherwise (review F1): posthog-js reads consent from
 * storage on every check, so once the opt-out deletes that record, every open
 * tab is silent and writes nothing back.
 */
const SURFACE_OPTIONS: Record<'landing' | 'portal' | 'portal-welcome', Partial<PostHogConfig>> = {
  landing: { cookieless_mode: 'always', capture_pageview: true, save_referrer: true },
  portal: {
    persistence: 'localStorage',
    capture_pageview: false,
    save_referrer: false,
    request_batching: false,
    opt_out_capturing_by_default: true,
    opt_out_persistence_by_default: true,
  },
  // MUT-513: the welcome's doors, before anyone signs in: cookieless like the landing, but no pageview or referrer
  'portal-welcome': { cookieless_mode: 'always', capture_pageview: false, save_referrer: false, request_batching: false },
};

/**
 * posthog-js `init` options for the landing or the portal. `context` is read on
 * every event, so a language switch reaches the next event's `locale`.
 */
export function posthogInitOptions(context: () => GuardContext): Partial<PostHogConfig> {
  const surface = context().surface;
  if (surface !== 'landing' && surface !== 'portal') throw new Error(`posthog-js runs on the landing and the portal, not ${surface}`);
  return {
    api_host: POSTHOG_HOST,
    ...FEATURES_OFF,
    ...SURFACE_OPTIONS[context().cookieless ? 'portal-welcome' : surface],
    before_send: (capture) => guardEvent(capture as AnalyticsCapture | null, context()) as typeof capture,
  };
}
