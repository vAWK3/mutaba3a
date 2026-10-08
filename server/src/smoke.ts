/**
 * Post-deploy smoke checks (scripts/deploy.sh step 5; `npm run smoke`).
 *
 * Pure over an injected `fetch`, so the same checks run against a live Cloud
 * Run URL and, in tests, against the in-memory app. Prints no secrets: the
 * provisioning round trip reports statuses and codes only.
 */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SmokeOptions {
  baseUrl: string;
  fetch: Fetch;
  /** With a token the run also provisions a throwaway organization, validates its key and revokes it. */
  adminToken?: string | undefined;
  /** When set, /health must report exactly this SERVICE_VERSION. */
  expectVersion?: string | undefined;
  log?: ((line: string) => void) | undefined;
}

export interface SmokeResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const TIMEOUT_MS = 15_000;

/** A syntactically valid key whose prefix no deployment has issued. */
export const FORGED_KEY = 'mut_test_00000000_notarealkeynotarealkeynotarealkeynotareal';

/**
 * Validates the service base URL before any request is made and returns it
 * without trailing slashes. Throws a one-line, operator-readable error instead
 * of letting fetch fail with "Failed to parse URL from /health": the usual
 * cause is `--url "$URL"` with URL empty because `terraform output -raw
 * service_url` failed (the Cloud Run service does not exist yet).
 */
export function parseBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new Error('--url is empty; pass the service URL (e.g. --url https://mutaba3a-api-xxxx.a.run.app). ' +
      'If it came from `terraform output -raw service_url`, the Cloud Run service has not been created yet: re-run scripts/deploy.sh.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`--url must be an absolute http(s) URL, got "${trimmed}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`--url must be an absolute http(s) URL, got "${trimmed}"`);
  }
  return trimmed.replace(/\/+$/, '');
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult[]> {
  const ctx = new SmokeContext(options);
  await ctx.unauthenticatedChecks();
  if (options.adminToken) await ctx.provisioningRoundTrip(options.adminToken);
  return ctx.results;
}

class SmokeContext {
  readonly results: SmokeResult[] = [];
  private readonly base: string;

  constructor(private readonly options: SmokeOptions) {
    this.base = parseBaseUrl(options.baseUrl);
  }

  private record(ok: boolean, name: string, detail: string): void {
    this.results.push({ name, ok, detail });
    this.options.log?.(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Reply> {
    const res = await this.options.fetch(`${this.base}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return { status: res.status, body: { raw: text.slice(0, 200) } };
    }
  }

  async unauthenticatedChecks(): Promise<void> {
    const health = await this.request('/health');
    this.record(health.status === 200 && health.body.status === 'ok', 'GET /health', `status ${health.status}, version ${String(health.body.version)}`);
    if (this.options.expectVersion) {
      this.record(health.body.version === this.options.expectVersion, 'SERVICE_VERSION matches the deployed tag', `${String(health.body.version)} vs ${this.options.expectVersion}`);
    }

    const ready = await this.request('/ready');
    this.record(ready.status === 200 && ready.body.status === 'ready', 'GET /ready (database reachable)', `status ${ready.status}`);

    const contract = await this.request('/openapi.json');
    this.record(contract.status === 200 && typeof contract.body.openapi === 'string', 'GET /openapi.json', `openapi ${String(contract.body.openapi)}`);

    const noKey = await this.request('/v1/integration');
    this.record(noKey.status === 401 && errorCode(noKey) === 'UNAUTHENTICATED', 'GET /v1/integration without a key → 401 UNAUTHENTICATED', `${noKey.status} ${errorCode(noKey)}`);

    const forged = await this.request('/v1/integration', { headers: { authorization: `Bearer ${FORGED_KEY}` } });
    this.record(forged.status === 401, 'GET /v1/integration with a forged key → 401', `${forged.status} ${errorCode(forged)}`);

    const noAdmin = await this.request('/admin/v1/organizations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    this.record(noAdmin.status === 401, 'POST /admin/v1/organizations without X-Admin-Token → 401', `${noAdmin.status} ${errorCode(noAdmin)}`);
  }

  async provisioningRoundTrip(token: string): Promise<void> {
    const headers = { 'content-type': 'application/json', 'x-admin-token': token };
    const stamp = Date.now().toString(36);
    const org = await this.request('/admin/v1/organizations', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `smoke ${stamp}`, slug: `smoke-${stamp}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }),
    });
    this.record(org.status === 201, 'admin: create a throwaway organization', `status ${org.status}`);
    const organizationId = typeof org.body.id === 'string' ? org.body.id : undefined;
    if (!organizationId) return;

    const key = await this.request(`/admin/v1/organizations/${organizationId}/api-keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'smoke', scopes: ['integration:read'] }),
    });
    this.record(key.status === 201, 'admin: issue an API key', `status ${key.status}`);
    const secret = typeof key.body.secret === 'string' ? key.body.secret : undefined;
    const keyId = (key.body.apiKey as { id?: string } | undefined)?.id;
    if (!secret || !keyId) return;

    const validate = await this.request('/v1/integration', { headers: { authorization: `Bearer ${secret}` } });
    const orgOnWire = (validate.body.organization as { id?: string } | undefined)?.id;
    this.record(validate.status === 200 && orgOnWire === organizationId, 'GET /v1/integration with the new key → 200 for its own organization', `status ${validate.status}`);

    const revoke = await this.request(`/admin/v1/api-keys/${keyId}/revoke`, { method: 'POST', headers, body: JSON.stringify({ reason: 'smoke test' }) });
    this.record(revoke.status === 200, 'admin: revoke the smoke key', `status ${revoke.status}`);

    const afterRevoke = await this.request('/v1/integration', { headers: { authorization: `Bearer ${secret}` } });
    this.record(afterRevoke.status === 401 && errorCode(afterRevoke) === 'API_KEY_REVOKED', 'revoked key → 401 API_KEY_REVOKED', `${afterRevoke.status} ${errorCode(afterRevoke)}`);
    this.options.log?.(`note: organization smoke-${stamp} (${organizationId}) remains; organizations are never deleted (audit retention).`);
  }
}

function errorCode(reply: Reply): string {
  const err = reply.body.error as { code?: string } | undefined;
  return err?.code ?? '';
}
