/**
 * MUT-147 (ADR-091, R9): the Sentry org's privacy settings, which the Terraform provider can't
 * hold. `scripts/sentry-org-settings.ts` is the CLI; this module is the testable part.
 *
 * The settings come from `docs/observability/sentry-rules.json`: its `orgSettings` switches,
 * and its `denyKeyTokens` as the org's sensitive fields, so Sentry's server-side scrubber backs
 * up every surface's own scrubber with the same list.
 */

export type OrgSettings = {
  dataScrubber: boolean;
  dataScrubberDefaults: boolean;
  scrubIPAddresses: boolean;
  sensitiveFields: string[];
};

export type OrgSettingsArgs = { mode: 'apply' | 'check'; org: string; baseUrl: string; token: string };
export type Drift = { field: keyof OrgSettings; expected: string; actual: string };

type ScrubRules = { denyKeyTokens: string[]; orgSettings: Record<string, boolean> };

const SWITCHES = ['dataScrubber', 'dataScrubberDefaults', 'scrubIPAddresses'] as const;
const DEFAULT_BASE_URL = 'https://de.sentry.io';

export function desiredOrgSettings(rules: ScrubRules): OrgSettings {
  return {
    dataScrubber: rules.orgSettings.dataScrubber === true,
    dataScrubberDefaults: rules.orgSettings.dataScrubberDefaults === true,
    scrubIPAddresses: rules.orgSettings.scrubIPAddresses === true,
    sensitiveFields: [...rules.denyKeyTokens],
  };
}

/** What the org has that differs from `desired`. Extra sensitive fields added by hand are fine. */
export function orgSettingsDrift(current: Partial<OrgSettings>, desired: OrgSettings): Drift[] {
  const drift: Drift[] = SWITCHES.filter((field) => current[field] !== desired[field]).map((field) => ({
    field,
    expected: String(desired[field]),
    actual: current[field] === undefined ? 'missing' : String(current[field]),
  }));
  const present = new Set((current.sensitiveFields ?? []).map((field) => field.toLowerCase()));
  const missing = desired.sensitiveFields.filter((field) => !present.has(field.toLowerCase()));
  if (missing.length > 0) drift.push({ field: 'sensitiveFields', expected: missing.join(', '), actual: 'missing' });
  return drift;
}

/** `--apply` or `--check`, `--org <slug>` or SENTRY_ORG, SENTRY_AUTH_TOKEN, optional SENTRY_BASE_URL. */
export function parseOrgSettingsArgs(argv: string[], env: Record<string, string | undefined>): OrgSettingsArgs {
  const modes = argv.filter((arg) => arg === '--apply' || arg === '--check');
  if (modes.length !== 1) throw new Error('Pass exactly one of --apply or --check.');
  const orgFlag = argv.indexOf('--org');
  if (orgFlag !== -1 && !argv[orgFlag + 1]) throw new Error('--org needs a value.');
  const org = orgFlag !== -1 ? argv[orgFlag + 1] : env.SENTRY_ORG;
  if (!org) throw new Error('Set SENTRY_ORG or pass --org <slug>.');
  const token = env.SENTRY_AUTH_TOKEN;
  if (!token) throw new Error('Set SENTRY_AUTH_TOKEN to an org admin token (org:write) in your shell.');
  const baseUrl = (env.SENTRY_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '').replace(/\/api(\/0)?$/, '');
  if (!baseUrl.startsWith('https://')) throw new Error('SENTRY_BASE_URL must be an https URL.');
  return { mode: modes[0] === '--apply' ? 'apply' : 'check', org, baseUrl, token };
}

async function call(fetchFn: typeof fetch, method: 'GET' | 'PUT', url: string, token: string, body?: OrgSettings) {
  const response = await fetchFn(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`Sentry answered ${method} ${url} with ${response.status}: ${detail}`);
  }
  return (await response.json()) as Partial<OrgSettings>;
}

/** Writes the settings (apply only), then reads them back and returns any drift. */
export async function syncOrgSettings(args: OrgSettingsArgs, desired: OrgSettings, fetchFn: typeof fetch): Promise<Drift[]> {
  const url = `${args.baseUrl}/api/0/organizations/${encodeURIComponent(args.org)}/`;
  if (args.mode === 'apply') await call(fetchFn, 'PUT', url, args.token, desired);
  return orgSettingsDrift(await call(fetchFn, 'GET', url, args.token), desired);
}
