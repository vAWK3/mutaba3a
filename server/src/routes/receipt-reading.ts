import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { RECEIPT_READ_JOB_PATH } from '../receipts/reading/cloud-tasks.js';
import type { ReadJobVerifier } from '../receipts/reading/oidc.js';
import type { ReceiptReader } from '../receipts/reading/reader.js';
import { ErrorEnvelopeSchema } from '../schemas.js';

/**
 * MUT-441 (R-D2, R8): the one read job.
 *
 *   POST /jobs/v1/receipts/read  {receiptId}   Cloud Tasks: read that receipt now
 *   POST /jobs/v1/receipts/read  (no body)     Cloud Scheduler, every 5 min: ask again for PENDING receipts whose
 *                                              lease is free, and give up (FAILED `exhausted`) on the ones past
 *                                              3 attempts or 30 minutes. It never reads itself (R10 #7).
 *
 * Only a Google-signed OIDC token for the queue's or the Scheduler's service account opens it; the shared X-Job-Token
 * does not (app.ts keeps jobAuth off this one path). Every end state answers 200, so Cloud Tasks stops; only a read
 * worth retrying (the OCR service timed out or is down) answers 503 (R10 #10). Logs carry codes and counts, never text.
 */
export interface ReceiptReadRouteOptions {
  /** Null: SERVER_OCR is off; an authenticated call answers 200 `off`, so a leftover task stops. */
  reader: ReceiptReader | null;
  /** Null: no audience or invoker is configured; the route answers 503 JOBS_NOT_CONFIGURED. */
  verifier: ReadJobVerifier | null;
}

const ReadJobRequestSchema = z.object({ receiptId: z.string().uuid() }).openapi('ReceiptReadJobRequest');
const ReadJobResultSchema = z
  .object({
    status: z.enum(['done', 'skipped', 'failed', 'busy', 'none', 'retry', 'off', 'swept']).openapi({
      description:
        'done: read, and the fields it found fill the suggestion\'s empty ones. skipped: nothing to read for (filed, deleted, every field present, no grant). ' +
        'failed: given up (unreadable, or exhausted). busy: another read holds it. none: not waiting to be read. retry (503): try again. ' +
        'off: SERVER_OCR is off. swept: the no-body sweep ran.',
    }),
    enqueued: z.number().int().optional(),
    failed: z.number().int().optional(),
    enqueueErrors: z.number().int().optional(),
  })
  .openapi('ReceiptReadJobResult');

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

function oidcAuth(verifier: ReadJobVerifier | null): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!verifier) throw new ApiError('JOBS_NOT_CONFIGURED', 'The receipt read job is not configured on this server');
    if (!(await verifier.verify(c.req.header('authorization')))) throw new ApiError('JOB_UNAUTHORIZED', 'Missing or invalid Google OIDC token');
    await next();
  };
}

export function receiptReadingRoutes(options: ReceiptReadRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  app.use(RECEIPT_READ_JOB_PATH, oidcAuth(options.verifier));

  app.openapi(
    createRoute({
      method: 'post',
      path: RECEIPT_READ_JOB_PATH,
      tags: ['Receipts'],
      summary: 'Read one receipt (Cloud Tasks), or sweep the waiting ones (Cloud Scheduler) (MUT-441)',
      description:
        'With `{receiptId}`: claim the receipt for 90 s, read its file on our own OCR service, and fill the suggestion\'s empty fields. ' +
        'With no body: ask again for every waiting receipt whose claim lapsed, and give up on those past 3 tries or 30 minutes. ' +
        'Google OIDC only (the queue\'s and the Scheduler\'s service accounts); the X-Job-Token does not open it.',
      security: [{ googleOidc: [] }],
      request: { body: { required: false, content: { 'application/json': { schema: ReadJobRequestSchema } } } },
      responses: {
        200: { description: 'An end state (or the sweep ran)', content: { 'application/json': { schema: ReadJobResultSchema } } },
        401: errorResponse('JOB_UNAUTHORIZED'),
        422: errorResponse('VALIDATION_FAILED'),
        503: { description: 'retry: the OCR service timed out or is unavailable; or JOBS_NOT_CONFIGURED', content: { 'application/json': { schema: ReadJobResultSchema.or(ErrorEnvelopeSchema) } } },
      },
    }),
    async (c) => {
      const raw = (await c.req.text()).trim();
      if (!options.reader) return c.json({ status: 'off' as const }, 200);
      if (raw === '') return c.json({ status: 'swept' as const, ...(await options.reader.sweep()) }, 200);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ApiError('VALIDATION_FAILED', 'The body must be {"receiptId": "<uuid>"} or empty');
      }
      const body = ReadJobRequestSchema.safeParse(parsed);
      if (!body.success) throw new ApiError('VALIDATION_FAILED', 'The body must be {"receiptId": "<uuid>"} or empty');
      const status = await options.reader.readOne(body.data.receiptId);
      return status === 'retry' ? c.json({ status }, 503) : c.json({ status }, 200);
    },
  );

  return app;
}
