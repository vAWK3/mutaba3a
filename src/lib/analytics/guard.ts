import { eventSpecFor, isValidPropertyValue, type AnalyticsLocale, type AnalyticsSurface } from './contract';

/**
 * The required guard of `docs/analytics/README.md` rule 1 (ADR-090): every
 * event leaves through here, as posthog-js `before_send`. It drops anything the
 * contract does not list, keeps only the SDK fields each surface may send, and
 * stamps the shared properties, so nothing that could identify a person or
 * carry a figure reaches PostHog, whatever the calling code passes.
 */

/** The shape posthog-js hands `before_send` (its `CaptureResult`), kept structural so this file needs no SDK import. */
export interface AnalyticsCapture {
  uuid: string;
  event: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
  $unset?: string[];
  timestamp?: Date;
}

export interface GuardContext {
  surface: AnalyticsSurface;
  appVersion: string;
  locale: AnalyticsLocale;
  /** The page's own origin, to recognize a referrer from the local app (`/app`) on the landing. */
  origin?: string;
}

/** Routing and identity fields the SDK needs on every event (README rule 1). */
const ROUTING_FIELDS = ['token', 'distinct_id', '$device_id', '$insert_id', '$time'];
/** Control properties every surface keeps. */
const CONTROL_FIELDS = ['$process_person_profile', '$lib', '$lib_version'];

/** Each surface's allowance of the SDK's own `$` properties (README rule 1). */
const SURFACE_FIELDS: Record<AnalyticsSurface, string[]> = {
  landing: [
    // The cookieless server hash reads these (ADR-090 rule 9): host, raw user agent and the mode marker
    '$cookieless_mode',
    '$raw_user_agent',
    '$host',
    '$current_url',
    '$pathname',
    '$referrer',
    '$referring_domain',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    // Device type only: the published wording says PostHog keeps no browser details (review F3)
    '$device_type',
  ],
  portal: ['$browser', '$os', '$os_version', '$device_type'],
  ios: ['$os', '$os_version', '$device_type'],
  android: ['$os', '$os_version', '$device_type'],
};

/** True when `referrer` is a page of this site's local app, which must never reach PostHog (ADR-024). */
function isLocalAppReferrer(referrer: unknown, origin: string | undefined): boolean {
  if (typeof referrer !== 'string' || !origin) return false;
  try {
    const url = new URL(referrer);
    return url.origin === origin && (url.pathname === '/app' || url.pathname.startsWith('/app/'));
  } catch {
    return false;
  }
}

function keptSdkFields(properties: Record<string, unknown>, ctx: GuardContext): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of [...ROUTING_FIELDS, ...CONTROL_FIELDS, ...SURFACE_FIELDS[ctx.surface]]) {
    if (Object.hasOwn(properties, key)) kept[key] = properties[key];
  }
  if (ctx.surface === 'landing' && isLocalAppReferrer(kept.$referrer, ctx.origin)) {
    delete kept.$referrer;
    delete kept.$referring_domain;
  }
  return kept;
}

/** `capture` reduced to what the contract and README rule 1 allow for `ctx.surface`, or null to send nothing. */
export function guardEvent(capture: AnalyticsCapture | null, ctx: GuardContext): AnalyticsCapture | null {
  if (!capture) return null;
  const spec = eventSpecFor(capture.event, ctx.surface);
  if (!spec) return null;

  const properties = keptSdkFields(capture.properties, ctx);
  for (const [name, propertySpec] of Object.entries(spec.properties ?? {})) {
    const value = capture.properties[name];
    if (isValidPropertyValue(propertySpec, value)) properties[name] = value;
  }
  properties.surface = ctx.surface;
  properties.app_version = ctx.appVersion;
  properties.locale = ctx.locale;
  properties.$geoip_disable = true;

  const guarded: AnalyticsCapture = { uuid: capture.uuid, event: capture.event, properties };
  if (capture.timestamp) guarded.timestamp = capture.timestamp;
  return guarded;
}
