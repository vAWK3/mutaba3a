import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';

const APP_ASSOCIATION: AppDependencies['appAssociation'] = {
  appleTeamId: '4LCWA596X7',
  appleBundleId: 'com.barmajiyat.mutaba3a',
  androidPackageName: 'com.barmajiyat.mutaba3a',
  androidSha256Fingerprints: ['AA:BB:CC'],
};

/**
 * MUT-45: the API serves the hosted-portal build from the same origin. These
 * tests use a fixture dist dir (not a real `npm run build:hosted` output) so
 * the server suite never depends on the frontend build running first.
 */
function harness(portal?: { distDir: string } | null, appAssociation?: AppDependencies['appAssociation']) {
  return createApp({
    store: new MemoryLedgerStore(),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    ...(portal !== undefined ? { portal } : {}),
    ...(appAssociation !== undefined ? { appAssociation } : {}),
  });
}

describe('portal serving — disabled (default, matches every other test file)', () => {
  const app = harness();

  it('an unknown GET still gets the existing JSON 404, not a portal page', async () => {
    const res = await app.request('/some-page');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await read(res);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('/health is unaffected', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});

describe('portal serving — app association absent (MUT-111 default, matches every other test file)', () => {
  it('the well-known paths get the JSON 404, not the portal shell, even with the portal build mounted', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'mutaba3a-portal-'));
    await writeFile(join(distDir, 'index.html'), '<!doctype html><html><body>portal shell</body></html>');
    const app = harness({ distDir });
    try {
      for (const path of ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json']) {
        const res = await app.request(path);
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect((await read(res)).error.code).toBe('NOT_FOUND');
      }
    } finally {
      await rm(distDir, { recursive: true, force: true });
    }
  });
});

describe('portal serving — app association enabled', () => {
  it('the well-known paths answer directly, without the portal build mounted', async () => {
    const app = harness(null, APP_ASSOCIATION);
    const res = await app.request('/.well-known/apple-app-site-association');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('the well-known paths win over the SPA shell when both are mounted, and /health, /ready, CSP stay unaffected', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'mutaba3a-portal-'));
    await writeFile(join(distDir, 'index.html'), '<!doctype html><html><body>portal shell</body></html>');
    try {
      const app = harness({ distDir }, APP_ASSOCIATION);

      const aasa = await app.request('/.well-known/apple-app-site-association');
      expect(aasa.status).toBe(200);
      expect(aasa.headers.get('content-type')).toContain('application/json');
      expect(await read(aasa)).toHaveProperty('applinks');

      const assetlinks = await app.request('/.well-known/assetlinks.json');
      expect(assetlinks.status).toBe(200);
      expect(assetlinks.headers.get('content-type')).toContain('application/json');

      const health = await app.request('/health');
      expect(health.status).toBe(200);
      const ready = await app.request('/ready');
      expect(ready.status).toBe(200);

      const expectedCsp =
        "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com https://storage.googleapis.com; connect-src 'self' https://storage.googleapis.com https://eu.i.posthog.com https://o4512029835526144.ingest.de.sentry.io; img-src 'self' data: https://storage.googleapis.com; frame-ancestors 'none'; form-action 'self'";
      expect(aasa.headers.get('content-security-policy')).toBe(expectedCsp);
    } finally {
      await rm(distDir, { recursive: true, force: true });
    }
  });
});

