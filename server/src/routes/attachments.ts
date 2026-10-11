import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { keyAuth, requireScope, type AppEnv } from '../auth/middleware.js';
import { validationError } from '../agreements/compose.js';
import { checkUpload, storageKey } from '../attachments/rules.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import { AttachmentDownloadSchema, AttachmentIdParamSchema, AttachmentPageSchema, AttachmentSchema, CreateUploadRequestSchema, CreateUploadResponseSchema, ErrorEnvelopeSchema, ListAttachmentsQuerySchema } from '../schemas.js';
import { serializeAttachment } from '../serializers.js';
import { encodeNextCursor, errorResponses, notFoundResponse, toPageRequest, validationResponse } from './shared.js';

export interface AttachmentOptions {
  /** Absent in deployments without a bucket: every route answers 503 ATTACHMENTS_NOT_CONFIGURED. */
  storage: AttachmentStorage | null;
  urlTtlSeconds: number;
}

/** /v1/attachments — invoices, receipts and other files behind signed URLs (M6 brief §2, §4). */
export function attachmentRoutes(store: LedgerStore, options: AttachmentOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  const notConfigured = { 503: { description: 'No attachments bucket is configured for this deployment', content: { 'application/json': { schema: ErrorEnvelopeSchema } } } } as const;

  function storage(): AttachmentStorage {
    if (!options.storage) throw new ApiError('ATTACHMENTS_NOT_CONFIGURED', 'Attachments are not configured on this deployment (ATTACHMENTS_BUCKET)');
    return options.storage;
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/attachments/uploads',
      tags: ['Attachments'],
      summary: 'Start an upload: a PENDING_UPLOAD attachment and a short-lived signed PUT URL',
      description: 'PDF, JPEG or PNG up to 10 MB, linked to exactly one of customerId, projectId, paymentId. PUT the bytes to upload.url with upload.headers, then POST /v1/attachments/{id}/complete. The object key never contains the filename.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('attachments:write')] as const,
      request: { body: { required: true, content: { 'application/json': { schema: CreateUploadRequestSchema } } } },
      responses: { 201: { description: 'Upload started', content: { 'application/json': { schema: CreateUploadResponseSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const check = checkUpload(body);
      if (!check.ok) throw validationError(check.reason, `Upload refused: ${check.reason}`);
      await assertTarget(organization.id, check.target);
      const created = await store.attachments.create(
        { organizationId: organization.id, kind: body.kind, filename: body.filename, mimeType: body.mimeType, sizeBytes: body.sizeBytes, customerId: body.customerId ?? null, projectId: body.projectId ?? null, paymentId: body.paymentId ?? null, invoiceNumber: body.invoiceNumber ?? null, invoiceDate: body.invoiceDate ?? null, uploadedByKeyId: apiKey.id, requestId: c.get('requestId') },
        now,
      );
      const keyed = (await store.attachments.setKey(organization.id, created.id, storageKey(organization.id, created.id))) ?? created;
      const upload = await s.signUpload(keyed.storageKey, { mimeType: body.mimeType, sizeBytes: body.sizeBytes, ttlSeconds: options.urlTtlSeconds, now });
      return c.json({ attachment: serializeAttachment(keyed), upload: { url: upload.url, method: 'PUT' as const, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() } }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/attachments/{attachmentId}/complete',
      tags: ['Attachments'],
      summary: 'Finish an upload: verify the object and mark the attachment READY',
      description: '422 UPLOAD_INCOMPLETE when no object exists yet; 422 UPLOAD_MISMATCH when its size or content type differ from what was declared. Idempotent once READY.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('attachments:write')] as const,
      request: { params: AttachmentIdParamSchema },
      responses: { 200: { description: 'READY', content: { 'application/json': { schema: AttachmentSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization, apiKey } = keyAuth(c);
      const now = c.get('now')();
      const attachment = await store.attachments.getById(organization.id, c.req.valid('param').attachmentId);
      if (!attachment) throw new ApiError('NOT_FOUND', 'No such attachment');
      if (attachment.status === 'READY') return c.json(serializeAttachment(attachment), 200);
      const object = await s.head(attachment.storageKey);
      if (!object) throw validationError('UPLOAD_INCOMPLETE', 'No object has been uploaded for this attachment yet');
      if (object.sizeBytes !== attachment.sizeBytes || (object.contentType && object.contentType !== attachment.mimeType)) {
        throw validationError('UPLOAD_MISMATCH', 'The uploaded object does not match the declared size or type', { declared: { sizeBytes: attachment.sizeBytes, mimeType: attachment.mimeType }, uploaded: object });
      }
      const ready = await store.attachments.complete(organization.id, attachment.id, now);
      if (!ready) throw new ApiError('NOT_FOUND', 'No such attachment');
      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'attachment.uploaded', entityType: 'attachment', entityId: ready.id, metadata: { kind: ready.kind, filename: ready.filename, sizeBytes: ready.sizeBytes, customerId: ready.customerId, projectId: ready.projectId, paymentId: ready.paymentId }, requestId: c.get('requestId') });
      return c.json(serializeAttachment(ready), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/attachments',
      tags: ['Attachments'],
      summary: 'List READY attachments of a customer, project or payment',
      security: [{ apiKey: [] }, { session: [] }],
      middleware: [requireScope('attachments:read')] as const,
      request: { query: ListAttachmentsQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: AttachmentPageSchema } } }, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      storage();
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const page = await store.attachments.list(organization.id, { ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.paymentId ? { paymentId: q.paymentId } : {}), ...(q.kind ? { kind: q.kind } : {}) }, toPageRequest(q));
      return c.json({ items: page.items.map(serializeAttachment), nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/attachments/{attachmentId}/download',
      tags: ['Attachments'],
      summary: 'A short-lived signed download URL for a READY attachment',
      security: [{ apiKey: [] }, { session: [] }],
      middleware: [requireScope('attachments:read')] as const,
      request: { params: AttachmentIdParamSchema },
      responses: { 200: { description: 'Signed URL', content: { 'application/json': { schema: AttachmentDownloadSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization } = c.get('auth');
      const now = c.get('now')();
      const attachment = await store.attachments.getById(organization.id, c.req.valid('param').attachmentId);
      if (!attachment) throw new ApiError('NOT_FOUND', 'No such attachment');
      if (attachment.status !== 'READY') throw validationError('ATTACHMENT_NOT_READY', 'The upload has not been completed');
      const signed = await s.signDownload(attachment.storageKey, { filename: attachment.filename, mimeType: attachment.mimeType, ttlSeconds: options.urlTtlSeconds, now });
      return c.json({ url: signed.url, expiresAt: signed.expiresAt.toISOString(), filename: attachment.filename, mimeType: attachment.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png' }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/attachments/{attachmentId}',
      tags: ['Attachments'],
      summary: 'Delete an attachment (soft delete; the object is removed)',
      security: [{ apiKey: [] }],
      middleware: [requireScope('attachments:write')] as const,
      request: { params: AttachmentIdParamSchema },
      responses: { 204: { description: 'Deleted (or already was)' }, ...notFoundResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization, apiKey } = keyAuth(c);
      const now = c.get('now')();
      const attachment = await store.attachments.getById(organization.id, c.req.valid('param').attachmentId);
      if (!attachment) {
        // Already deleted (soft) or never existed: idempotent for a known id, 404 otherwise.
        const gone = await store.attachments.softDelete(organization.id, c.req.valid('param').attachmentId, now);
        if (!gone) throw new ApiError('NOT_FOUND', 'No such attachment');
        return c.body(null, 204);
      }
      await store.attachments.softDelete(organization.id, attachment.id, now);
      await s.remove(attachment.storageKey);
      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'attachment.deleted', entityType: 'attachment', entityId: attachment.id, metadata: { kind: attachment.kind, filename: attachment.filename }, requestId: c.get('requestId') });
      return c.body(null, 204);
    },
  );

  /** The entity an attachment hangs on must exist in this organization (404 otherwise, like every entity route). */
  async function assertTarget(organizationId: string, target: { customerId: string } | { projectId: string } | { paymentId: string }): Promise<void> {
    if ('customerId' in target) {
      if (!(await store.customers.getById(organizationId, target.customerId))) throw new ApiError('NOT_FOUND', 'No such customer');
    } else if ('projectId' in target) {
      if (!(await store.projects.getById(organizationId, target.projectId))) throw new ApiError('NOT_FOUND', 'No such project');
    } else if (!(await store.payments.getById(organizationId, target.paymentId))) {
      throw new ApiError('NOT_FOUND', 'No such payment');
    }
  }

  return app;
}
