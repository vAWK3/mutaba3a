// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  desiredOrgSettings,
  expectedRegionUrl,
  orgSettingsDrift,
  parseOrgSettingsArgs,
  syncOrgSettings,
  type OrgSettings,
} from '../sentry-org-policy';

/**
 * MUT-147 (ADR-091, R9): the Sentry org's privacy settings can't live in Terraform, so
 * `scripts/sentry-org-settings.ts` applies and verifies them from the scrub contract.
 */

const rules = JSON.parse(readFileSync('docs/observability/sentry-rules.json', 'utf8')) as {
  region: string;
  orgSensitiveFields: string[];
  orgSettings: Record<string, boolean>;
};
const TOKEN = 'sntryu_secret-admin-token';
const ENV = { SENTRY_ADMIN_TOKEN: TOKEN, SENTRY_ORG: 'mutaba3a' };
const EU = 'https://de.sentry.io';
const desired = desiredOrgSettings(rules);
const euOrg = (settings: Partial<OrgSettings>) => ({ ...settings, links: { regionUrl: EU } });

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('desiredOrgSettings', () => {
  it('turns on every privacy switch, empties safe fields and pushes only the curated sensitive fields (D2, D7)', () => {
    expect(desired).toEqual({
      dataScrubber: true,
      dataScrubberDefaults: true,
      scrubIPAddresses: true,
      enhancedPrivacy: true,
      allowSharedIssues: false,
      require2FA: true,
      safeFields: [],
      sensitiveFields: rules.orgSensitiveFields,
    });
  });

  it('expects the org in the contract region', () => {
    expect(expectedRegionUrl(rules)).toBe(EU);
  });
});

describe('orgSettingsDrift', () => {
  it('finds no drift when the org matches', () => {
    expect(orgSettingsDrift({ ...desired, name: 'Mutaba3a' } as Partial<OrgSettings>, desired)).toEqual([]);
  });

  it('flags a privacy switch that is off, on when it should be off, or missing', () => {
    const current: Partial<OrgSettings> = { ...desired, scrubIPAddresses: false, allowSharedIssues: true };
    delete current.dataScrubber;
    expect(orgSettingsDrift(current, desired).map((drift) => drift.field)).toEqual([
      'dataScrubber',
      'scrubIPAddresses',
      'allowSharedIssues',
    ]);
  });

  it('flags any safe field, because it switches the scrubber off for that key (D7)', () => {
    expect(orgSettingsDrift({ ...desired, safeFields: ['email'] }, desired)).toEqual([
      { field: 'safeFields', expected: 'none', actual: 'email' },
    ]);
  });

  it('flags missing sensitive fields, ignoring case and extra fields someone added', () => {
    const want: OrgSettings = { ...desired, sensitiveFields: ['amountminor', 'password', 'pepper'] };
    const current = { ...want, sensitiveFields: ['AMOUNTMINOR', 'extra_field', 'pepper'] };
    expect(orgSettingsDrift(current, want)).toEqual([{ field: 'sensitiveFields', expected: 'password', actual: 'missing' }]);
  });
});

describe('parseOrgSettingsArgs', () => {
  it('reads the mode, SENTRY_ORG and SENTRY_ADMIN_TOKEN, defaulting to the EU API host', () => {
    expect(parseOrgSettingsArgs(['--check'], ENV)).toEqual({ mode: 'check', org: 'mutaba3a', baseUrl: EU, token: TOKEN });
  });

  it('strips a trailing slash and /api/ from SENTRY_BASE_URL', () => {
    expect(parseOrgSettingsArgs(['--apply'], { ...ENV, SENTRY_BASE_URL: 'https://sentry.io/api/' })).toMatchObject({
      mode: 'apply',
      baseUrl: 'https://sentry.io',
    });
  });

  it.each([[[]], [['--apply', '--check']], [['--check', '--org', 'other']], [['--org=other', '--apply']], [['--apply', 'extra']]])(
    'rejects %j: exactly one of --apply or --check, nothing else (D9)',
    (argv) => {
      expect(() => parseOrgSettingsArgs(argv, ENV)).toThrow('exactly one of --apply or --check');
    },
  );

  it('reads only the admin token, never the build upload token (D8)', () => {
    expect(() => parseOrgSettingsArgs(['--check'], { SENTRY_ORG: 'mutaba3a', SENTRY_AUTH_TOKEN: 'sntrys_upload' })).toThrow(
      /SENTRY_ADMIN_TOKEN.*personal/,
    );
    expect(() => parseOrgSettingsArgs(['--check'], { SENTRY_ADMIN_TOKEN: TOKEN })).toThrow('SENTRY_ORG');
  });

  it.each(['http://de.sentry.io', 'https://de.sentry.io.invalid', 'https://sentry.io.example.com', 'https://evil.example'])(
    'refuses to send the admin token to %s (D9)',
    (baseUrl) => {
      expect(() => parseOrgSettingsArgs(['--check'], { ...ENV, SENTRY_BASE_URL: baseUrl })).toThrow('SENTRY_BASE_URL');
    },
  );

  it.each(['https://sentry.io', 'https://de.sentry.io', 'https://us.sentry.io/'])('accepts the Sentry host %s', (baseUrl) => {
    expect(() => parseOrgSettingsArgs(['--check'], { ...ENV, SENTRY_BASE_URL: baseUrl })).not.toThrow();
  });
});

