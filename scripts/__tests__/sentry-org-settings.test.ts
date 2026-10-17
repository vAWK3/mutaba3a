// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { desiredOrgSettings, orgSettingsDrift, parseOrgSettingsArgs, syncOrgSettings, type OrgSettings } from '../sentry-org-policy';

/**
 * MUT-147 (ADR-091, R9): the Sentry org's privacy settings can't live in Terraform, so
 * `scripts/sentry-org-settings.ts` applies and verifies them from the scrub contract.
 */

const rules = JSON.parse(readFileSync('docs/observability/sentry-rules.json', 'utf8')) as {
  denyKeyTokens: string[];
  orgSettings: Record<string, boolean>;
};
const TOKEN = 'sntryu_secret-admin-token';
const ENV = { SENTRY_AUTH_TOKEN: TOKEN, SENTRY_ORG: 'barmajiyat' };
const desired = desiredOrgSettings(rules);

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('desiredOrgSettings', () => {
  it('turns on every org privacy setting and uses the deny tokens as sensitive fields', () => {
    expect(desired).toEqual({
      dataScrubber: true,
      dataScrubberDefaults: true,
      scrubIPAddresses: true,
      sensitiveFields: rules.denyKeyTokens,
    });
  });
});

describe('orgSettingsDrift', () => {
  it('finds no drift when the org matches', () => {
    expect(orgSettingsDrift({ ...desired, name: 'Barmajiyat' }, desired)).toEqual([]);
  });

  it('flags a privacy switch that is off or missing', () => {
    const current: Partial<OrgSettings> = { ...desired, scrubIPAddresses: false };
    delete current.dataScrubber;
    expect(orgSettingsDrift(current, desired).map((drift) => drift.field)).toEqual(['dataScrubber', 'scrubIPAddresses']);
  });

  it('flags missing sensitive fields, ignoring case and extra fields someone added', () => {
    const current = { ...desired, sensitiveFields: ['AMOUNT', 'extra_field', ...desired.sensitiveFields.slice(2)] };
    const drift = orgSettingsDrift(current, desired);
    expect(drift).toEqual([
      { field: 'sensitiveFields', expected: desired.sensitiveFields.slice(1, 2).join(', '), actual: 'missing' },
    ]);
  });
});

describe('parseOrgSettingsArgs', () => {
  it('reads the mode, org and token, defaulting to the EU API host', () => {
    expect(parseOrgSettingsArgs(['--check'], ENV)).toEqual({
      mode: 'check',
      org: 'barmajiyat',
      baseUrl: 'https://de.sentry.io',
      token: TOKEN,
    });
  });

  it('takes --org over SENTRY_ORG and strips a trailing slash and /api/ from SENTRY_BASE_URL', () => {
    const args = parseOrgSettingsArgs(['--apply', '--org', 'other'], { ...ENV, SENTRY_BASE_URL: 'https://sentry.io/api/' });
    expect(args).toMatchObject({ mode: 'apply', org: 'other', baseUrl: 'https://sentry.io' });
  });

  it.each([
    [[], 'exactly one of --apply or --check'],
    [['--apply', '--check'], 'exactly one of --apply or --check'],
    [['--check', '--org'], '--org needs a value'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseOrgSettingsArgs(argv, ENV)).toThrow(message);
  });

  it('refuses to run without a token or an org, without echoing anything secret', () => {
    expect(() => parseOrgSettingsArgs(['--check'], { SENTRY_ORG: 'barmajiyat' })).toThrow('SENTRY_AUTH_TOKEN');
    expect(() => parseOrgSettingsArgs(['--check'], { SENTRY_AUTH_TOKEN: TOKEN })).toThrow('SENTRY_ORG');
  });

  it('refuses a plain-http API host', () => {
    expect(() => parseOrgSettingsArgs(['--check'], { ...ENV, SENTRY_BASE_URL: 'http://de.sentry.io' })).toThrow('https');
  });
});

describe('syncOrgSettings', () => {
  const args = { org: 'barmajiyat', baseUrl: 'https://de.sentry.io', token: TOKEN };
  const url = 'https://de.sentry.io/api/0/organizations/barmajiyat/';

  it('--apply writes the settings, then reads them back', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(okResponse(desired)).mockResolvedValueOnce(okResponse(desired));
    const drift = await syncOrgSettings({ ...args, mode: 'apply' }, desired, fetch);

    expect(drift).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [putUrl, put] = fetch.mock.calls[0];
    expect(putUrl).toBe(url);
    expect(put?.method).toBe('PUT');
    expect(JSON.parse(put?.body as string)).toEqual(desired);
    expect(new Headers(put?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    const [getUrl, get] = fetch.mock.calls[1];
    expect(getUrl).toBe(url);
    expect(get?.method).toBe('GET');
  });

  it('--check only reads, and reports drift', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(okResponse({ ...desired, scrubIPAddresses: false }));
    const drift = await syncOrgSettings({ ...args, mode: 'check' }, desired, fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
    expect(drift).toEqual([{ field: 'scrubIPAddresses', expected: 'true', actual: 'false' }]);
  });

  it('reports drift when an apply did not stick', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(okResponse(desired))
      .mockResolvedValueOnce(okResponse({ ...desired, dataScrubberDefaults: false }));
    const drift = await syncOrgSettings({ ...args, mode: 'apply' }, desired, fetch);
    expect(drift.map((entry) => entry.field)).toEqual(['dataScrubberDefaults']);
  });

  it('fails on an error status with the status, never the token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'You do not have permission' }), { status: 403 }),
    );
    const error = await syncOrgSettings({ ...args, mode: 'apply' }, desired, fetch).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('403');
    expect((error as Error).message).toContain('PUT');
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
