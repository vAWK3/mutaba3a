import { telemetryOn } from '../telemetry/pageTelemetry';

declare const __POSTHOG_KEY__: string | undefined;

/**
 * The PostHog project key, injected by Vite from MUTABA3A_POSTHOG_KEY (ADR-090);
 * "" in tests, whenever it is unset, and wherever release-only telemetry
 * (ADR-236) keeps PostHog off: the dev server, POSTHOG_ENABLED=false, and any
 * host but production (the legacy *.netlify.app host, deploy previews,
 * localhost). "" keeps every analytics call a no-op. Tests mock this module
 * rather than stubbing the global.
 */
const BUILD_KEY: string = typeof __POSTHOG_KEY__ !== 'undefined' && __POSTHOG_KEY__ ? __POSTHOG_KEY__ : '';

export const POSTHOG_KEY: string = BUILD_KEY && telemetryOn('posthog') ? BUILD_KEY : '';
