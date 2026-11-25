import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { runIssuingRetentionSweep } from '../accounts/issuing-retention-sweep.js';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { documentNumberLabel } from '../issuing/labels.js';
import { retentionEndsOn } from '../issuing/retention.js';
import { DOC_TYPE_CODES } from '../issuing/types.js';
import type { UniformFileHouse } from '../issuing/uniform-file/export.js';
import type { Logger } from '../logger.js';
import type { IssuedDocumentRecord, LedgerStore, RetainedIssuingProfile } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  IssuingArchiveRequestSchema,
  IssuingRetentionSweepRequestSchema,
  IssuingRetentionSweepRunSchema,
  RetainedIssuingListSchema,
  RetainedIssuingQuerySchema,
} from '../schemas.js';
import { renderIssuedWithLogo, uniformFileZipOf, type IssuedPdf } from './issuing.js';

/**
 * MUT-644 (ADR-277): the operator's doors to closed profiles' issued documents, kept 7 years after the end of the year
 * of their newest document (issuing/retention.ts). Admin token only, on the unguarded store; the portal has no screen.
 *
 *   GET  /admin/v1/issuing/retained                        find a former owner's profile (business name or VAT number)
 *   POST /admin/v1/issuing/retained/{organizationId}/archive  their archive: signed originals, signed copies, uniform file
 *   POST /admin/v1/issuing/retention/sweep                 run or dry-run the sweep the hourly purge runs (D3)
 *
 * The archive is handed over by the operator after checking who is asking (D6); the server never mails it (a mail
 * never carries a money record, ADR-159 §5). Each export is written to the retention log.
 */
