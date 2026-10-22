import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SENTRY_RULES, type SentrySurface } from '../../server/src/observability/sentry-rules';
import { scrubEvent } from '../../server/src/observability/sentry-scrub';

/**
 * MUT-148: the server's embedded copy of the Sentry scrub contract (ADR-091) and its whole-event
 * scrubber. Lives here, not in server/, because contracts-ci installs only the root package.
 */
const rules = JSON.parse(readFileSync('docs/observability/sentry-rules.json', 'utf8')) as Record<string, unknown>;
const fixtures = (
  JSON.parse(readFileSync('docs/observability/sentry-fixtures.json', 'utf8')) as {
    fixtures: Array<{ name: string; surface: string; input: Record<string, unknown>; expected: Record<string, unknown> }>;
  }
).fixtures;

const SECRETS = ['Late invoice', 'mutaba3a_session=', 's3cr3t', 'Bearer', 'mut_live_9f2c', 'owner@example.test'];

/** The AC4 request: a body, a cookie, an Authorization header and an API key, as Sentry would carry them. */
function leakyRequestEvent(): Record<string, unknown> {
  return {
    level: 'error',
    platform: 'node',
    release: 'mutaba3a-api@0.4.1+abc1234',
    environment: 'production',
    request: {
      method: 'POST',
      url: 'https://api.example.test/v1/income?note=Late%20invoice',
      query_string: 'note=Late%20invoice',
      data: '{"note":"Late invoice","email":"owner@example.test"}',
      cookies: { mutaba3a_session: 's3cr3t' },
      headers: {
        authorization: 'Bearer mut_live_9f2c',
        cookie: 'mutaba3a_session=s3cr3t',
        'x-api-key': 'mut_live_9f2c',
        'content-type': 'application/json',
      },
    },
    tags: { surface: 'api', request_id: 'req_1', route: '/v1/income' },
    exception: { values: [{ type: 'Error', value: 'insert failed', stacktrace: { frames: [{ filename: 'dist/x.js', vars: { body: 'Late invoice' } }] } }] },
  };
}

/** Contract fields no surface reads at runtime: the region and surface list are checked by Terraform, the org settings by the settings script. */
const NOT_EMBEDDED = ['region', 'surfaces', 'orgSettings', 'orgSensitiveFields'];

describe('server Sentry rules (MUT-148, ADR-091)', () => {
  it('embeds every contract field a scrubber reads, so a new rule cannot be skipped silently', () => {
    expect(Object.keys(rules).filter((key) => !NOT_EMBEDDED.includes(key)).sort()).toEqual(Object.keys(SENTRY_RULES).sort());
  });

  it.each(Object.keys(SENTRY_RULES))('embeds %s exactly as the contract file holds it', (key) => {
    expect(SENTRY_RULES[key as keyof typeof SENTRY_RULES]).toEqual(rules[key]);
  });
});

describe('scrubEvent', () => {
  it('has fixtures for the api surface', () => {
    expect(fixtures.filter((fixture) => fixture.surface === 'api').length).toBeGreaterThan(0);
  });

  // Every surface's fixtures, not only the api's: the portal and landing reuse this scrubber (MUT-149/150).
  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('turns fixture %s into its expected event', (_name, fixture) => {
    expect(scrubEvent(structuredClone(fixture.input), fixture.surface as SentrySurface)).toEqual(fixture.expected);
  });

  it('leaves no body, cookie, Authorization header or API key in the event (AC4)', () => {
    const scrubbed = JSON.stringify(scrubEvent(leakyRequestEvent(), 'api'));
    for (const secret of SECRETS) expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain('"content-type":"application/json"');
    expect(scrubbed).toContain('"url":"https://api.example.test/v1/income"');
  });

  it('keeps release, environment, request_id and the frames (without vars)', () => {
    const scrubbed = scrubEvent(leakyRequestEvent(), 'api') as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(scrubbed).toMatchObject({ release: 'mutaba3a-api@0.4.1+abc1234', environment: 'production', tags: { request_id: 'req_1' } });
    expect(scrubbed.exception.values[0].stacktrace.frames).toEqual([{ filename: 'dist/x.js' }]);
  });

  it('drops an event the surface ignores (the client closed the request)', () => {
    const aborted = { exception: { values: [{ type: 'AbortError', value: 'This operation was aborted' }] } };
    expect(scrubEvent(aborted, 'api')).toBeNull();
  });

  it('does not ignore the same error for a surface whose list lacks it', () => {
    const socket = { exception: { values: [{ type: 'SocketException', value: 'Connection reset' }] } };
    expect(scrubEvent(socket, 'api')).not.toBeNull();
    expect(scrubEvent(socket, 'capture-app')).toBeNull();
  });

  it('accepts breadcrumbs as the SDK holds them (an array) and drops console ones', () => {
    const event = {
      breadcrumbs: [
        { category: 'console', message: 'email=owner@example.test' },
        { category: 'http', data: { url: 'https://api.example.test/v1/x?token=abc', method: 'GET', amount: 5 } },
      ],
    };
    expect(scrubEvent(event, 'api')).toEqual({ breadcrumbs: [{ category: 'http', data: { url: 'https://api.example.test/v1/x', method: 'GET' } }] });
  });

  it('does not change the event it was given', () => {
    const event = leakyRequestEvent();
    const before = structuredClone(event);
    scrubEvent(event, 'api');
    expect(event).toEqual(before);
  });
});
