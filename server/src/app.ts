import { randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ApiKeyEnvironment } from './auth/api-key.js';
import { apiKeyAuth, type AppEnv } from './auth/middleware.js';
import { SCOPES } from './auth/scopes.js';
import { ApiError, ERROR_CODES } from './errors.js';
import type { Logger } from './logger.js';
import type { RateLimiter } from './rate-limit.js';
import type { LedgerStore } from './repositories/ports.js';
import { adminAuth, adminRoutes } from './routes/admin.js';
import { agreementRoutes } from './routes/agreements.js';
import { customerRoutes } from './routes/customers.js';
import { installmentRoutes } from './routes/installments.js';
import { receivableRoutes } from './routes/receivables.js';
import { retainerRoutes } from './routes/retainers.js';
import { vatRoutes } from './routes/vat.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/import.js';
import { integrationRoutes } from './routes/integration.js';
import { projectRoutes } from './routes/projects.js';
import { CONFLICT_REASONS, VALIDATION_REASONS } from './schemas.js';

export interface AppDependencies {
  store: LedgerStore;
  logger: Logger;
  rateLimiter: RateLimiter;
  adminToken: string;
  keyEnvironment: ApiKeyEnvironment;
  version: string;
  /** Injectable clock so tests can control expiry and rate windows. */
  now?: () => Date;
}

export const API_TITLE = 'Mutaba3a Financial API';
export const API_VERSION = '1.2.0-m3';

/**
 * Composes the HTTP application. No I/O happens here; everything it needs is
 * injected, which is what lets the route tests run against MemoryLedgerStore
 * and the contract tests against Postgres with the same app.
 */
export function createApp(deps: AppDependencies): OpenAPIHono<AppEnv> {
  const now = deps.now ?? (() => new Date());

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
    c.header('X-Request-Id', requestId);
    c.header('Cache-Control', 'no-store');
    const started = Date.now();
    await next();
    deps.logger.info(
      { requestId, method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - started },
      'request',
    );
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    if (err instanceof ApiError) {
      if (err.status >= 500) deps.logger.error({ requestId, err }, err.message);
      return c.json(err.toEnvelope(requestId), err.status);
    }
    deps.logger.error({ requestId, err }, 'unhandled error');
    const internal = new ApiError('INTERNAL', 'Unexpected server error');
    return c.json(internal.toEnvelope(requestId), internal.status);
  });

  app.notFound((c) => {
    const err = new ApiError('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`);
    return c.json(err.toEnvelope(c.get('requestId')), err.status);
  });

  app.use('/v1/*', apiKeyAuth({ store: deps.store, environment: deps.keyEnvironment, rateLimiter: deps.rateLimiter }));
  app.use('/admin/*', adminAuth(deps.adminToken));

  app.route('/', healthRoutes(deps.store, deps.version));
  app.route('/', integrationRoutes(deps.store, deps.version));
  app.route('/', customerRoutes(deps.store));
  app.route('/', projectRoutes(deps.store));
  app.route('/', importRoutes(deps.store));
  app.route('/', vatRoutes(deps.store));
  app.route('/', agreementRoutes(deps.store));
  app.route('/', installmentRoutes(deps.store));
  app.route('/', retainerRoutes(deps.store));
  app.route('/', receivableRoutes(deps.store));
  app.route('/', adminRoutes({ store: deps.store, adminToken: deps.adminToken, keyEnvironment: deps.keyEnvironment }));

  app.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'Organization API key: `Authorization: Bearer mut_live_<prefix>_<secret>`',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'adminToken', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Admin-Token',
    description: 'Operator token (MUTABA3A_ADMIN_TOKEN). Provisioning only.',
  });

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: API_TITLE,
      version: API_VERSION,
      description: [
        'Organization-scoped financial ledger API (MUT/MAL Money v1, Milestones 1–3).',
        '',
        `Scopes: ${SCOPES.join(', ')}.`,
        '',
        `Error codes: ${Object.keys(ERROR_CODES).join(', ')}. Every error is {"error":{"code","message","details?","requestId"}}.`,
        '',
        'Financial writes require an `Idempotency-Key` header (8–128 chars). Same key + same body replays the stored outcome; same key + different body is rejected with IDEMPOTENCY_KEY_REUSED.',
        '',
        'PATCH routes require `If-Match: <version>` (optimistic concurrency).',
        '',
        `409 CONFLICT responses carry details.reason, one of: ${CONFLICT_REASONS.join(', ')}.`,
        '',
        `422 VALIDATION_FAILED responses raised by business rules carry details.reason, one of: ${VALIDATION_REASONS.join(', ')} (schema failures carry the zod issues in details instead).`,
        '',
        'Amounts are canonical decimal strings in the project currency; dates are YYYY-MM-DD in the organization timezone. VAT rates are basis points (1800 = 18 %).',
        '',
        'Lists paginate with ?limit= (1–200, default 50) and an opaque ?cursor= from the previous page\'s nextCursor.',
      ].join('\n'),
    },
    tags: [
      { name: 'Operations', description: 'Liveness and readiness' },
      { name: 'Integration', description: 'Credential validation and tenant binding' },
      { name: 'Customers', description: 'The parties money is owed by' },
      { name: 'Projects', description: 'Single-currency containers for agreements, receivables and payments' },
      { name: 'Import', description: 'Batch linking of an external system\'s customers and projects' },
      { name: 'VAT', description: 'The firm\'s effective-dated standard rate' },
      { name: 'Agreements', description: 'Fixed-fee agreements, installments, supplements' },
      { name: 'Installments', description: 'Manual triggers' },
      { name: 'Retainers', description: 'Recurring agreements and their monthly charges' },
      { name: 'Receivables', description: 'What is owed' },
      { name: 'Admin', description: 'Operator provisioning' },
    ],
  });

  return app;
}
