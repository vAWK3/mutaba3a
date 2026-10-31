/**
 * Release-only telemetry on the server (ADR-236, the same rule in every Barmajiyat app; the web's twin is
 * src/lib/telemetry/telemetryGate.ts). The API reports to Sentry only when its runtime environment is production:
 * never the dev server, tests, CI or the local API that release-QA drives on :8787. `SENTRY_ENABLED` overrides it:
 * `false` forces reports off even in production, `true` forces them on anywhere, only to check the integration.
 * A missing DSN is always off. The API sends nothing to PostHog, so `POSTHOG_ENABLED` has nothing to switch here.
 */

export const SENTRY_ENABLED_FLAG = 'SENTRY_ENABLED';

/** `true`, `false`, or unset (undefined or ""); anything else is refused rather than guessed. */
export function parseTelemetryFlag(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false (or unset), got ${JSON.stringify(value)}`);
}

export interface ServerSentryGateInput {
  /** NODE_ENV for the API; the script's SENTRY_ENVIRONMENT (else NODE_ENV) for the operator scripts deploy.sh runs. */
  runtimeEnv: string;
  /** SENTRY_ENABLED, parsed. */
  flag: boolean | undefined;
  dsn: string | undefined;
}

/** Whether this process may send to Sentry. */
export function serverSentryEnabled({ runtimeEnv, flag, dsn }: ServerSentryGateInput): boolean {
  if (!dsn || flag === false) return false;
  return flag === true || runtimeEnv === 'production';
}
