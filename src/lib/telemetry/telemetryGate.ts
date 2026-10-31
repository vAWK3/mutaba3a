/**
 * Release-only telemetry (ADR-236, the same rule in every Barmajiyat app): Sentry and PostHog send only from a
 * production build served on a production host, never from the dev server, a deploy preview, the legacy
 * `*.netlify.app` or run.app hosts, localhost, tests or release-QA.
 *
 * Two overrides, one per tool, read when the build runs: `SENTRY_ENABLED` and `POSTHOG_ENABLED`. `false` forces the
 * tool off, even in a production build (local release builds, QA, e2e). `true` forces it on anywhere, only to check
 * the integration. Unset means the rule above. A missing key or DSN is always off, never an error.
 *
 * vite.config.ts decides each tool's build mode (a tool that is off is compiled out with its key); the page then
 * checks its own host, because one Netlify build answers on the apex and on the legacy host, and a local release
 * build can be previewed on localhost. Pure: vite.config.ts imports it too.
 */

export type TelemetryTool = 'sentry' | 'posthog';

/** `off`: compiled out. `production`: sends only on a production host. `forced`: sends anywhere (`<TOOL>_ENABLED=true`). */
export type TelemetryBuildMode = 'off' | 'production' | 'forced';

/** What every event is tagged with, so anything that slips through can be filtered out. */
export type TelemetryEnvironment = 'production' | 'development';

/** The override each tool reads from the environment; the names are the same in every app. */
export const TELEMETRY_FLAGS = { sentry: 'SENTRY_ENABLED', posthog: 'POSTHOG_ENABLED' } as const satisfies Record<TelemetryTool, string>;

/** What a build hands the page (`__TELEMETRY__`). */
export interface TelemetryGate {
  /** `vite build` for production: outside Netlify, or in Netlify's production context. */
  productionBuild: boolean;
  sentry: TelemetryBuildMode;
  posthog: TelemetryBuildMode;
  /** The hosts this build counts as production (from config/hosts.json): the apex for the website, app.<apex> for the portal. */
  productionHosts: readonly string[];
}

/** Tests, and any build that defines no gate: nothing sends. */
export const TELEMETRY_OFF: TelemetryGate = { productionBuild: false, sentry: 'off', posthog: 'off', productionHosts: [] };

/** `true`, `false`, or unset (undefined or ""); anything else fails the build rather than guessing. */
export function parseTelemetryFlag(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false (or unset), got ${JSON.stringify(value)}`);
}

export interface TelemetryBuildInput {
  productionBuild: boolean;
  /** The tool's `<TOOL>_ENABLED` override, parsed. */
  flag: boolean | undefined;
  /** Whether the build has the tool's key or DSN at all. */
  hasKey: boolean;
}

/** One tool's mode for one build. */
export function telemetryBuildMode({ productionBuild, flag, hasKey }: TelemetryBuildInput): TelemetryBuildMode {
  if (!hasKey || flag === false) return 'off';
  if (flag === true) return 'forced';
  return productionBuild ? 'production' : 'off';
}

function onProductionHost(gate: TelemetryGate, hostname: string): boolean {
  return gate.productionBuild && gate.productionHosts.includes(hostname);
}

/** Whether `tool` may send from a page on `hostname`. */
export function telemetryAllowed(gate: TelemetryGate, tool: TelemetryTool, hostname: string): boolean {
  const mode = gate[tool];
  if (mode === 'forced') return true;
  return mode === 'production' && onProductionHost(gate, hostname);
}

/** `production` only for a production build on a production host: a forced build anywhere else is `development`. */
export function telemetryEnvironment(gate: TelemetryGate, hostname: string): TelemetryEnvironment {
  return onProductionHost(gate, hostname) ? 'production' : 'development';
}
