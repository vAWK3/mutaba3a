import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { randomUUID } from 'node:crypto';
import type { AppEnv } from '../auth/middleware.js';
import { requireScope, sessionAuth } from '../auth/middleware.js';
import { MAX_ATTACHMENT_BYTES, storageKey } from '../attachments/rules.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import { ApiError } from '../errors.js';
import { readExternalInvoice } from '../issuing/external-reading.js';
import type { OcrClient } from '../receipts/ocr-client.js';
import { serverReaderVersion } from '../receipts/reading/reader.js';
import type { AttachmentRecord, ExternalInvoiceRecord, JsonObject, LedgerStore, Organization } from '../repositories/ports.js';
import {
  AttachExternalInvoiceQuerySchema,
  ErrorEnvelopeSchema,
  ExternalInvoiceFileSchema,
  ExternalInvoiceIdParamSchema,
  ExternalInvoiceListQuerySchema,
  ExternalInvoiceListSchema,
  ExternalInvoiceReadingSchema,
  ExternalInvoiceSchema,
} from '../schemas.js';
import { PERSON_OR_MALAFAT } from './security.js';
import { conflictResponse, errorResponses, notFoundResponse, validationResponse } from './shared.js';

/**
 * MUT-647 (Basel, X1-a): an invoice issued elsewhere, attached to the Owed or Received it belongs to. The person sends
 * the file (a PDF or a photo) and confirms its number and date; the server keeps it as an INVOICE attachment of the
 * entry, never numbers it and never puts it in the uniform file. Issuing a MTB3A document for that entry is refused
 * while it is attached (409 EXTERNAL_INVOICE_ATTACHED, in routes/issuing.ts). Session only, on a profile with issuing.
 */
export interface ExternalInvoiceRouteDeps {
  store: LedgerStore;
  storage: AttachmentStorage | null;
  ocr: OcrClient | null;
  urlTtlSeconds: number;
  issuingProfile: (c: Context<AppEnv>, write: boolean) => Promise<Organization>;
  audit: (c: Context<AppEnv>, action: string, entityType: string, entityId: string, metadata?: JsonObject) => Promise<unknown>;
}

const json = <T>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } });
const errorOf = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const FILE_BODY = { required: true as const, content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) }, 'image/jpeg': { schema: z.string().openapi({ format: 'binary' }) }, 'image/png': { schema: z.string().openapi({ format: 'binary' }) } } };

/** A PDF, JPEG or PNG by its own first bytes (never the header's word). */
export function invoiceFileType(bytes: Uint8Array): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return 'application/pdf';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  return null;
}

