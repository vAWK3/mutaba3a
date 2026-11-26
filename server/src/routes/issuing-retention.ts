import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { retentionDatesOf, runIssuingRetentionSweep } from '../accounts/issuing-retention-sweep.js';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { documentNumberLabel } from '../issuing/labels.js';
import { ARCHIVE_KEEP_NOTICE_VERSION } from '../issuing/retention.js';
import { defaultPack, type UniformFileHouse } from '../jurisdictions/index.js';
import type { Logger } from '../logger.js';
import type { IssuedDocumentRecord, LedgerStore, RetainedIssuingProfile } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  IssuingArchiveRequestSchema,
  IssuingErasedSchema,
  IssuingEraseRequestSchema,
  IssuingRetentionSweepRequestSchema,
  IssuingRetentionSweepRunSchema,
  RetainedIssuingListSchema,
  RetainedIssuingQuerySchema,
} from '../schemas.js';
import { renderIssuedWithLogo, uniformFileZipOf, type IssuedPdf } from './issuing.js';

/**
 * MUT-644 (ADR-277, amended 2026-11-25): the operator's doors to closed profiles' issued documents, each kept 7 years
 * from its own date (issuing/retention.ts). Admin token only, on the unguarded store; the portal has no screen.
 *
 *   GET  /admin/v1/issuing/retained                           find a former owner's profile (business name or VAT number)
 *   POST /admin/v1/issuing/retained/{organizationId}/archive  their archive: signed originals, signed copies, uniform file
 *   POST /admin/v1/issuing/retained/{organizationId}/erase    an erasure request, only after the archive was handed over (D7)
 *   POST /admin/v1/issuing/retention/sweep                    run or dry-run the sweep the hourly purge runs (D3)
 *
 * The archive is handed over by the operator after checking who is asking (D6; TD-332 closed won't do); the server
 * never mails it (a mail never carries a money record, ADR-159 §5). Its README tells the owner to keep it 7 years, and
 * each export is written to the retention log with the notice's version, which is what lets an erasure go ahead.
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

const withRetention = (p: RetainedIssuingProfile) => ({ ...p, ...retentionDatesOf(p) });
const fileName = (doc: Pick<IssuedDocumentRecord, 'docType' | 'number'>) => `${defaultPack().documentTypes[doc.docType].code}-${doc.number}.pdf`;

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
        'MUT-644 (ADR-277): profiles deleted with their account whose issued documents and business details are still kept: each document 7 years from its own date (since 1.139.0), the business details until the last document goes. Oldest document first; `query` matches the business name (any part) or the start of a VAT number.',
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
        'MUT-644 (ADR-277 D3): what the hourly account purge also runs. Since 1.139.0 each document goes 7 years after its own date, with its lines, copies, kept original and cancellation; the business details, logos and numbering go with the last. At most 25 profiles a run; `incomplete` means the next run continues. Each profile in its own transaction; one failure never stops the run. `dryRun` deletes nothing.',
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
        'MUT-644 (ADR-277 D6): a zip of `originals/` (each document’s signed original as kept), `copies/` (a freshly signed copy of every document whose original was never produced) and `uniform-file/` (the uniform file of all its documents, MUT-569). Only for a profile deleted with its account: a live profile’s owners download their own (409 PROFILE_NOT_CLOSED). The operator checks who is asking and hands it over. Its README tells the owner to keep it 7 years (in English, Arabic and Hebrew); the export is written to the retention log with `reference` and, since 1.139.0, the notice’s version, which an erasure needs. `X-Archive-Documents` carries the count.',
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
      await store.issuingRetention.record(organizationId, 'ARCHIVE_EXPORTED', { reference, documents: documents.length, originals, copies: unproduced.length, noticeVersion: ARCHIVE_KEEP_NOTICE_VERSION }, now);
      logger.info({ organizationId, documents: documents.length, originals, copies: unproduced.length }, 'closed profile archive exported');
      return c.body(new Uint8Array(archive), 200, {
        'content-type': ARCHIVE_MIME,
        'content-disposition': `attachment; filename="issued-documents-${held.vatId ?? organizationId}.zip"`,
        'cache-control': 'no-store',
        'x-archive-documents': String(documents.length),
      });
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/issuing/retained/{organizationId}/erase',
      tags: ['Admin'],
      summary: 'Erase a closed profile’s issued documents before their 7 years, at its former owner’s request',
      description:
        'Since 1.139.0. MUT-644 (ADR-277 D7): an erasure request may shorten the 7 years only once the former owner was given everything first: an archive exported (`…/archive`) and logged no later than now, whose README told them to keep it 7 years. Then every retained row of the profile is deleted (documents, lines, copies, originals, cancellations, business details, logos, numbering) and an ERASED entry with `reference` is written to the retention log. Only for a profile deleted with its account (409 PROFILE_NOT_CLOSED).',
      security: [{ adminToken: [] }],
      request: {
        params: z.object({ organizationId: z.string().uuid() }),
        body: { required: true, content: { 'application/json': { schema: IssuingEraseRequestSchema } } },
      },
      responses: {
        200: { description: 'Erased', content: { 'application/json': { schema: IssuingErasedSchema } } },
        401: errorResponse('Missing or invalid admin token'),
        404: errorResponse('NOT_FOUND: no issued documents or business details are kept under this id'),
        409: errorResponse('CONFLICT, details.reason PROFILE_NOT_CLOSED (the profile still exists) or ARCHIVE_NOT_HANDED_OVER (export the archive for the former owner first)'),
        422: errorResponse('VALIDATION_FAILED'),
      },
    }),
    async (c) => {
      const { organizationId } = c.req.valid('param');
      const { reference } = c.req.valid('json');
      const now = c.get('now')();
      const result = await store.issuingRetention.erase(organizationId, reference, now);
      if (result.kind === 'not_closed') throw new ApiError('CONFLICT', 'This profile still exists: its owners delete their own records', { reason: 'PROFILE_NOT_CLOSED' });
      if (result.kind === 'nothing') throw new ApiError('NOT_FOUND', 'No issued documents are kept under this id');
      if (result.kind === 'archive_not_handed_over') {
        throw new ApiError('CONFLICT', 'Export the archive for the former owner first: it tells them to keep their documents 7 years. Only then may an erasure shorten them.', { reason: 'ARCHIVE_NOT_HANDED_OVER' });
      }
      logger.info({ organizationId, documents: result.documents, rows: result.rows }, 'closed profile’s issued documents erased on request');
      return c.json({ organizationId, documents: result.documents, cancellations: result.cancellations, rows: result.rows, erasedAt: now.toISOString() }, 200);
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

/**
 * D7: the 7-year keep notice, in English, Arabic and Hebrew. Its version (issuing/retention.ts
 * ARCHIVE_KEEP_NOTICE_VERSION) is logged with each export; bump it when the wording changes in substance.
 */
