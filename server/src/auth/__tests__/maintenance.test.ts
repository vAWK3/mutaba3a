import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../app.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const PEPPER = 'device-session-test-pepper-32-chars!';

function harness(maintenance?: boolean) {
  return createApp({
    store: new MemoryLedgerStore(),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: 'test',
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1, deviceIdleDays: 30, deviceAbsoluteDays: 180 },
    minimumBuild: { ios: { min: 50 }, android: {}, disabled: false },
    ...(maintenance !== undefined ? { maintenance } : {}),
  });
}

const phone = (platform: string, build = '100') => ({ headers: { 'x-app-platform': platform, 'x-app-build': build } });

describe('requireNotInMaintenance (MUT-551, release gate RF-2)', () => {
  it('on: every phone request answers 503 MAINTENANCE, sign-in included', async () => {
    const app = harness(true);
    for (const platform of ['ios', 'android']) {
      const me = await app.request('/v1/me', phone(platform));
      expect(me.status).toBe(503);
      expect((await read(me)).error.code).toBe('MAINTENANCE');
    }
    const signIn = await app.request('/v1/device-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-platform': 'ios', 'x-app-build': '100' },
      body: JSON.stringify({ email: 'nour@firm.ps', password: 'x' }),
    });
    expect(signIn.status).toBe(503);
  });

  it('on: comes before the minimum-build floor, so a 426 means maintenance is off', async () => {
    const res = await harness(true).request('/v1/me', phone('ios', '1'));
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('MAINTENANCE');
  });

  it('on: the portal (no X-App-Platform) and /health are untouched', async () => {
    const app = harness(true);
    expect((await app.request('/v1/me')).status).toBe(401);
    expect((await app.request('/health')).status).toBe(200);
  });

  it('off (the default): phones pass through to the floor and auth', async () => {
    for (const app of [harness(false), harness()]) {
      expect((await app.request('/v1/me', phone('ios'))).status).toBe(401);
      const below = await app.request('/v1/me', phone('ios', '1'));
      expect(below.status).toBe(426);
    }
  });
});
