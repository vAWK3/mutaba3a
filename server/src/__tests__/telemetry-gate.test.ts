import { describe, expect, it } from 'vitest';
import { parseTelemetryFlag, serverSentryEnabled } from '../observability/telemetry-gate.js';

/** ADR-236: release-only error reports on the server. */

const DSN = 'https://publickey@o1.ingest.de.sentry.io/42';

describe('parseTelemetryFlag', () => {
  it('reads true, false and unset', () => {
    expect(parseTelemetryFlag('SENTRY_ENABLED', 'true')).toBe(true);
    expect(parseTelemetryFlag('SENTRY_ENABLED', 'false')).toBe(false);
    expect(parseTelemetryFlag('SENTRY_ENABLED', undefined)).toBeUndefined();
    expect(parseTelemetryFlag('SENTRY_ENABLED', '')).toBeUndefined();
  });

  it.each(['1', 'on', 'TRUE'])('refuses %j rather than guessing', (value) => {
    expect(() => parseTelemetryFlag('SENTRY_ENABLED', value)).toThrow(/SENTRY_ENABLED must be true or false/);
  });
});

describe('serverSentryEnabled', () => {
  // development | test | staging | production × flag unset | true | false × DSN set | missing
  it.each<[string, boolean | undefined, string | undefined, boolean]>([
    ['development', undefined, DSN, false],
    ['development', true, DSN, true],
    ['development', false, DSN, false],
    ['test', undefined, DSN, false],
    ['test', true, DSN, true],
    ['staging', undefined, DSN, false],
    ['production', undefined, DSN, true],
    ['production', true, DSN, true],
    ['production', false, DSN, false],
    ['production', undefined, undefined, false],
    ['production', true, undefined, false],
    ['development', true, '', false],
  ])('%s, flag %s, DSN %s → %s', (runtimeEnv, flag, dsn, enabled) => {
    expect(serverSentryEnabled({ runtimeEnv, flag, dsn })).toBe(enabled);
  });
});
