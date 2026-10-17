/**
 * MUT-147 (ADR-091, R9): the Sentry org's privacy settings, which the Terraform provider can't
 * hold. `scripts/sentry-org-settings.ts` is the CLI; this module is the testable part.
 *
 * The settings come from `docs/observability/sentry-rules.json`: its `orgSettings` switches, and
 * its `orgSensitiveFields` as the org's sensitive fields. That list is curated, not the deny
 * tokens: Sentry's server-side scrubber removes any value that merely *contains* a sensitive
 * field, so a short token such as `ip` or `name` would wipe ordinary error text (D2).
 */

export type OrgSettings = {
  dataScrubber: boolean;
  dataScrubberDefaults: boolean;
  scrubIPAddresses: boolean;
  enhancedPrivacy: boolean;
  allowSharedIssues: boolean;
  require2FA: boolean;
  safeFields: string[];
  sensitiveFields: string[];
};

export type OrgSettingsArgs = { mode: 'apply' | 'check'; org: string; baseUrl: string; token: string };
export type Drift = { field: keyof OrgSettings; expected: string; actual: string };

type ScrubRules = { region: string; orgSensitiveFields: string[]; orgSettings: Record<string, boolean> };
type OrgResponse = Partial<OrgSettings> & { links?: { regionUrl?: string } };

const SWITCHES = [
  'dataScrubber',
  'dataScrubberDefaults',
  'scrubIPAddresses',
  'enhancedPrivacy',
  'allowSharedIssues',
  'require2FA',
] as const;
const DEFAULT_BASE_URL = 'https://de.sentry.io';
/** Only Sentry's own API hosts ever receive the admin token (D9). */
const SENTRY_HOST = /^https:\/\/([a-z0-9-]+\.)?sentry\.io$/;
/** Every Terraform-managed project slug starts with this (server/infrastructure/sentry/main.tf). */
const PROJECT_PREFIX = 'mutaba3a-';
/** A stalled connection fails the run instead of hanging the operator's shell. */
const REQUEST_TIMEOUT_MS = 15_000;

export function desiredOrgSettings(rules: ScrubRules): OrgSettings {
  const switches = Object.fromEntries(SWITCHES.map((field) => [field, rules.orgSettings[field] === true]));
  return { ...(switches as Pick<OrgSettings, (typeof SWITCHES)[number]>), safeFields: [], sensitiveFields: [...rules.orgSensitiveFields] };
}

export function expectedRegionUrl(rules: ScrubRules): string {
  return `https://${rules.region}`;
}

/** What the org has that differs from `desired`. Extra sensitive fields added by hand are fine; any safe field is not. */
export function orgSettingsDrift(current: Partial<OrgSettings>, desired: OrgSettings): Drift[] {
  const drift: Drift[] = SWITCHES.filter((field) => current[field] !== desired[field]).map((field) => ({
    field,
    expected: String(desired[field]),
    actual: current[field] === undefined ? 'missing' : String(current[field]),
  }));
  if ((current.safeFields ?? []).length > 0) {
    drift.push({ field: 'safeFields', expected: 'none', actual: (current.safeFields ?? []).join(', ') });
  }
  const present = new Set((current.sensitiveFields ?? []).map((field) => field.toLowerCase()));
  const missing = desired.sensitiveFields.filter((field) => !present.has(field.toLowerCase()));
  if (missing.length > 0) drift.push({ field: 'sensitiveFields', expected: missing.join(', '), actual: 'missing' });
  return drift;
}

/** `--apply` or `--check` and nothing else; SENTRY_ORG, SENTRY_ADMIN_TOKEN, optional SENTRY_BASE_URL. */
export function parseOrgSettingsArgs(argv: string[], env: Record<string, string | undefined>): OrgSettingsArgs {
  if (argv.length !== 1 || (argv[0] !== '--apply' && argv[0] !== '--check')) {
    throw new Error('Pass exactly one of --apply or --check, and nothing else. The org comes from SENTRY_ORG.');
  }
  const org = env.SENTRY_ORG;
  if (!org) throw new Error('Set SENTRY_ORG to the Mutaba3a Sentry org slug.');
  // Never SENTRY_AUTH_TOKEN: that name belongs to the upload-only build token (D8).
  const token = env.SENTRY_ADMIN_TOKEN;
  if (!token) {
    throw new Error(
      'Set SENTRY_ADMIN_TOKEN to a personal (user) auth token (sntryu_…) with org:write, for this command only. An org token (sntrys_…) cannot carry the admin scopes.',
    );
  }
  const baseUrl = (env.SENTRY_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '').replace(/\/api(\/0)?$/, '');
  if (!SENTRY_HOST.test(baseUrl)) {
    throw new Error('SENTRY_BASE_URL must be https://sentry.io or a regional https://<region>.sentry.io host.');
  }
  return { mode: argv[0] === '--apply' ? 'apply' : 'check', org, baseUrl, token };
}