describe('syncOrgSettings', () => {
  const args = { org: 'mutaba3a', baseUrl: EU, token: TOKEN };
  const url = 'https://de.sentry.io/api/0/organizations/mutaba3a/';
  const projectsUrl = 'https://de.sentry.io/api/0/organizations/mutaba3a/projects/';
  const mutaba3aProjects = [{ slug: 'mutaba3a-api' }, { slug: 'mutaba3a-capture-app' }];
  /** A fetch mock answering each request in order. */
  const respond = (...responses: Response[]) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const response of responses) fetch.mockResolvedValueOnce(response);
    return fetch;
  };

  it('--apply reads the org and its projects, writes the settings merged with fields added by hand, then reads them back (D2, D16)', async () => {
    const before = euOrg({ ...desired, sensitiveFields: ['custom_pii', desired.sensitiveFields[0].toUpperCase()] });
    const fetch = respond(
      okResponse(before),
      okResponse(mutaba3aProjects),
      okResponse({}),
      okResponse(euOrg({ ...desired, sensitiveFields: ['custom_pii', ...desired.sensitiveFields] })),
    );
    const drift = await syncOrgSettings({ ...args, mode: 'apply' }, desired, EU, fetch);

    expect(drift).toEqual([]);
    expect(fetch.mock.calls.map(([callUrl, init]) => [callUrl, init?.method])).toEqual([
      [url, 'GET'],
      [projectsUrl, 'GET'],
      [url, 'PUT'],
      [url, 'GET'],
    ]);
    const [, put] = fetch.mock.calls[2];
    const body = JSON.parse(put?.body as string) as OrgSettings;
    // Existing fields keep their casing; a desired field already present (any case) is not repeated.
    const [first, ...rest] = desired.sensitiveFields;
    expect(body).toEqual({ ...desired, sensitiveFields: ['custom_pii', first.toUpperCase(), ...rest] });
    expect(new Headers(put?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('--check only reads, and reports drift', async () => {
    const fetch = respond(okResponse(euOrg({ ...desired, scrubIPAddresses: false })), okResponse(mutaba3aProjects));
    const drift = await syncOrgSettings({ ...args, mode: 'check' }, desired, EU, fetch);

    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'GET']);
    expect(drift).toEqual([{ field: 'scrubIPAddresses', expected: 'true', actual: 'false' }]);
  });

  it.each(['apply', 'check'] as const)('--%s refuses an org outside the EU region before writing anything (D5)', async (mode) => {
    const fetch = respond(okResponse({ ...desired, links: { regionUrl: 'https://us.sentry.io' } }));
    await expect(syncOrgSettings({ ...args, mode }, desired, EU, fetch)).rejects.toThrow('https://us.sentry.io');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses an org whose region it cannot tell, before writing (D5)', async () => {
    const fetch = respond(okResponse({ ...desired }));
    await expect(syncOrgSettings({ ...args, mode: 'apply' }, desired, EU, fetch)).rejects.toThrow('an unknown region');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts the EU region URL with a trailing slash', async () => {
    const fetch = respond(okResponse({ ...desired, links: { regionUrl: `${EU}/` } }), okResponse([]));
    await expect(syncOrgSettings({ ...args, mode: 'check' }, desired, EU, fetch)).resolves.toEqual([]);
  });

  it.each(['apply', 'check'] as const)('--%s refuses an org holding another product\'s project, before writing (D16)', async (mode) => {
    const fetch = respond(okResponse(euOrg(desired)), okResponse([{ slug: 'mutaba3a-api' }, { slug: 'malafat-web' }]));
    await expect(syncOrgSettings({ ...args, mode }, desired, EU, fetch)).rejects.toThrow('malafat-web');
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'GET']);
  });

  it('accepts the products known to share barmajiyat-ltd: Mutaba3a and E33 (ADR-091 amendment 9)', async () => {
    const shared = [{ slug: 'mutaba3a-api' }, { slug: 'mutaba3a-web' }, { slug: 'e33-api' }, { slug: 'e33-flutter' }];
    const fetch = respond(okResponse(euOrg(desired)), okResponse(shared));
    await expect(syncOrgSettings({ ...args, mode: 'check' }, desired, EU, fetch)).resolves.toEqual([]);
  });

  it('still refuses a project of any other product, naming it', async () => {
    const fetch = respond(okResponse(euOrg(desired)), okResponse([{ slug: 'e33-api' }, { slug: 'kataloj-web' }]));
    await expect(syncOrgSettings({ ...args, mode: 'check' }, desired, EU, fetch)).rejects.toThrow('kataloj-web');
  });

  it('refuses when the project list runs past one page, since it can\'t see every project (cycle-3 review)', async () => {
    const paged = new Response(JSON.stringify(mutaba3aProjects), {
      status: 200,
      headers: { link: '<https://de.sentry.io/api/0/organizations/mutaba3a/projects/?cursor=1:1:0>; rel="next"; results="true"; cursor="1:1:0"' },
    });
    const fetch = respond(okResponse(euOrg(desired)), paged);
    await expect(syncOrgSettings({ ...args, mode: 'apply' }, desired, EU, fetch)).rejects.toThrow('more than one page');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('accepts a single page: Sentry always sends a next link, with results="false" (convergence review)', async () => {
    const single = new Response(JSON.stringify(mutaba3aProjects), {
      status: 200,
      headers: {
        link:
          '<https://de.sentry.io/api/0/organizations/mutaba3a/projects/?&cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", ' +
          '<https://de.sentry.io/api/0/organizations/mutaba3a/projects/?&cursor=0:100:0>; rel="next"; results="false"; cursor="0:100:0"',
      },
    });
    const fetch = respond(okResponse(euOrg(desired)), single);
    await expect(syncOrgSettings({ ...args, mode: 'check' }, desired, EU, fetch)).resolves.toEqual([]);
  });

  it('accepts an empty org, for the first run before Terraform has created the projects (D16)', async () => {
    const fetch = respond(okResponse(euOrg(desired)), okResponse([]));
    await expect(syncOrgSettings({ ...args, mode: 'check' }, desired, EU, fetch)).resolves.toEqual([]);
  });

  it('treats an empty PUT response as written, since the GET is the verification', async () => {
    const fetch = respond(okResponse(euOrg(desired)), okResponse([]), new Response(null, { status: 204 }), okResponse(euOrg(desired)));
    await expect(syncOrgSettings({ ...args, mode: 'apply' }, desired, EU, fetch)).resolves.toEqual([]);
  });

  it('gives every request a timeout and refuses redirects, so the token only ever goes to the named host', async () => {
    const fetch = respond(okResponse(euOrg(desired)), okResponse([]), okResponse({}), okResponse(euOrg(desired)));
    await syncOrgSettings({ ...args, mode: 'apply' }, desired, EU, fetch);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.redirect).toBe('error');
    }
  });

  it('reports drift when an apply did not stick', async () => {
    const fetch = respond(
      okResponse(euOrg(desired)),
      okResponse([]),
      okResponse({}),
      okResponse(euOrg({ ...desired, dataScrubberDefaults: false })),
    );
    const drift = await syncOrgSettings({ ...args, mode: 'apply' }, desired, EU, fetch);
    expect(drift.map((entry) => entry.field)).toEqual(['dataScrubberDefaults']);
  });

  it.each([
    ['the first read', [new Response('nope', { status: 401 })], 'GET'],
    ['the write', [okResponse(euOrg(desired)), okResponse([]), new Response('{"detail":"no"}', { status: 403 })], 'PUT'],
  ] as const)('fails on an error status in %s with the method and status, never the token', async (_where, responses, method) => {
    const error = await syncOrgSettings({ ...args, mode: 'apply' }, desired, EU, respond(...responses)).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(method);
    expect((error as Error).message).toMatch(/40[13]/);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});

describe('sentry-org-settings CLI', () => {
  // DEPLOYMENT §1.5 runs Terraform from server/infrastructure/sentry; the script must still find
  // its rules file from there (QA probes 002–004 on 2026-10-17 failed with ENOENT).
  it('loads the rules from its own location, whatever the working directory', () => {
    const repoRoot = resolve(__dirname, '../..');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(repoRoot, 'scripts/sentry-org-settings.ts'), '--check'],
      {
        cwd: resolve(repoRoot, 'server/infrastructure/sentry'),
        // Synthetic values; the host is never contacted (`.invalid` is refused before any request).
        env: {
          PATH: process.env.PATH,
          SENTRY_ORG: 'mutaba3a',
          SENTRY_ADMIN_TOKEN: 'synthetic',
          SENTRY_AUTH_TOKEN: 'synthetic',
          SENTRY_BASE_URL: 'https://de.sentry.io.invalid',
        },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('ENOENT');
    expect(result.stderr).toContain('SENTRY_BASE_URL');
  }, 30_000);
});