export const ARCHIVE_KEEP_NOTICE = [
  'KEEP THIS ARCHIVE FOR 7 YEARS',
  'Keep these documents for 7 years from the date of each one: the bookkeeping rules may require it. MTB3A deletes its',
  'own copy of each document 7 years after its date, or sooner if you ask us to erase them. After that, this archive is',
  'your only copy, so keep it somewhere safe until 7 years have passed from the date of the newest document in it.',
  '',
  'احتفظ بهذا الأرشيف 7 سنوات',
  'احتفظ بهذه المستندات 7 سنوات من تاريخ كل منها، فقد تلزمك بذلك قواعد مسك الدفاتر. تحذف متابعة نسختها من كل مستند بعد',
  '7 سنوات من تاريخه، أو قبل ذلك إن طلبت منا محوها. بعدها يصبح هذا الأرشيف نسختك الوحيدة، فاحفظه في مكان آمن حتى تمضي',
  '7 سنوات على تاريخ أحدث مستند فيه.',
  '',
  'שמרו את הארכיון הזה 7 שנים',
  'שמרו את המסמכים האלה 7 שנים מתאריך כל אחד מהם: ייתכן שהוראות ניהול הספרים מחייבות זאת. MTB3A מוחקת את העותק שלה',
  'של כל מסמך 7 שנים אחרי תאריכו, או מוקדם יותר אם תבקשו מאיתנו למחוק אותם. מאז הארכיון הזה הוא העותק היחיד שלכם, לכן',
  'שמרו אותו במקום בטוח עד שיעברו 7 שנים מתאריך המסמך החדש ביותר שבו.',
] as const;

function readme(held: RetainedIssuingProfile, originals: number, copies: number): string {
  const { nextSweepOn, retainedUntil } = retentionDatesOf(held);
  return [
    `Issued documents of ${held.legalName ?? 'a closed MTB3A profile'}${held.vatId ? ` (${held.vatId})` : ''}`,
    '',
    `originals/     ${originals} signed original(s), exactly as first issued`,
    `copies/        ${copies} signed copy(ies) of documents whose original was never produced`,
    'uniform-file/  the uniform file (מבנה אחיד 1.31) of every document, for the Tax Authority',
    '',
    nextSweepOn
      ? `MTB3A deletes each document 7 years after its own date: the first from ${nextSweepOn}, the last from ${retainedUntil}.`
      : 'MTB3A keeps no document of this profile: the business details go on the next sweep.',
    '',
    ...ARCHIVE_KEEP_NOTICE,
    '',
  ].join('\n');
}
