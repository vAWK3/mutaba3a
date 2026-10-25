/// <reference types="vite/client" />

// Vite environment variables (empty - no custom env vars needed)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Build-time constants
declare const __APP_VERSION__: string;
declare const __BUILD_MODE__: 'web' | 'desktop';
/** The portal origin the web build's sign-in link opens; "" in the desktop build (MUT-187). */
declare const __PORTAL_URL__: string;
/** The landing's public /hosted page, set by the hosted build only (MUT-188); absent elsewhere. */
declare const __HOSTED_OFFER_URL__: string;
/** MUT-324: the landing's /terms; portal build only (read through a typeof guard, ADR-076). */
declare const __TERMS_URL__: string;
/** MUT-368: the portal's Turnstile site key (public); Cloudflare's always-pass test key outside production. */
declare const __TURNSTILE_SITE_KEY__: string;
/** MUT-115: the passkey relying-party ID (vite.config.ts passkeyRpId); "" = no passkeys; absent in Vitest. */
declare const __PASSKEY_RP_ID__: string;
/** MUT-291: the carry-over's origins (vite.config.ts carryOverBuild); read through src/lib/carryOver/build.ts, absent in Vitest. */
declare const __CARRY_OVER__: { sources: { web?: string; portal?: string }; portalOrigin: string | null };
/** The PostHog project ingest key (ADR-090): "" when unset and always "" in the desktop build; absent in Vitest. */
declare const __POSTHOG_KEY__: string;