async function call(fetchFn: typeof fetch, method: 'GET' | 'PUT', url: string, token: string, body?: OrgSettings) {
  const response = await fetchFn(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    // The admin token goes only to the host the operator named, never to a redirect target.
    redirect: 'error',
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`Sentry answered ${method} ${url} with ${response.status}: ${detail}`);
  }
  return response;
}

const readOrg = async (fetchFn: typeof fetch, url: string, token: string) =>
  (await (await call(fetchFn, 'GET', url, token)).json()) as OrgResponse;

const withoutTrailingSlash = (url: string | undefined) => url?.replace(/\/+$/, '');

/**
 * ADR-091: the org is Mutaba3a-only. A personal admin token reaches every org its owner belongs
 * to, so refuse one holding any other product's project before writing a thing (D16). An empty
 * org passes: on the first run Terraform may not have created the projects yet.
 */
async function assertMutaba3aOnly(fetchFn: typeof fetch, orgUrl: string, args: OrgSettingsArgs) {
  const response = await call(fetchFn, 'GET', `${orgUrl}projects/`, args.token);
  // Sentry pages this list (Link header); a project past page one would go unseen, so fail closed.
  if (/rel="next"; results="true"/.test(response.headers.get('link') ?? '')) {
    throw new Error(`Org "${args.org}" has more than one page of projects, so it can't be Mutaba3a-only. Stop: check SENTRY_ORG.`);
  }
  const projects = (await response.json()) as Array<{ slug?: string }>;
  const foreign = projects.map((project) => project.slug ?? '(no slug)').filter((slug) => !slug.startsWith(PROJECT_PREFIX));
  if (foreign.length > 0) {
    throw new Error(
      `Org "${args.org}" holds projects that aren't Mutaba3a's (${foreign.join(', ')}). Stop: check SENTRY_ORG; ADR-091 needs a Mutaba3a-only org.`,
    );
  }
}

/** Keeps every field already on the org (added by hand) and adds the desired ones, case-insensitively. */
function mergeFields(current: string[] = [], wanted: string[]): string[] {
  const present = new Set(current.map((field) => field.toLowerCase()));
  return [...current, ...wanted.filter((field) => !present.has(field.toLowerCase()))];
}

/**
 * Reads the org and refuses one outside the expected region (D5); for apply, writes the settings
 * and reads them back. Returns any drift.
 */
export async function syncOrgSettings(
  args: OrgSettingsArgs,
  desired: OrgSettings,
  regionUrl: string,
  fetchFn: typeof fetch,
): Promise<Drift[]> {
  const url = `${args.baseUrl}/api/0/organizations/${encodeURIComponent(args.org)}/`;
  const before = await readOrg(fetchFn, url, args.token);
  const actualRegion = withoutTrailingSlash(before.links?.regionUrl);
  if (actualRegion !== withoutTrailingSlash(regionUrl)) {
    throw new Error(
      `Org "${args.org}" is in ${actualRegion ?? 'an unknown region'}, not ${regionUrl}. Stop: Mutaba3a's reports must stay in the EU (ADR-091).`,
    );
  }
  await assertMutaba3aOnly(fetchFn, url, args);
  if (args.mode === 'check') return orgSettingsDrift(before, desired);
  // The PUT's body is never read: the GET after it is the verification.
  await call(fetchFn, 'PUT', url, args.token, { ...desired, sensitiveFields: mergeFields(before.sensitiveFields, desired.sensitiveFields) });
  return orgSettingsDrift(await readOrg(fetchFn, url, args.token), desired);
}
