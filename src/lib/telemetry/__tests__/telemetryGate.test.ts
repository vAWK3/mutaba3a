import { describe, expect, it } from 'vitest';
import {
  parseTelemetryFlag,
  TELEMETRY_FLAGS,
  TELEMETRY_OFF,
  telemetryAllowed,
  telemetryBuildMode,
  telemetryEnvironment,
  type TelemetryBuildMode,
  type TelemetryGate,
} from '../telemetryGate';

/** ADR-236: release-only telemetry. */

/** Example hosts: the real ones live only in config/hosts.json (MUT-326). */
const PRODUCTION_HOST = 'landing.example';

describe('parseTelemetryFlag', () => {
  it('reads true, false and unset', () => {
    expect(parseTelemetryFlag('SENTRY_ENABLED', 'true')).toBe(true);
    expect(parseTelemetryFlag('SENTRY_ENABLED', 'false')).toBe(false);
    expect(parseTelemetryFlag('SENTRY_ENABLED', undefined)).toBeUndefined();
    expect(parseTelemetryFlag('SENTRY_ENABLED', '')).toBeUndefined();
  });

  it.each(['1', 'yes', 'TRUE', 'off'])('fails the build on %j rather than guessing', (value) => {
    expect(() => parseTelemetryFlag('POSTHOG_ENABLED', value)).toThrow(/POSTHOG_ENABLED must be true or false/);
  });

  it('names the same overrides as every other app', () => {
    expect(TELEMETRY_FLAGS).toEqual({ sentry: 'SENTRY_ENABLED', posthog: 'POSTHOG_ENABLED' });
  });
});

describe('telemetryBuildMode', () => {
  // dev server | production build × flag unset | true | false × key present | missing
  it.each<[string, boolean, boolean | undefined, boolean, TelemetryBuildMode]>([
    ['dev server, unset', false, undefined, true, 'off'],
    ['dev server, true', false, true, true, 'forced'],
    ['dev server, false', false, false, true, 'off'],
    ['production build, unset', true, undefined, true, 'production'],
    ['production build, true', true, true, true, 'forced'],
    ['production build, false', true, false, true, 'off'],
    ['dev server, unset, no key', false, undefined, false, 'off'],
    ['dev server, true, no key', false, true, false, 'off'],
    ['production build, unset, no key', true, undefined, false, 'off'],
    ['production build, true, no key', true, true, false, 'off'],
  ])('%s → %s', (_name, productionBuild, flag, hasKey, mode) => {
    expect(telemetryBuildMode({ productionBuild, flag, hasKey })).toBe(mode);
  });
});

describe('telemetryAllowed and telemetryEnvironment', () => {
  const gate = (productionBuild: boolean, mode: TelemetryBuildMode): TelemetryGate => ({
    productionBuild,
    sentry: mode,
    posthog: mode,
    productionHosts: [PRODUCTION_HOST],
  });

  it('sends from a production build on the production host only', () => {
    const production = gate(true, 'production');
    expect(telemetryAllowed(production, 'posthog', PRODUCTION_HOST)).toBe(true);
    expect(telemetryAllowed(production, 'sentry', PRODUCTION_HOST)).toBe(true);
    expect(telemetryEnvironment(production, PRODUCTION_HOST)).toBe('production');
  });

  it.each(['legacy-site.netlify.app', 'deploy-preview-12--legacy-site.netlify.app', 'localhost', '127.0.0.1', 'www.landing.example', 'app.landing.example', ''])(
    'sends nothing from %j, even from a production build',
    (hostname) => {
      expect(telemetryAllowed(gate(true, 'production'), 'posthog', hostname)).toBe(false);
      expect(telemetryAllowed(gate(true, 'production'), 'sentry', hostname)).toBe(false);
    },
  );

  it('sends nothing when a tool is off, on any host', () => {
    expect(telemetryAllowed(gate(true, 'off'), 'posthog', PRODUCTION_HOST)).toBe(false);
    expect(telemetryAllowed(TELEMETRY_OFF, 'sentry', PRODUCTION_HOST)).toBe(false);
  });

  it('decides each tool on its own', () => {
    const mixed: TelemetryGate = { productionBuild: true, sentry: 'production', posthog: 'off', productionHosts: [PRODUCTION_HOST] };
    expect(telemetryAllowed(mixed, 'sentry', PRODUCTION_HOST)).toBe(true);
    expect(telemetryAllowed(mixed, 'posthog', PRODUCTION_HOST)).toBe(false);
  });

  it('sends anywhere when forced on, tagged development off the production host', () => {
    const forcedDev = gate(false, 'forced');
    expect(telemetryAllowed(forcedDev, 'posthog', 'localhost')).toBe(true);
    expect(telemetryEnvironment(forcedDev, 'localhost')).toBe('development');
    // A dev build is never production, even on the production host's name
    expect(telemetryEnvironment(forcedDev, PRODUCTION_HOST)).toBe('development');
    expect(telemetryEnvironment(gate(true, 'forced'), 'legacy-site.netlify.app')).toBe('development');
  });
});
