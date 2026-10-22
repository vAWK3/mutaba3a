import { HTTPException } from 'hono/http-exception';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApiShell } from '../app-shell.js';
import { createApp } from '../app.js';
import { ApiError, type ErrorCode } from '../errors.js';
import type { ErrorContext, ErrorReporter } from '../observability/reporter.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore, UniqueViolation } from '../repositories/memory.js';

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';

/** Keeps what the API shell reports. */
type Report = { error: unknown; context: ErrorContext | undefined };

function recordingReporter(): ErrorReporter & { reports: Report[] } {
  const reports: Report[] = [];
  return { enabled: true, reports, captureException: (error, context) => void reports.push({ error, context }), flush: async () => true };
}

/** The API shell with one route that throws whatever the test hands it. */
function shellThrowing(error: unknown) {
  const reporter = recordingReporter();
  const { app } = createApiShell({ now: () => new Date('2026-10-22T08:00:00Z'), logger: pino({ level: 'silent' }), reporter });
  app.get('/v1/things/:thingId', () => {
    throw error;
  });
  return { app, reporter };
}

describe('the API shell reports what it logs as an error (MUT-148, AC2)', () => {
  it('reports an unknown error with the request id and the route template, and still answers 500 INTERNAL', async () => {
    const failure = new Error('insert failed');
    const { app, reporter } = shellThrowing(failure);
    const res = await app.request('/v1/things/th_1', { headers: { 'x-request-id': 'req_91c2' } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Unexpected server error', requestId: 'req_91c2' } });
    expect(reporter.reports).toEqual([{ error: failure, context: { requestId: 'req_91c2', route: '/v1/things/:thingId' } }]);
  });

  it.each<ErrorCode>(['INTERNAL', 'RECONCILE_FAILED', 'ATTACHMENTS_NOT_CONFIGURED'])('reports an ApiError %s (status 500 or higher)', async (code) => {
    const { app, reporter } = shellThrowing(new ApiError(code, 'failed'));
    const res = await app.request('/v1/things/th_1');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(reporter.reports).toHaveLength(1);
  });

  it.each<ErrorCode>(['INVALID_SIGNATURE', 'UNAUTHENTICATED', 'INSUFFICIENT_SCOPE', 'NOT_FOUND', 'CONFLICT', 'SETUP_LINK_UNUSABLE', 'VALIDATION_FAILED', 'RATE_LIMITED'])(
    'never reports an ApiError %s (below 500)',
    async (code) => {
    const { app, reporter } = shellThrowing(new ApiError(code, 'no'));
    const res = await app.request('/v1/things/th_1');
    expect(res.status).toBeLessThan(500);
    expect(reporter.reports).toEqual([]);
    },
  );

  it('never reports an unparseable body (the validator throws a 400, answered as 422 VALIDATION_FAILED)', async () => {
    const { app, reporter } = shellThrowing(new HTTPException(400, { message: 'Malformed JSON in request body' }));
    expect((await app.request('/v1/things/th_1')).status).toBe(422);
    expect(reporter.reports).toEqual([]);
  });

  it('sends nothing when the shell is built without a reporter (the portal local mode)', async () => {
    const { app } = createApiShell({ now: () => new Date(), logger: pino({ level: 'silent' }) });
    app.get('/boom', () => {
      throw new Error('x');
    });
    expect((await app.request('/boom')).status).toBe(500);
  });
});

/** A store whose organization insert fails the way the test says. */
function appWithFailingInsert(failure: unknown, reporter = recordingReporter()) {
  const store = new MemoryLedgerStore();
  store.organizations.create = async () => {
    throw failure;
  };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    reporter,
  });
  return { app, reporter };
}

const createOrganization = (app: ReturnType<typeof createApp>, headers: Record<string, string> = { 'x-admin-token': ADMIN_TOKEN }) =>
  app.request('/admin/v1/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ name: 'Acme Legal', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }),
  });

describe('createApp passes its reporter to the shell', () => {
  it('reports a store failure behind a real route', async () => {
    const { app, reporter } = appWithFailingInsert(new Error('connection reset'));
    expect((await createOrganization(app)).status).toBe(500);
    expect(reporter.reports).toHaveLength(1);
    expect(reporter.reports[0]?.context?.route).toBe('/admin/v1/organizations');
  });

  it('reports nothing for a conflict, a missing admin token or a bad body', async () => {
    const { app, reporter } = appWithFailingInsert(new UniqueViolation('slug'));
    expect((await createOrganization(app)).status).toBe(409);
    expect((await createOrganization(app, {})).status).toBe(401);
    const badBody = await app.request('/admin/v1/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({}),
    });
    expect(badBody.status).toBe(422);
    expect(reporter.reports).toEqual([]);
  });

  it('says on /health whether error reporting is on, and nothing else about it (D4)', async () => {
    const on = appWithFailingInsert(new Error('x')).app;
    const off = appWithFailingInsert(new Error('x'), { ...recordingReporter(), enabled: false }).app;
    expect(await (await on.request('/health')).json()).toMatchObject({ status: 'ok', errorReporting: 'on' });
    expect(await (await off.request('/health')).json()).toMatchObject({ errorReporting: 'off' });
  });
});
