declare const __POSTHOG_KEY__: string | undefined;

/**
 * The PostHog project key, injected by Vite from MUTABA3A_POSTHOG_KEY (ADR-090);
 * "" in the desktop build, in tests and whenever it is unset, which keeps every
 * analytics call a no-op. Tests mock this module rather than stubbing the global.
 */
export const POSTHOG_KEY: string = typeof __POSTHOG_KEY__ !== 'undefined' && __POSTHOG_KEY__ ? __POSTHOG_KEY__ : '';
