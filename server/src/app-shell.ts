import { randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './auth/middleware.js';
import { ApiError } from './errors.js';
import type { Logger } from './logger.js';
import { NOOP_REPORTER, type ErrorReporter } from './observability/reporter.js';
import { SENTRY_RULES } from './observability/sentry-rules.js';

export interface ApiShellDependencies {
  /** Injectable clock so tests can control expiry and rate windows. */
  now: () => Date;
  logger: Logger;
  /** MUT-148: where errors logged as errors are also reported. Absent = none (the portal's local mode, ADR-024). */
  reporter?: ErrorReporter;
  /** MUT-361: whether the lapse gate is enforced (billing/gate.ts). Absent = off (tests, the portal's local mode). */
  billingGate?: boolean;
}

/**
 * The request-id/validation/error-handling skeleton every `OpenAPIHono<AppEnv>`
 * needs, independent of how it is transported (Node HTTP for `createApp`,
 * an in-page `fetch`-shaped call for the portal's local mode). Carries no
 * context-storage, CSP/no-store headers or access logging — those are
 * `createApp`'s own concerns (MUT-286 Phase A item 1; lifted verbatim from
 * `app.ts`'s former inline definitions, net zero behavior change).
 */
export function createApiShell(deps: ApiShellDependencies): { app: OpenAPIHono<AppEnv> } {
  const { now, logger } = deps;
  const reporter = deps.reporter ?? NOOP_REPORTER;

  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const err = new ApiError('VALIDATION_FAILED', 'Request validation failed', result.error.issues);
        return c.json(err.toEnvelope(c.get('requestId')), err.status);
      }
      return undefined;
    },
  });

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.set('now', now);
    c.set('billingGate', deps.billingGate ?? false);
    await next();
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    // ADR-091: reported exactly where it is logged as an error; `routePath` is the template, never the raw path.
    const report = () => reporter.captureException(err, { requestId, route: c.req.routePath });
    if (err instanceof ApiError) {
      if (err.status >= SENTRY_RULES.serverReportsStatusAtLeast) {
        logger.error({ requestId, err }, err.message);
        report();
      }
      return c.json(err.toEnvelope(requestId), err.status);
    }
    // TD-148 (MUT-235 review): Hono's validator throws a 400 HTTPException for an unparseable body (e.g. a JSON
    // content type with no body). That is the client's input, so it is a validation failure, never a 500.
    if (err instanceof HTTPException && err.status === 400) {
      const invalid = new ApiError('VALIDATION_FAILED', err.message || 'Request body could not be parsed');
      return c.json(invalid.toEnvelope(requestId), invalid.status);
    }
    logger.error({ requestId, err }, 'unhandled error');
    report();
    const internal = new ApiError('INTERNAL', 'Unexpected server error');
    return c.json(internal.toEnvelope(requestId), internal.status);
  });

  app.notFound((c) => {
    const err = new ApiError('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`);
    return c.json(err.toEnvelope(c.get('requestId')), err.status);
  });

  return { app };
}
