import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { lazyPostingOf, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { todayFor } from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { HOSTED_EXPORT_ORIGIN, recordsFileChunks } from '../records-file/codec.js';
import { profileExportPages } from '../records-file/export.js';
import { CURRENT_STORE_SNAPSHOT_VERSION } from '../repositories/memory.js';
import type { LedgerStore } from '../repositories/ports.js';
import { errorResponses, notFoundResponse, validationResponse } from './shared.js';

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const ReceiptIdParamSchema = z.object({ receiptId: z.string().uuid().openapi({ param: { name: 'receiptId', in: 'path' } }) });
const RecordsFileSchema = z
  .object({
    kind: z.literal('mutaba3a-local-records'),
    formatVersion: z.number().int(),
    savedAt: z.string().datetime(),
    origin: z.literal(HOSTED_EXPORT_ORIGIN),
    maps: z.record(z.string(), z.unknown()),
  })
  .openapi('RecordsFile');

export interface RecordsExportOptions {
  /** Null in deployments without a bucket: the receipt route answers 503, like every receipt route. */
  storage: AttachmentStorage | null;
  logger: Pick<Logger, 'error'>;
}

/**
 * MUT-325 (ADR-155): "Download my records", signed in. The profile's records
 * as the portal's local mode holds them — the same file its own Download
 * writes — streamed a page of rows at a time, and each receipt's bytes for the
 * portal to put beside it in the zip. Signed-in only, outside `PORTAL_ROUTES`:
 * local mode has its own Download and never serves these.
 */
export function recordsExportRoutes(store: LedgerStore, options: RecordsExportOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/records-export',
      tags: ['Your data'],
      summary: "The profile's records file",
      description:
        'Everything on the profile named by X-Mutaba3a-Profile, as the records file the signed-out portal restores (kind mutaba3a-local-records, origin hosted-export): every row as stored, the caller as the one person, without Malafat\'s connection or documents. Due items are posted first. Streamed; gzip when accepted. Receipt files come from GET /v1/records-export/receipts/{receiptId}. Audited as records.exported.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'The records file', content: { 'application/json': { schema: RecordsFileSchema } } }, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const membership = await store.memberships.find(user.id, organization.id);
      if (!membership) throw new ApiError('NOT_FOUND', 'Profile not found');
      const now = c.get('now')();
      // ADR-037 decision 8: the file holds what any read would show, so a device never posts the same item again.
      const posting = lazyPostingOf(c, store);
      await postDueItems(posting.store, organization, todayFor(organization, now), now, posting.actor);
      await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'records.exported', entityType: 'organization', entityId: organization.id, metadata: { formatVersion: CURRENT_STORE_SNAPSHOT_VERSION }, requestId: c.get('requestId') });

      const chunks = recordsFileChunks({ formatVersion: CURRENT_STORE_SNAPSHOT_VERSION, savedAt: now, origin: HOSTED_EXPORT_ORIGIN }, profileExportPages(store, { person: user, organization, membership }));
      const body = streamOf(chunks, (error) => options.logger.error({ err: error, requestId: c.get('requestId') }, 'records export failed mid-stream'));
      return respond(c, body, { 'Content-Type': 'application/json; charset=utf-8' });
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/records-export/receipts/{receiptId}',
      tags: ['Your data'],
      summary: "A receipt's file, for the records file",
      description: "The bytes of a READY receipt on the profile, as a download (ADR-028: never rendered in place). 404 for anything else. The one route that passes bytes on: the portal can't fetch the bucket itself.",
      security: SESSION_ONLY,
      request: { params: ReceiptIdParamSchema },
      responses: { 200: { description: 'The file', content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      if (!options.storage) throw new ApiError('ATTACHMENTS_NOT_CONFIGURED', 'Attachments are not configured on this deployment (ATTACHMENTS_BUCKET)');
      const { organization } = sessionAuth(c);
      const receipt = await store.recordsExport.findExportableReceipt(organization.id, c.req.valid('param').receiptId);
      const bytes = receipt ? await options.storage.read(receipt.storageKey) : null;
      if (!bytes) throw new ApiError('NOT_FOUND', 'No such receipt');
      return respond(c, bytes, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff' }, false);
    },
  );

  return app;
}

/**
 * A pulled stream over the file's chunks: the next page is read only when the reader wants more. A failure partway
 * errors the stream, so the response is cut off rather than ended as if whole (the request was logged 200 already;
 * this logs the failure), and the portal refuses the truncated file.
 */
function streamOf(chunks: AsyncGenerator<string>, onError: (error: unknown) => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        onError(error);
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

/** Gzipped when the browser accepts it (a records file is repetitive JSON); receipts are already compressed. */
function respond(c: Context<AppEnv>, body: ReadableStream<Uint8Array>, headers: Record<string, string>, compress = true) {
  const gzip = compress && /\bgzip\b/.test(c.req.header('accept-encoding') ?? '');
  const out = gzip ? body.pipeThrough(new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>) : body;
  for (const [name, value] of Object.entries({ ...headers, ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) })) c.header(name, value);
  return c.body(out, 200) as never;
}
