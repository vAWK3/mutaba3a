import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../../app.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { generateDeviceSessionToken, sessionDigest } from '../sessions.js';
import type { MinimumBuildConfig } from '../minimum-build.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const PEPPER = 'device-session-test-pepper-32-chars!';
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

function harness(minimumBuild?: MinimumBuildConfig) {
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: 'test',
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180 },
    ...(minimumBuild !== undefined ? { minimumBuild } : {}),
  });
  return { app, store, logger };
}

async function userAndOrg(h: ReturnType<typeof harness>) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const created = await read(await h.app.request('/admin/v1/users', json({ email: 'nour@firm.ps', displayName: 'Nour', organizationId: org.id }, admin)));
  return { orgId: org.id as string, userId: created.user.id as string };
}

async function deviceSessionToken(h: ReturnType<typeof harness>, userId: string) {
  const token = generateDeviceSessionToken();
  const now = new Date();
  await h.store.sessions.create({
    userId,
    tokenDigest: sessionDigest(PEPPER, token),
    kind: 'device',
    at: now,
    idleExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    absoluteExpiresAt: new Date(now.getTime() + 180 * 86_400_000),
    userAgent: null,
  });
  return token;
}

describe('requireMinimumBuild (MUT-293)', () => {
  it('leaves a request with no X-App-Platform header untouched (portal-shaped, or a pre-MUT-293 build)', async () => {
    const h = harness({ ios: { min: 999 }, android: {}, disabled: false });
    const res = await h.app.request('/v1/me');
    expect(res.status).not.toBe(426);
  });

  it('426s a request below the configured floor, before authentication runs', async () => {
    const h = harness({ ios: { min: 50 }, android: {}, disabled: false });
    const res = await h.app.request('/v1/me', { headers: { 'x-app-platform': 'ios', 'x-app-build': '10' } });
    expect(res.status).toBe(426);
    const body = await read(res);
    expect(body.error.code).toBe('APP_UPDATE_REQUIRED');
    expect(body.error.details).toMatchObject({ platform: 'ios', minimumBuild: 50 });
  });

  it('treats a missing or malformed build number on a declared platform as below any floor', async () => {
    const h = harness({ ios: { min: 50 }, android: {}, disabled: false });
    const noBuild = await h.app.request('/v1/me', { headers: { 'x-app-platform': 'ios' } });
    expect(noBuild.status).toBe(426);
    const badBuild = await h.app.request('/v1/me', { headers: { 'x-app-platform': 'ios', 'x-app-build': 'not-a-number' } });
    expect(badBuild.status).toBe(426);
  });

  it('logs the platform, build and floor on every block (eng review safety-valve requirement)', async () => {
    const h = harness({ ios: { min: 50 }, android: {}, disabled: false });
    const warn = vi.spyOn(h.logger, 'warn');
    await h.app.request('/v1/me', { headers: { 'x-app-platform': 'ios', 'x-app-build': '10' } });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ platform: 'ios', build: 10, minimumBuild: 50 }), 'APP_UPDATE_REQUIRED');
  });

  it('sign-in and device-session creation stay reachable below the floor (public routes)', async () => {
    const h = harness({ ios: { min: 999 }, android: {}, disabled: false });
    const headers = { 'x-app-platform': 'ios', 'x-app-build': '1' };
    const signIn = await h.app.request('/v1/sessions', json({ email: 'nobody@firm.ps', password: 'wrong' }, headers));
    expect(signIn.status).not.toBe(426);
    const deviceSignIn = await h.app.request('/v1/device-sessions', json({ email: 'nobody@firm.ps', password: 'wrong' }, headers));
    expect(deviceSignIn.status).not.toBe(426);
  });

  it('/health stays reachable below the floor (mounted outside /v1/*)', async () => {
    const h = harness({ ios: { min: 999 }, android: {}, disabled: false });
    const res = await h.app.request('/health', { headers: { 'x-app-platform': 'ios', 'x-app-build': '1' } });
    expect(res.status).not.toBe(426);
  });

  it('the kill switch bypasses the floor entirely', async () => {
    const h = harness({ ios: { min: 999 }, android: {}, disabled: true });
    const res = await h.app.request('/v1/me', { headers: { 'x-app-platform': 'ios', 'x-app-build': '1' } });
    expect(res.status).not.toBe(426);
  });

  it('no floor configured for the declared platform never gates it', async () => {
    const h = harness({ ios: {}, android: { min: 999 }, disabled: false });
    const res = await h.app.request('/v1/me', { headers: { 'x-app-platform': 'ios', 'x-app-build': '1' } });
    expect(res.status).not.toBe(426);
  });

  it('no minimumBuild config at all (default) never gates anything', async () => {
    const h = harness();
    const res = await h.app.request('/v1/me', { headers: { 'x-app-platform': 'ios', 'x-app-build': '1' } });
    expect(res.status).not.toBe(426);
  });

  describe('soft nudge, on a real authenticated 200 response', () => {
    async function authedMe(h: ReturnType<typeof harness>, build: number) {
      const { orgId, userId } = await userAndOrg(h);
      const token = await deviceSessionToken(h, userId);
      return h.app.request('/v1/me', {
        headers: { authorization: `Bearer ${token}`, 'x-mutaba3a-profile': orgId, 'x-app-platform': 'ios', 'x-app-build': String(build) },
      });
    }

    it('between the floor and the recommended build: 200 plus the nudge headers', async () => {
      const h = harness({ ios: { min: 10, recommended: 20 }, android: {}, disabled: false });
      const res = await authedMe(h, 15);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Update-Available')).toBe('true');
      expect(res.headers.get('X-Recommended-Build')).toBe('20');
    });

    it('at or above the recommended build: 200, no nudge headers', async () => {
      const h = harness({ ios: { min: 10, recommended: 20 }, android: {}, disabled: false });
      const res = await authedMe(h, 20);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Update-Available')).toBeNull();
      expect(res.headers.get('X-Recommended-Build')).toBeNull();
    });

    it('no recommended build configured: 200, no nudge headers even above the floor', async () => {
      const h = harness({ ios: { min: 10 }, android: {}, disabled: false });
      const res = await authedMe(h, 15);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Update-Available')).toBeNull();
    });
  });
});
