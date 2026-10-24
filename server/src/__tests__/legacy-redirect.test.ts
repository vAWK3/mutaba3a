import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { FRONT_DOOR_HEADER, LEGACY_CARRY_OVER_PATH } from '../auth/sessions.js';
import type { SessionSettings } from '../auth/middleware.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-326 stage "redirect" (ADR-155 D5): once the carry-over has shipped, a portal
 * page visited on the old run.app host goes to the same-origin carry-over page,
 * which checks this browser's local records and then sends it on to the new host.
 * Everything else on the old host keeps answering: the API (old phones, Malafat),
 * the association files (old app builds), health checks, assets.
 */
const TOKEN = 't'.repeat(48);
const SESSIONS: SessionSettings = {
  pepper: 'p'.repeat(64),
  idleMinutes: 120,
  absoluteHours: 12,
  secureCookie: true,
  trustedProxyHops: 1,
  portalOrigin: 'https://app.placeholder.example',
  frontDoorToken: TOKEN,
  legacyRedirect: true,
};

let distDir: string;

beforeAll(async () => {
  distDir = await mkdtemp(join(tmpdir(), 'mutaba3a-portal-'));
  await writeFile(join(distDir, 'index.html'), '<!doctype html><html><body>portal shell</body></html>');
  await writeFile(join(distDir, 'favicon.svg'), '<svg/>');
  await mkdir(join(distDir, 'assets'));
  await writeFile(join(distDir, 'assets', 'index-abc.js'), 'console.log(1)');
});

afterAll(async () => {
  await rm(distDir, { recursive: true, force: true });
});

function harness(sessions: Partial<SessionSettings> = {}) {
  return createApp({
    store: new MemoryLedgerStore(),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: 'test-admin-token-with-at-least-32-characters',
    keyEnvironment: 'test',
    version: '0.1.0-test',
    sessions: { ...SESSIONS, ...sessions },
    portal: { distDir },
  });
}

const OLD = 'https://service.a.run.app';

describe('legacy-host redirect (MUT-326)', () => {
  let app: ReturnType<typeof harness>;
  beforeAll(() => {
    app = harness();
  });

  it.each(['/', '/sign-in', '/p/abc/expenses', '/capture?type=expense&amount=12'])('sends a direct visit to %s through the carry-over page', async (path) => {
    const res = await app.request(`${OLD}${path}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${LEGACY_CARRY_OVER_PATH}?next=${encodeURIComponent(path)}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('serves the carry-over page itself on the old host (it reads this origin\'s local records)', async () => {
    const res = await app.request(`${OLD}${LEGACY_CARRY_OVER_PATH}?next=%2F`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('portal shell');
  });

  it('never redirects through the front door', async () => {
    const res = await app.request(`${OLD}/sign-in`, { headers: { [FRONT_DOOR_HEADER]: TOKEN } });
    expect(res.status).toBe(200);
  });

  it('treats a wrong front-door token as a direct visit', async () => {
    const res = await app.request(`${OLD}/sign-in`, { headers: { [FRONT_DOOR_HEADER]: 'guess' }, redirect: 'manual' });
    expect(res.status).toBe(302);
  });

  it.each([
    ['the API', '/v1/me', 401],
    ['health', '/health', 200],
    ['readiness', '/ready', 503],
    ['an asset', '/assets/index-abc.js', 200],
    ['a static file', '/favicon.svg', 200],
    ['an admin route', '/admin/api-keys', 401],
  ])('keeps answering %s on the old host', async (_name, path, status) => {
    const res = await app.request(`${OLD}${path}`, { redirect: 'manual' });
    expect(res.status).not.toBe(302);
    if (status !== 503) expect(res.status).toBe(status);
  });

  it('keeps the association files on the old host (no redirect, even unconfigured)', async () => {
    const res = await app.request(`${OLD}/.well-known/apple-app-site-association`, { redirect: 'manual' });
    expect(res.status).not.toBe(302);
  });

  it('never redirects a write', async () => {
    const res = await app.request(`${OLD}/sign-in`, { method: 'POST', redirect: 'manual' });
    expect(res.status).not.toBe(302);
  });

  // MUT-291 §3.2: the carry-over's popup answers through window.opener, which COOP same-origin would cut.
  it.each([
    ['the old host\'s carry-over page', `${OLD}${LEGACY_CARRY_OVER_PATH}?next=%2F`, {}],
    ['the new host\'s receiver', `${OLD}/carry-over/receive?from=web`, { [FRONT_DOOR_HEADER]: TOKEN }],
  ])('serves %s with no Cross-Origin-Opener-Policy', async (_name, url, headers) => {
    const res = await app.request(url, { headers, redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('portal shell');
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
  });

  it('is off unless the stage turns it on', async () => {
    const res = await harness({ legacyRedirect: false }).request(`${OLD}/sign-in`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });

  it('is off without a front door, whatever the flag says (config.ts refuses that combination too)', async () => {
    const withoutDoor: SessionSettings = { ...SESSIONS };
    delete withoutDoor.frontDoorToken;
    const app = createApp({
      store: new MemoryLedgerStore(),
      logger: pino({ level: 'silent' }),
      rateLimiter: new SlidingWindowRateLimiter(1000),
      adminToken: 'test-admin-token-with-at-least-32-characters',
      keyEnvironment: 'test',
      version: '0.1.0-test',
      sessions: withoutDoor,
      portal: { distDir },
    });
    expect((await app.request(`${OLD}/sign-in`, { redirect: 'manual' })).status).toBe(200);
  });
});
