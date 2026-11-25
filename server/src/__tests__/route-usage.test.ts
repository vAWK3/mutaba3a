import { Hono } from 'hono';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { RouteUsageDelta } from '../repositories/ports.js';
import { routeKeyOf, UNMATCHED_ROUTE } from '../usage/route-key.js';
import { RouteMeter } from '../usage/route-meter.js';

/**
 * MUT-735 (ADR-281): the access log feeds the route statistics: the route template (never the raw path), the final
 * status after onError, the plan a metered action resolved; health probes and the portal's files are not counted.
 */
function harness() {
  const flushed: RouteUsageDelta[] = [];
  const now = new Date('2026-12-01T10:00:00Z');
  const routeMeter = new RouteMeter({ sink: async (d) => void flushed.push(...d), now: () => now, logError: () => {} });
  const app = createApp({
    store: new MemoryLedgerStore(),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: 'test-admin-token-with-at-least-32-characters',
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => now,
    routeMeter,
  });
  const rows = async () => {
    await routeMeter.flush();
    return flushed;
  };
  return { app, rows };
}

describe('route statistics in the access log (MUT-735)', () => {
  it('counts by route template and final status class; unmatched paths share one key; probes are not counted', async () => {
    const h = harness();
    expect((await h.app.request('/v1/me')).status).toBe(401);
    expect((await h.app.request('/v1/customers/5f0c3c1e-4b5a-4d39-9a43-0f6f3d0f2b11')).status).toBe(401);
    // authenticate() answers an unknown /v1 path first (a thrown 401, the final status after onError).
    expect((await h.app.request('/v1/no-such-thing/123')).status).toBe(401);
    expect((await h.app.request('/v1/no-such-other/456')).status).toBe(401);
    expect((await h.app.request('/openapi.json')).status).toBe(200);
    expect((await h.app.request('/health')).status).toBe(200);
    await h.app.request('/ready');
    const rows = await h.rows();
    const keys = rows.map((r) => `${r.routeKey} ${r.statusClass} ${r.count}`).sort();
    expect(keys).toEqual(['GET /openapi.json 2xx 1', 'GET /v1/customers/:customerId 4xx 1', 'GET /v1/me 4xx 1', `${UNMATCHED_ROUTE} 4xx 2`].sort());
    expect(rows.every((r) => r.plan === 'unknown' && r.day === '2026-12-01')).toBe(true);
    // Never an id in a key.
    expect(rows.some((r) => /[0-9a-f]{8}-/.test(r.routeKey))).toBe(false);
  });

  it('an app.all route is keyed by its own path', async () => {
    const app = new Hono();
    let key = '';
    app.all('/hooks/:id', (c) => {
      key = routeKeyOf(c);
      return c.text('ok');
    });
    await app.request('/hooks/42', { method: 'PATCH' });
    expect(key).toBe('PATCH /hooks/:id');
  });
});
