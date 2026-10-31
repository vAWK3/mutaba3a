import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryGate } from '../telemetryGate';

/** ADR-236: the page reads the build's gate and its own host (example hosts: the real ones live in config/hosts.json). */

const PRODUCTION: TelemetryGate = { productionBuild: true, sentry: 'production', posthog: 'production', productionHosts: ['landing.example'] };

async function loadWith(gate: TelemetryGate | undefined) {
  vi.resetModules();
  vi.stubGlobal('__TELEMETRY__', gate);
  return import('../pageTelemetry');
}

describe('pageTelemetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends nothing in tests or a build without a gate', async () => {
    const page = await loadWith(undefined);
    expect(page.telemetryOn('posthog', 'landing.example')).toBe(false);
    expect(page.telemetryOn('sentry', 'landing.example')).toBe(false);
    expect(page.pageTelemetryEnvironment('landing.example')).toBe('development');
  });

  it('sends from a production build on the production host, tagged production', async () => {
    const page = await loadWith(PRODUCTION);
    expect(page.telemetryOn('posthog', 'landing.example')).toBe(true);
    expect(page.telemetryOn('sentry', 'landing.example')).toBe(true);
    expect(page.pageTelemetryEnvironment('landing.example')).toBe('production');
  });

  it('sends nothing from the same build on the legacy Netlify host', async () => {
    const page = await loadWith(PRODUCTION);
    expect(page.telemetryOn('posthog', 'legacy-site.netlify.app')).toBe(false);
    expect(page.telemetryOn('sentry', 'legacy-site.netlify.app')).toBe(false);
  });

  it("reads this page's own host by default: localhost in tests", async () => {
    const page = await loadWith(PRODUCTION);
    expect(window.location.hostname).toBe('localhost');
    expect(page.telemetryOn('posthog')).toBe(false);
    expect(page.pageTelemetryEnvironment()).toBe('development');
  });
});