export function registerExternalInvoiceRoutes(app: OpenAPIHono<AppEnv>, deps: ExternalInvoiceRouteDeps): void {
  const { store } = deps;
  const storage = (): AttachmentStorage => {
    if (!deps.storage) throw new ApiError('ATTACHMENTS_NOT_CONFIGURED', 'Files are not configured on this deployment');
    return deps.storage;
  };

  for (const path of ['/v1/issuing/external-invoices', '/v1/issuing/external-invoices/read']) {
    app.use(
      path,
      bodyLimit({
        maxSize: MAX_ATTACHMENT_BYTES,
        onError: (c) => {
          const err = new ApiError('PAYLOAD_TOO_LARGE', `An invoice file is at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
          return c.json(err.toEnvelope(c.get('requestId')), err.status);
        },
      }),
    );
  }

  async function fileOf(c: Context<AppEnv>): Promise<{ bytes: Uint8Array; mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' }> {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', 'The file is too large');
    const mimeType = invoiceFileType(bytes);
    if (!mimeType) throw new ApiError('VALIDATION_FAILED', 'An invoice file is a PDF, a JPEG or a PNG', { field: 'body', reason: 'INVOICE_FILE_TYPE' });
    return { bytes, mimeType };
  }

  /** The entry, its customer and whether MTB3A issued its document. */
  async function entryOf(organizationId: string, kind: 'OWED' | 'RECEIVED', id: string) {
    if (kind === 'OWED') {
      const owed = await store.receivables.getById(organizationId, id);
      if (!owed) throw new ApiError('NOT_FOUND', 'No such Owed', { field: 'entryId' });
      return { customerId: owed.customerId, issuedHere: owed.origin === 'ISSUED_DOCUMENT' };
    }
    const received = await store.payments.getById(organizationId, id);
    if (!received) throw new ApiError('NOT_FOUND', 'No such Received', { field: 'entryId' });
    return { customerId: received.customerId, issuedHere: false };
  }

  const serialize = (x: ExternalInvoiceRecord, file: Pick<AttachmentRecord, 'filename' | 'mimeType'>) => ({
    id: x.id,
    entryKind: x.entryKind,
    entryId: x.entryId,
    number: x.number,
    documentDate: x.documentDate,
    attachmentId: x.attachmentId,
    filename: file.filename,
    mimeType: file.mimeType,
    createdAt: x.createdAt.toISOString(),
  });

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/issuing/external-invoices/read',
      tags: ['Issuing'],
      summary: 'Read an invoice issued elsewhere before attaching it',
      description: 'MUT-647: the raw PDF or photo (at most 10 MB). Answers what the reader found (number, date, total); nothing is stored. With no reader configured, or a file it can’t read, `read` is false and the person types the fields.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      request: { body: FILE_BODY },
      responses: { 200: json('What the invoice says', ExternalInvoiceReadingSchema), 413: errorOf('PAYLOAD_TOO_LARGE'), ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      await deps.issuingProfile(c, true);
      const { bytes, mimeType } = await fileOf(c);
      const nothing = { read: false, number: null, documentDate: null, amount: null };
      if (!deps.ocr) return c.json(nothing, 200);
      try {
        const result = await deps.ocr.read({ body: bytes, contentType: mimeType, hint: 'photo' });
        const reading = readExternalInvoice(result, { readerVersion: serverReaderVersion(result.engine) });
        return c.json({ read: true, ...reading }, 200);
      } catch {
        // A file the reader can't read, or a reader that's down: the person types the fields (never a failure).
        return c.json(nothing, 200);
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/issuing/external-invoices',
      tags: ['Issuing'],
      summary: 'Attach an invoice issued elsewhere to an Owed or a Received',
      description:
        'MUT-647: the raw PDF or photo (at most 10 MB) with its confirmed number and date in the query. Kept as an INVOICE attachment of the entry; never numbered by MTB3A. 409 EXTERNAL_INVOICE_EXISTS when the entry already has one (remove it first); 409 ISSUED_HERE for an Owed MTB3A issued the document for.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      request: { query: AttachExternalInvoiceQuerySchema, body: FILE_BODY },
      responses: { 201: json('Attached', ExternalInvoiceSchema), 413: errorOf('PAYLOAD_TOO_LARGE'), 503: errorOf('ATTACHMENTS_NOT_CONFIGURED'), ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await deps.issuingProfile(c, true);
      const files = storage();
      const q = c.req.valid('query');
      const { user } = sessionAuth(c);
      const now = c.get('now')();
      const entry = await entryOf(organization.id, q.entryKind, q.entryId);
      if (entry.issuedHere) throw new ApiError('CONFLICT', 'MTB3A issued this entry’s document; nothing else is attached to it', { reason: 'ISSUED_HERE' });
      const [live] = await store.issuing.liveExternal(organization.id, q.entryKind, [q.entryId]);
      if (live) throw new ApiError('CONFLICT', 'This entry already has an invoice attached; remove it first', { reason: 'EXTERNAL_INVOICE_EXISTS', externalInvoiceId: live.id });
      const { bytes, mimeType } = await fileOf(c);
      // The file first, under the attachment's own key; then its attachment row and the link, in one write.
      const attachmentId = randomUUID();
      const key = storageKey(organization.id, attachmentId);
      await files.write(key, bytes, mimeType);
      const result = await store.issuing.attachExternal(
        { organizationId: organization.id, entryKind: q.entryKind, entryId: q.entryId, attachmentId, number: q.number, documentDate: q.documentDate, createdByUserId: user.id, createdAt: now },
        // The attachment is linked to exactly one of customer or payment, like every attachment.
        { filename: q.filename, mimeType, sizeBytes: bytes.length, storageKey: key, customerId: q.entryKind === 'OWED' ? entry.customerId : null, paymentId: q.entryKind === 'RECEIVED' ? q.entryId : null, requestId: c.get('requestId') },
      );
      if (result.kind === 'exists') {
        // Lost a race with another attach: this file goes, the first stays.
        await files.remove(key);
        throw new ApiError('CONFLICT', 'This entry already has an invoice attached; remove it first', { reason: 'EXTERNAL_INVOICE_EXISTS', externalInvoiceId: result.record.id });
      }
      await deps.audit(c, 'external_invoice.attached', 'external_invoice', result.record.id, { entryKind: q.entryKind, entryId: q.entryId, number: q.number });
      return c.json(serialize(result.record, { filename: q.filename, mimeType }), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuing/external-invoices',
      tags: ['Issuing'],
      summary: 'The invoices issued elsewhere attached to these entries',
      description: 'MUT-647: one request for the page of Owed or Received on screen (at most 100 ids); entries without one are left out.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      request: { query: ExternalInvoiceListQuerySchema },
      responses: { 200: json('The attached invoices', ExternalInvoiceListSchema), ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await deps.issuingProfile(c, false);
      const q = c.req.valid('query');
      if (!q.entryKind || q.entryIds.length === 0) return c.json({ items: [] }, 200);
      const live = await store.issuing.liveExternal(organization.id, q.entryKind, q.entryIds);
      const items = await Promise.all(
        live.map(async (x) => {
          const file = await store.attachments.getById(organization.id, x.attachmentId);
          return serialize(x, file ?? { filename: 'invoice', mimeType: 'application/pdf' });
        }),
      );
      return c.json({ items }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuing/external-invoices/{externalInvoiceId}/file',
      tags: ['Issuing'],
      summary: 'Open an attached invoice’s file',
      description: 'MUT-647: a short-lived signed URL that shows the file inline.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      request: { params: ExternalInvoiceIdParamSchema },
      responses: { 200: json('The signed URL', ExternalInvoiceFileSchema), 503: errorOf('ATTACHMENTS_NOT_CONFIGURED'), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await deps.issuingProfile(c, false);
      const files = storage();
      const x = await store.issuing.getExternal(organization.id, c.req.valid('param').externalInvoiceId);
      const file = x ? await store.attachments.getById(organization.id, x.attachmentId) : null;
      if (!x || !file) throw new ApiError('NOT_FOUND', 'No such attached invoice');
      const signed = await files.signDownload(file.storageKey, { filename: file.filename, mimeType: file.mimeType, ttlSeconds: deps.urlTtlSeconds, now: c.get('now')(), disposition: 'inline' });
      return c.json({ url: signed.url, expiresAt: signed.expiresAt.toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/issuing/external-invoices/{externalInvoiceId}',
      tags: ['Issuing'],
      summary: 'Remove an attached invoice issued elsewhere',
      description: 'MUT-647: the entry then has no document, so MTB3A can issue one for it again. The row is kept (removed), and its file leaves the entry’s files.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      request: { params: ExternalInvoiceIdParamSchema },
      responses: { 204: { description: 'Removed' }, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await deps.issuingProfile(c, true);
      const now = c.get('now')();
      const removed = await store.issuing.removeExternal(organization.id, c.req.valid('param').externalInvoiceId, now);
      if (!removed) throw new ApiError('NOT_FOUND', 'No such attached invoice');
      await deps.audit(c, 'external_invoice.removed', 'external_invoice', removed.id, { entryKind: removed.entryKind, entryId: removed.entryId });
      return c.body(null, 204);
    },
  );
}