export interface IssuingRetentionRouteOptions {
  store: LedgerStore;
  logger: Logger;
  /** The PDF engine and signer the portal's issuing routes use; null on a server without them (archive answers 503). */
  issuedPdf: IssuedPdf | null;
  uniformFileHouse: UniformFileHouse;
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const ARCHIVE_MIME = 'application/zip';
/** No document predates this (MUT-569's floor). */
const EARLIEST = '2000-01-01';

const withRetention = (p: RetainedIssuingProfile) => ({ ...p, retainedUntil: retentionEndsOn(p.newestDocumentDate) });
const fileName = (doc: Pick<IssuedDocumentRecord, 'docType' | 'number'>) => `${DOC_TYPE_CODES[doc.docType]}-${doc.number}.pdf`;

export function issuingRetentionRoutes(options: IssuingRetentionRouteOptions): OpenAPIHono<AppEnv> {
  const { store, logger, issuedPdf, uniformFileHouse } = options;
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/issuing/retained',
      tags: ['Admin'],
      summary: 'Closed profiles whose issued documents are still kept',
      description:
        'MUT-644 (ADR-277): profiles deleted with their account whose issued documents and business details are kept 7 years after the end of the year of the newest document. Oldest first; `query` matches the business name (any part) or the start of a VAT number.',
      security: [{ adminToken: [] }],
      request: { query: RetainedIssuingQuerySchema },
      responses: {
        200: { description: 'The profiles', content: { 'application/json': { schema: RetainedIssuingListSchema } } },
        401: errorResponse('Missing or invalid admin token'),
        422: errorResponse('VALIDATION_FAILED'),
      },
    }),
    async (c) => {
      const { query, limit } = c.req.valid('query');
      const found = await store.issuingRetention.listClosed(query ? { query } : {}, limit);
      return c.json({ data: found.map(withRetention) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/issuing/retention/sweep',
      tags: ['Admin'],
      summary: 'Delete closed profiles’ issued documents whose 7 years have passed, or see which are due',
      description:
        'MUT-644 (ADR-277 D3): what the hourly account purge also runs. At most 25 profiles a run; `incomplete` means the next run continues. Each profile in its own transaction; one failure never stops the run. `dryRun` deletes nothing.',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: IssuingRetentionSweepRequestSchema } } } },
      responses: {
        200: { description: 'The run', content: { 'application/json': { schema: IssuingRetentionSweepRunSchema } } },
        401: errorResponse('Missing or invalid admin token'),
        422: errorResponse('VALIDATION_FAILED'),
      },
    }),
    async (c) => c.json(await runIssuingRetentionSweep({ store, logger, now: c.get('now')(), dryRun: c.req.valid('json').dryRun }), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/issuing/retained/{organizationId}/archive',
      tags: ['Admin'],
      summary: 'A closed profile’s archive of issued documents, for its former owner',
      description:
        'MUT-644 (ADR-277 D6): a zip of `originals/` (each document’s signed original as kept), `copies/` (a freshly signed copy of every document whose original was never produced) and `uniform-file/` (the uniform file of all its documents, MUT-569). Only for a profile deleted with its account: a live profile’s owners download their own (409 PROFILE_NOT_CLOSED). The operator checks who is asking and hands it over; the export is written to the retention log with `reference`. `X-Archive-Documents` carries the count.',
      security: [{ adminToken: [] }],
      request: {
        params: z.object({ organizationId: z.string().uuid() }),
        body: { required: true, content: { 'application/json': { schema: IssuingArchiveRequestSchema } } },
      },
      responses: {
        200: { description: 'The zip', content: { [ARCHIVE_MIME]: { schema: z.string().openapi({ format: 'binary' }) } } },
        401: errorResponse('Missing or invalid admin token'),
        404: errorResponse('NOT_FOUND: no issued documents or business details are kept under this id'),
        409: errorResponse('CONFLICT, details.reason PROFILE_NOT_CLOSED: the profile still exists'),
        422: errorResponse('VALIDATION_FAILED'),
        503: errorResponse('SIGNING_NOT_CONFIGURED or SIGNING_UNAVAILABLE: a copy had to be signed and could not be; nothing was exported'),
      },
    }),
    async (c) => {
      const { organizationId } = c.req.valid('param');
      const { reference, lang } = c.req.valid('json');
      const now = c.get('now')();
      const held = await store.issuingRetention.getClosed(organizationId);
      if (!held) {
        if (await store.organizations.getById(organizationId)) throw new ApiError('CONFLICT', 'This profile still exists: its owners can download their own documents', { reason: 'PROFILE_NOT_CLOSED' });
        throw new ApiError('NOT_FOUND', 'No issued documents are kept under this id');
      }
      const documents = held.newestDocumentDate ? await store.issuing.inRange(organizationId, EARLIEST, held.newestDocumentDate) : [];
      const files: Zippable = {};
      let originals = 0;
      for (const doc of documents) {
        const original = await store.issuing.getOriginalPdf(organizationId, doc.id);
        if (original) {
          files[`originals/${fileName(doc)}`] = [new Uint8Array(original.bytes), { level: 0 }];
          originals++;
        }
      }
      const unproduced = documents.filter((d) => !files[`originals/${fileName(d)}`]);
      for (const [doc, bytes] of await signedCopies(organizationId, documents, unproduced, now)) files[`copies/${fileName(doc)}`] = [bytes, { level: 0 }];
      const issuer = await store.issuing.getIssuer(organizationId);
      if (issuer && documents.length > 0) {
        const range = { from: documents.reduce((min, d) => (d.documentDate < min ? d.documentDate : min), documents[0]!.documentDate), to: held.newestDocumentDate! };
        const { zip } = await uniformFileZipOf(store, uniformFileHouse, { organizationId, issuer, documents, range, now, lang });
        files[`uniform-file/OPENFRMT-${issuer.vatId}-${range.from}_${range.to}.zip`] = [zip, { level: 0 }];
      }
      files['README.txt'] = strToU8(readme(held, originals, unproduced.length));
      const archive = zipSync(files);
      await store.issuingRetention.record(organizationId, 'ARCHIVE_EXPORTED', { reference, documents: documents.length, originals, copies: unproduced.length }, now);
      logger.info({ organizationId, documents: documents.length, originals, copies: unproduced.length }, 'closed profile archive exported');
      return c.body(new Uint8Array(archive), 200, {
        'content-type': ARCHIVE_MIME,
        'content-disposition': `attachment; filename="issued-documents-${held.vatId ?? organizationId}.zip"`,
        'cache-control': 'no-store',
        'x-archive-documents': String(documents.length),
      });
    },
  );

  /** A signed copy ("העתק") of each document never produced, the way the portal's view copy prints it (MUT-641). */
  async function signedCopies(organizationId: string, all: IssuedDocumentRecord[], docs: IssuedDocumentRecord[], now: Date): Promise<Array<[IssuedDocumentRecord, Uint8Array]>> {
    if (docs.length === 0) return [];
    const sign = issuedPdf?.sign;
    if (!issuedPdf || !sign) throw new ApiError('SIGNING_NOT_CONFIGURED', 'Signed documents are not available on this server, so the archive could not be made');
    const byId = new Map(all.map((d) => [d.id, d]));
    const facts = await store.issuing.paymentRequestFacts(organizationId, docs.filter((d) => d.docType === 'PAYMENT_REQUEST').map((d) => d.id));
    const out: Array<[IssuedDocumentRecord, Uint8Array]> = [];
    for (const doc of docs) {
      const original = doc.originalId ? (byId.get(doc.originalId) ?? (await store.issuing.getById(organizationId, doc.originalId))) : null;
      const bytes = await renderIssuedWithLogo(store, issuedPdf, issuedPdf.render, doc, {
        mark: 'COPY',
        originalNumber: original ? documentNumberLabel(original.docType, original.number) : null,
        cancelledAs: facts.get(doc.id)?.cancellation?.number ?? null,
      });
      try {
        out.push([doc, await sign(doc, bytes, now)]);
      } catch (error) {
        issuedPdf.signingFailed?.({ organizationId, documentId: doc.id, error });
        throw new ApiError('SIGNING_UNAVAILABLE', 'A copy could not be signed, so nothing was exported. Try again shortly.');
      }
    }
    return out;
  }

  return app;
}

function readme(held: RetainedIssuingProfile, originals: number, copies: number): string {
  return [
    `Issued documents of ${held.legalName ?? 'a closed MTB3A profile'}${held.vatId ? ` (${held.vatId})` : ''}`,
    '',
    `originals/     ${originals} signed original(s), exactly as first issued`,
    `copies/        ${copies} signed copy(ies) of documents whose original was never produced`,
    'uniform-file/  the uniform file (מבנה אחיד 1.31) of every document, for the Tax Authority',
    '',
    `Kept until ${retentionEndsOn(held.newestDocumentDate) ?? 'the next sweep'}: 7 years after the end of the year of the newest document, then deleted.`,
    '',
  ].join('\n');
}
