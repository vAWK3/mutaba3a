/**
 * The barmajiyat-ltd Sentry org's EU ingest host (MUT-149 D7, ADR-091 am.11): the one origin the portal's
 * browser SDK sends to. `PORTAL_CSP` names it in connect-src, and the hosted build refuses a DSN on any other
 * host (vite.config.ts `sentryDsn`), so the CSP and the DSN cannot drift apart. One org serves every
 * environment, so this is not per-environment config. Pure: vite.config.ts imports it too.
 */
export const SENTRY_INGEST_ORIGIN = 'https://o4512029835526144.ingest.de.sentry.io';
