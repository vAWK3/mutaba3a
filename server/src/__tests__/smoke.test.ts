import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { parseBaseUrl, runSmoke, type Fetch } from '../smoke.js';

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const BASE = 'https://mutaba3a-api.example';

function appFetch(version = '0.1.0-test', store = new MemoryLedgerStore()): Fetch {
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version,
  });
  return async (input, init) => app.request(input.slice(BASE.length), init);
}

describe('post-deploy smoke checks', () => {
  it('passes every unauthenticated check against a healthy deployment', async () => {
    const results = await runSmoke({ baseUrl: `${BASE}/`, fetch: appFetch(), expectVersion: '0.1.0-test' });
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['GET /health', true],
      ['SERVICE_VERSION matches the deployed tag', true],
      ['GET /ready (database reachable)', true],
      ['GET /openapi.json', true],
      ['GET /v1/integration without a key → 401 UNAUTHENTICATED', true],
      ['GET /v1/integration with a forged key → 401', true],
      ['POST /admin/v1/organizations without X-Admin-Token → 401', true],
    ]);
  });

  it('fails the version check when the deployed tag is not the expected one', async () => {
    const results = await runSmoke({ baseUrl: BASE, fetch: appFetch('abc1234'), expectVersion: 'def5678' });
    const version = results.find((r) => r.name === 'SERVICE_VERSION matches the deployed tag');
    expect(version?.ok).toBe(false);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it('with an admin token, provisions, validates, revokes and proves the revoked key is rejected', async () => {
    const lines: string[] = [];
    const results = await runSmoke({ baseUrl: BASE, fetch: appFetch(), adminToken: ADMIN_TOKEN, log: (l) => lines.push(l) });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.map((r) => r.name)).toContain('revoked key → 401 API_KEY_REVOKED');
    // The secret is printed exactly once by provision.ts, never by the smoke run.
    expect(lines.join('\n')).not.toMatch(/mut_test_[a-z0-9]{8}_/i);
  });

  it('reports a failure, not a crash, when the service is unreachable or not JSON', async () => {
    const broken: Fetch = async () => new Response('<html>502</html>', { status: 502 });
    const results = await runSmoke({ baseUrl: BASE, fetch: broken });
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0]?.detail).toContain('status 502');
  });

  it('stops the provisioning round trip after the first failed admin call', async () => {
    const wrongToken = await runSmoke({ baseUrl: BASE, fetch: appFetch(), adminToken: 'not-the-admin-token-not-the-admin-token-x' });
    const adminSteps = wrongToken.filter((r) => r.name.startsWith('admin:'));
    expect(adminSteps).toHaveLength(1);
    expect(adminSteps[0]?.ok).toBe(false);
  });
});

describe('parseBaseUrl (the --url argument of `npm run smoke`)', () => {
  it('accepts an absolute http(s) URL and strips trailing slashes', () => {
    expect(parseBaseUrl('https://mutaba3a-api-abc.a.run.app/')).toBe('https://mutaba3a-api-abc.a.run.app');
    expect(parseBaseUrl('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('rejects an empty value, which is what an unset shell variable expands to', () => {
    // deploy.sh and DEPLOYMENT.md §3 pass "$URL"; if `terraform output -raw service_url`
    // failed, that is "" and fetch would otherwise crash on "Failed to parse URL from /health".
    expect(() => parseBaseUrl('')).toThrow(/--url/);
    expect(() => parseBaseUrl('   ')).toThrow(/--url/);
  });

  it('rejects a relative path and a non-http scheme', () => {
    expect(() => parseBaseUrl('/health')).toThrow(/absolute http/);
    expect(() => parseBaseUrl('mutaba3a-api.a.run.app')).toThrow(/absolute http/);
    expect(() => parseBaseUrl('ftp://mutaba3a-api.a.run.app')).toThrow(/absolute http/);
  });
});
