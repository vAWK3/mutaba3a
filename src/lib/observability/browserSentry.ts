import type { BrowserOptions, ErrorEvent, EventHint } from '@sentry/browser';
import { SENTRY_RULES, type SentrySurface } from '../../../server/src/observability/sentry-rules';
import { scrubEvent } from '../../../server/src/observability/sentry-scrub';

/**
 * The browser surfaces' Sentry options (ADR-091, MUT-149 D4): the portal now,
 * the landing next (MUT-150). Pure, and imports only the SDK's types: each
 * surface's own lazy chunk imports the SDK and adds its integrations. Every
 * event and breadcrumb leaves through MUT-148's scrubber, the same one the API
 * uses, so there is one set of privacy rules, never a second copy.
 */

export type BrowserSurface = Extract<SentrySurface, 'portal' | 'landing'>;

export interface BrowserSentryInput {
  dsn: string;
  release: string;
  environment: string;
  /** Called before scrubbing; true drops the event (the portal drops the API failures its UI handles). */
  dropEvent?: (event: ErrorEvent, hint: EventHint) => boolean;
  /** Read at send time, not at init: the language can change after the SDK starts (AC6). */
  tags?: () => Record<string, string | undefined>;
}

export type BrowserSentryOptions = Omit<BrowserOptions, 'integrations' | 'transport'>;

/** Runs one breadcrumb through the event scrubber: rule 6 is written for an event's breadcrumbs. */
function scrubBreadcrumb<T extends object>(crumb: T, surface: BrowserSurface): T | null {
  const [clean] = scrubEvent({ breadcrumbs: [crumb] }, surface)?.breadcrumbs ?? [];
  return clean ?? null;
}

/**
 * SDK 11 replaced `sendDefaultPii` with per-category switches: the contract's
 * `sendDefaultPii: false` and `includeLocalVariables: false`, spelled out. The
 * one header kept is User-Agent, for the browser and OS context the contract
 * allows (`safeContextKeys`).
 */
function dataCollection(): NonNullable<BrowserOptions['dataCollection']> {
  const { sdk } = SENTRY_RULES;
  const pii = sdk.sendDefaultPii;
  return {
    userInfo: pii,
    cookies: pii,
    httpHeaders: pii ? true : { request: { allow: ['User-Agent'] }, response: false },
    httpBodies: [],
    urlQueryParams: pii,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: sdk.includeLocalVariables,
  };
}

function definedTags(tags: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(tags).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export function browserSentryOptions(surface: BrowserSurface, input: BrowserSentryInput): BrowserSentryOptions {
  const { sdk } = SENTRY_RULES;
  return {
    dsn: input.dsn,
    release: input.release,
    environment: input.environment,
    dataCollection: dataCollection(),
    sampleRate: sdk.sampleRate,
    tracesSampleRate: sdk.tracesSampleRate,
    replaysSessionSampleRate: sdk.replaysSessionSampleRate,
    replaysOnErrorSampleRate: sdk.replaysOnErrorSampleRate,
    profileSessionSampleRate: sdk.profilesSampleRate,
    // Each surface lists its integrations itself; the SDK's defaults would add console capture
    defaultIntegrations: false,
    // The SDK's drop-count envelopes skip beforeSend, so a page whose events are all dropped could still send them
    sendClientReports: false,
    initialScope: { tags: { surface } },
    beforeBreadcrumb: (crumb) => (crumb.category === 'console' && !sdk.consoleBreadcrumbs ? null : scrubBreadcrumb(crumb, surface)),
    beforeSend: (event, hint) => {
      if (input.dropEvent?.(event, hint)) return null;
      const tags = input.tags ? { ...event.tags, ...definedTags(input.tags()) } : event.tags;
      return scrubEvent(tags ? { ...event, tags } : event, surface);
    },
  };
}
