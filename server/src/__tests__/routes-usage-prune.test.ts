import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/** MUT-735 (ADR-281 §12): the daily usage prune, behind the job token. */
const JOB_TOKEN = 'test-job-token-with-at-least-32-characters-long';
const NOW = new Date('2026-11-25T03:00:00Z');

function harness() {
  const store = new MemoryLedgerStore();
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(1_000_000), adminToken: 'test-admin-token-with-at-least-32-characters', keyEnvironment: 'test', version: '0.1.0-test', now: () => NOW, jobToken: JOB_TOKEN });
  return { app, store };
}

const event = (month: string) => ({ occurredAt: new Date(`${month}-10T00:00:00Z`), month, subjectKey: 'user:prune', actorUserId: null, organizationId: null, kind: 'SCAN' as const, detail: 'LIBRARY', plan: 'solo' as const, door: 'PORTAL' as const, entityKey: randomUUID() });

describe('POST /jobs/v1/usage/prune (Cloud Scheduler)', () => {
  it('needs the job token', async () => {
    const h = harness();
    expect((await h.app.request('/jobs/v1/usage/prune', { method: 'POST' })).status).toBe(401);
  });

  it('deletes events past 13 months, counters past 25 and route rows past 90 days; a second run deletes nothing', async () => {
    const h = harness();
    for (const month of ['2025-10', '2025-11', '2024-10', '2024-11']) await h.store.usage.record(event(month), null);
    const buckets = Array.from({ length: 12 }, () => 0);
    await h.store.usage.addRouteUsage([
      { day: '2026-08-27', routeKey: 'GET /v1/me', plan: 'solo', statusClass: '2xx', count: 1, durationMsSum: 1, buckets },
      { day: '2026-08-28', routeKey: 'GET /v1/me', plan: 'solo', statusClass: '2xx', count: 1, durationMsSum: 1, buckets },
    ]);
    const run = () => h.app.request('/jobs/v1/usage/prune', { method: 'POST', headers: { 'x-job-token': JOB_TOKEN } });
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: { events: 3, counters: 1, routes: 1 },
      before: { eventsMonth: '2025-11', countersMonth: '2024-11', routesDay: '2026-08-28' },
      retention: { eventMonths: 13, counterMonths: 25, routeDays: 90 },
    });
    expect(h.store.usage.allEvents().map((e) => e.month)).toEqual(['2025-11']);
    expect(((await (await run()).json()) as { deleted: unknown }).deleted).toEqual({ events: 0, counters: 0, routes: 0 });
  });
});