describe('portal serving — enabled', () => {
  let distDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    distDir = await mkdtemp(join(tmpdir(), 'mutaba3a-portal-'));
    await mkdir(join(distDir, 'assets'), { recursive: true });
    await writeFile(join(distDir, 'index.html'), '<!doctype html><html><body>portal shell</body></html>');
    await writeFile(join(distDir, 'assets', 'app-abc123.js'), 'console.log("hosted portal");');
    await writeFile(join(distDir, 'favicon.svg'), '<svg></svg>');
    app = harness({ distDir });
  });

  afterAll(async () => {
    await rm(distDir, { recursive: true, force: true });
  });

  it('serves a hashed asset under /assets/* with immutable caching', async () => {
    const res = await app.request('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log("hosted portal");');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('serves a root-level public file (favicon) as itself, not the SPA shell, and never immutable-caches it', async () => {
    const res = await app.request('/favicon.svg');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<svg></svg>');
    expect(res.headers.get('cache-control')).not.toContain('immutable');
  });

  it('a stale/nonexistent hashed asset falls back to the SPA shell, not a permanently-cached broken response', async () => {
    // Regression: a deploy rotates asset hashes; a client with an old cached
    // page may still request the old filename. That must 404-equivalent into
    // the SPA shell with the default no-store header, never get immutably
    // cached as if it were a real, unchanging asset.
    const res = await app.request('/assets/stale-nonexistent-hash.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('portal shell');
    expect(res.headers.get('cache-control')).not.toContain('immutable');
  });

  it('falls back to index.html for a client-side route, without immutable caching', async () => {
    const res = await app.request('/clients/some-id');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('portal shell');
    expect(res.headers.get('cache-control')).not.toContain('immutable');
  });

  it('falls back to index.html for the bare root path', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('portal shell');
  });

  it('does not catch /health, /ready or /openapi.json — they still reach their real handlers', async () => {
    const health = await app.request('/health');
    expect(health.status).toBe(200);
    expect((await read(health)).status).toBe('ok');

    const openapi = await app.request('/openapi.json');
    expect(openapi.status).toBe(200);
    expect(openapi.headers.get('content-type')).toContain('application/json');
  });

  it('does not catch an unknown /v1/* path — authenticate() still runs and answers JSON, never the SPA shell', async () => {
    // No credentials: authenticate() rejects before routing even resolves the
    // path, same as today (pre-existing behavior, unrelated to the portal).
    const v1 = await app.request('/v1/totally-not-a-real-route');
    expect(v1.status).toBe(401);
    expect(v1.headers.get('content-type')).toContain('application/json');
  });

  it('does not catch an unknown /admin/* path — a real request still gets the JSON 404, not the SPA shell', async () => {
    const res = await app.request('/admin/totally-not-a-real-route', { headers: { 'x-admin-token': ADMIN_TOKEN } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect((await read(res)).error.code).toBe('NOT_FOUND');
  });

  // MUT-149 AC4 (D6 layer 3): source maps are uploaded to Sentry, never served, even if one reached the dist
  it('answers 404 for a source map, even when the file exists', async () => {
    await writeFile(join(distDir, 'assets', 'app-abc123.js.map'), '{"version":3,"sources":["src/hosted/main.tsx"]}');
    const res = await app.request('/assets/app-abc123.js.map');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('sources');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('still serves the asset next to a source map', async () => {
    const res = await app.request('/assets/app-abc123.js');
    expect(res.status).toBe(200);
  });

  it('adds the CSP header to both API and portal responses', async () => {
    const api = await app.request('/health');
    const portalPage = await app.request('/');
    // connect-src includes the GCS signed-URL host: receipt uploads (MUT-44)
    // PUT bytes directly to it via fetch(), which connect-src governs — unlike
    // downloads, which are top-level navigations and need no entry here. MUT-149
    // adds the Sentry org's EU ingest host, and nothing else (AC5). MUT-368: Cloudflare Turnstile's script and its
    // challenge frame, on /signup and /recover only, and nothing else.
    const expected =
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com https://storage.googleapis.com; connect-src 'self' https://storage.googleapis.com https://eu.i.posthog.com https://o4512029835526144.ingest.de.sentry.io; img-src 'self' data: https://storage.googleapis.com; frame-ancestors 'none'; form-action 'self'";
    expect(api.headers.get('content-security-policy')).toBe(expected);
    expect(portalPage.headers.get('content-security-policy')).toBe(expected);
  });
});
