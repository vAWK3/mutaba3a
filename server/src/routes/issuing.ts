import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { parseAmount, todayFor } from '../agreements/compose.js';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { hasFeature } from '../features.js';
import { idempotent } from '../idempotency.js';
import { pastMoneyDate } from '../income/compose.js';
import { composeDocument, parseQuantity, type ComposeInput } from '../issuing/compose.js';
import { copyLabel } from '../issuing/copies.js';
import { DOC_TYPE_TITLES } from '../issuing/labels.js';
import { ISSUED_DOC_TYPES } from '../issuing/types.js';
import { ISSUING_CORE_VERSION } from '../issuing/version.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { isMalafatFirm, notOwner, ownsProfile, profileOwnerOf, profileTypeOf } from '../personal-profile.js';
import type { CustomerRecord, IssueDocumentInput, IssuedDocumentRecord, IssuerDetailsRecord, JsonObject, LedgerStore, Organization } from '../repositories/ports.js';
import {
  IssueDocumentRequestSchema,
  IssuedCopyRequestSchema,
  IssuedDocTypeParamSchema,
  IssuedDocumentIdParamSchema,
  IssuedDocumentPageSchema,
  IssuedDocumentPreviewSchema,
  IssuedDocumentSchema,
  IssuerDetailsRequestSchema,
  IssuerDetailsSchema,
  IssuingCounterSchema,
  IssuingGapsSchema,
  IssuingSettingsSchema,
  ListIssuedDocumentsQuerySchema,
  StartingNumberRequestSchema,
} from '../schemas.js';
import { serializeComposedTotals, serializeIssuedDocument, serializeIssuer } from '../serializers.js';
import { z } from '@hono/zod-openapi';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse, versionMismatch } from './shared.js';
import { PERSON_OR_MALAFAT } from './security.js';

/** MUT-642: the customer printed on a document (name, VAT/company number, address), frozen on it at issue. */
const customerSnapshot = (customer: CustomerRecord | null): JsonObject =>
  customer ? { name: customer.name, ...(customer.taxId ? { taxId: customer.taxId } : {}), ...(customer.address ? { address: customer.address } : {}) } : {};

/** The business details printed on a document, frozen on it at issue. */
const issuerSnapshot = (issuer: IssuerDetailsRecord): JsonObject => ({ legalName: issuer.legalName, vatId: issuer.vatId, dealerType: issuer.dealerType, address: issuer.address, city: issuer.city, phone: issuer.phone, email: issuer.email, website: issuer.website });

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const json = <T>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } });

type IssueRequest = z.infer<typeof IssueDocumentRequestSchema>;

/**
 * MUT-568 (ADR-260): issuing invoices, invoice-receipts, receipts and credit notes. Session only, on a business profile
 * whose owner holds the `invoicing` feature (D1); a person's own personal profile, a Malafat firm or a Malafat-connected
 * profile gets the switched-off 404. Writes need the profile's owner (creator or co-owner); an accountant reads under
 * their grant. Issued documents are never changed or removed: a credit note corrects a tax invoice.
 */
/**
 * MUT-640: the PDF renderer, handed in by the hosted server (issuing/pdf/render.ts). The portal's signed-out mode runs
 * these routes in the browser, where Node's fonts and files don't exist: it passes none, and the PDF routes aren't
 * registered there (it has no issuing either). Typed here so the browser bundle never imports the renderer.
 */
export type IssuedPdfRenderer = (doc: IssuedDocumentRecord, options: { mark: 'ORIGINAL' | 'COPY' | 'DRAFT'; originalNumber: number | null; logo: null }) => Promise<Uint8Array>;

export function issuingRoutes(store: LedgerStore, renderIssuedDocumentPdf: IssuedPdfRenderer | null = null): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  /** The selected profile, if issuing is on for it. The feature is the owner's, so co-owners and accountants see the same. */
  async function issuingProfile(c: Context<AppEnv>, write: boolean): Promise<Organization> {
    const { organization, user, membershipRole, writerOfRecord, via } = sessionAuth(c);
    const owner = profileOwnerOf(organization);
    const off = () => new ApiError('NOT_FOUND', 'Not found');
    if (via || writerOfRecord === 'MALAFAT' || isMalafatFirm(organization) || !owner || profileTypeOf(organization) === 'PERSONAL') throw off();
    if (!(await hasFeature(store, owner, 'invoicing'))) throw off();
    if (write && !ownsProfile(organization, user.id, membershipRole)) throw notOwner();
    return organization;
  }

  function audit(c: Context<AppEnv>, action: string, entityType: string, entityId: string, metadata?: JsonObject) {
    const { organization, user } = sessionAuth(c);
    return store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action, entityType, entityId, ...(metadata ? { metadata } : {}), requestId: c.get('requestId') });
  }

  async function mustIssuer(organizationId: string): Promise<IssuerDetailsRecord> {
    const issuer = await store.issuing.getIssuer(organizationId);
    if (!issuer) throw new ApiError('VALIDATION_FAILED', 'Add the business details printed on documents first', { reason: 'ISSUER_DETAILS_REQUIRED' });
    return issuer;
  }

  /** The request's shape rules per type, then the pure compose (both the preview and the issue run this). */
  /** A credit note's tax invoice: it credits at that invoice's rate and can't be dated before it (review fix 1). */
  async function creditedInvoice(organizationId: string, body: IssueRequest): Promise<IssuedDocumentRecord | null> {
    if (body.docType !== 'CREDIT_NOTE' || !body.originalId) return null;
    const original = await store.issuing.getById(organizationId, body.originalId);
    if (!original || original.docType !== 'TAX_INVOICE') throw new ApiError('NOT_FOUND', 'No such tax invoice', { field: 'originalId' });
    return original;
  }

  function composeFrom(body: IssueRequest, issuer: IssuerDetailsRecord, today: string, original: IssuedDocumentRecord | null) {
    const documentDate = pastMoneyDate(body.documentDate, today, 'documentDate');
    if (original && documentDate < original.documentDate) {
      throw new ApiError('VALIDATION_FAILED', `A credit note can't be dated before its tax invoice (${original.documentDate})`, { field: 'documentDate', reason: 'DATE_BEFORE_ORIGINAL', originalDate: original.documentDate });
    }
    const needs = (ok: boolean, field: string, message: string) => {
      if (!ok) throw new ApiError('VALIDATION_FAILED', message, { field, reason: 'FIELD_NOT_ALLOWED_FOR_TYPE' });
    };
    const takesPayment = body.docType === 'TAX_INVOICE_RECEIPT' || body.docType === 'RECEIPT';
    needs(body.docType === 'RECEIPT' || !!body.customerId, 'customerId', 'this document needs a customer');
    needs((body.docType === 'CREDIT_NOTE') === !!body.originalId, 'originalId', 'a credit note, and only a credit note, names the tax invoice it credits');
    needs(body.docType === 'RECEIPT' || !body.appliesToDocumentId, 'appliesToDocumentId', 'only a receipt pays an earlier tax invoice');
    needs(takesPayment === (!!body.payment || body.fromEntry?.kind === 'received'), 'payment', 'an invoice-receipt or a receipt, and only those, says how the money came in');
    needs(body.docType === 'TAX_INVOICE' || !body.dueDate, 'dueDate', 'only a tax invoice has a due date');
    needs(!body.fromEntry || (body.fromEntry.kind === 'owed') === (body.docType === 'TAX_INVOICE'), 'fromEntry', 'a tax invoice is issued for an Owed entry; an invoice-receipt or a receipt for a Received one');
    needs(!body.fromEntry || body.docType !== 'CREDIT_NOTE', 'fromEntry', 'a credit note is issued from its tax invoice, not from an entry');
    const input: ComposeInput = {
      docType: body.docType,
      currency: body.currency,
      documentDate,
      dealerType: issuer.dealerType,
      documentDiscountMinor: body.discount ? parseAmount(body.discount, 'ILS', 'discount') : 0n,
      pricesIncludeVat: body.pricesIncludeVat ?? issuer.pricesIncludeVat,
      ...(original ? { vatRateBasisPoints: original.vatRateBasisPoints } : {}),
      lines: body.lines.map((l) => ({
        description: l.description,
        kind: l.kind,
        quantityMilli: parseQuantity(l.quantity),
        unitPriceMinor: parseAmount(l.unitPrice, 'ILS', 'unitPrice'),
        discountMinor: l.discount ? parseAmount(l.discount, 'ILS', 'discount') : 0n,
        ...(l.pricesIncludeVat !== undefined ? { pricesIncludeVat: l.pricesIncludeVat } : {}),
        ...(l.vatExempt ? { vatExempt: true } : {}),
      })),
    };
    return { documentDate, composed: composeDocument(input) };
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuer',
      tags: ['Issuing'],
      summary: 'The business details printed on this profile’s documents',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      responses: { 200: json('The details', IssuerDetailsSchema), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      const issuer = await store.issuing.getIssuer(organization.id);
      if (!issuer) throw new ApiError('NOT_FOUND', 'No business details yet', { reason: 'ISSUER_DETAILS_REQUIRED' });
      return c.json(serializeIssuer(issuer), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/issuer',
      tags: ['Issuing'],
      summary: 'Set the business details printed on documents',
      description: 'Without If-Match the details are created (409 VERSION_MISMATCH if they exist); with it they are replaced. Issued documents keep the details they were issued with.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      request: { body: jsonBody(IssuerDetailsRequestSchema) },
      responses: { 200: json('Saved', IssuerDetailsSchema), ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const body = c.req.valid('json');
      const header = c.req.header('if-match');
      const expectedVersion = header === undefined ? null : Number(header.replace(/"/g, ''));
      if (expectedVersion !== null && !Number.isInteger(expectedVersion)) throw new ApiError('VALIDATION_FAILED', 'If-Match must be a version number', { field: 'If-Match' });
      const input = { legalName: body.legalName, vatId: body.vatId, dealerType: body.dealerType, address: body.address ?? null, city: body.city ?? null, phone: body.phone ?? null, email: body.email ?? null, website: body.website ?? null, pricesIncludeVat: body.pricesIncludeVat ?? false };
      const result = await store.issuing.putIssuer(organization.id, input, expectedVersion, c.get('now')());
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No business details yet; send them without If-Match');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      await audit(c, 'issuer_details.saved', 'issuer_details', organization.id);
      return c.json(serializeIssuer(result.record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuing/settings',
      tags: ['Issuing'],
      summary: 'Numbering per document type',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      responses: { 200: json('The counters', IssuingSettingsSchema), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      const counters = await store.issuing.counters(organization.id);
      const byType = new Map(counters.map((k) => [k.docType, k]));
      return c.json(
        {
          counters: ISSUED_DOC_TYPES.map((docType) => {
            const k = byType.get(docType);
            return { docType, start: k?.start ?? 1, next: k?.next ?? 1, hasDocuments: !!k && k.next > k.start };
          }),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/issuing/starting-numbers/{docType}',
      tags: ['Issuing'],
      summary: 'Set the first number of a document type',
      description: 'D3: for a business moving from another tool. Refused with 409 (reason HAS_DOCUMENTS) once a document of that type exists.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      request: { params: IssuedDocTypeParamSchema, body: jsonBody(StartingNumberRequestSchema) },
      responses: { 200: json('Set', IssuingCounterSchema), ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const { docType } = c.req.valid('param');
      const { start } = c.req.valid('json');
      const result = await store.issuing.setStartingNumber(organization.id, docType, start);
      if (result.kind === 'has_documents') throw new ApiError('CONFLICT', 'Documents of this type were already issued; their numbering is fixed', { reason: 'HAS_DOCUMENTS' });
      await audit(c, 'issuing.starting_number_set', 'issuer_details', organization.id, { docType, start });
      return c.json({ docType, start: result.counter.start, next: result.counter.next, hasDocuments: false }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/issued-documents/preview',
      tags: ['Issuing'],
      summary: 'What a document would say, without issuing it',
      description: 'D7: stateless. The same rules and math as issuing; nothing is written and no number is taken.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      request: { body: jsonBody(IssueDocumentRequestSchema) },
      responses: { 200: json('The totals', IssuedDocumentPreviewSchema), ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      const issuer = await mustIssuer(organization.id);
      const body = c.req.valid('json');
      const { composed } = composeFrom(body, issuer, todayFor(organization, c.get('now')()), await creditedInvoice(organization.id, body));
      return c.json(serializeComposedTotals({ ...composed, currency: 'ILS' }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/issued-documents',
      tags: ['Issuing'],
      summary: 'Issue a tax invoice, invoice-receipt, receipt or credit note',
      description:
        'Irreversible: the document takes the next number of its type and is never changed or removed (a credit note corrects a tax invoice). It posts its money: a tax invoice an Owed, an invoice-receipt an Owed paid in full, a receipt a Received (paying appliesToDocumentId when given), a credit note a credit on its tax invoice up to what is still owed (422 ORIGINAL_PAID beyond). The date may not be in the future nor before the last document of its type (422 DATE_BEFORE_LAST_DOCUMENT). Sending the same Idempotency-Key again returns the same document.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write'), idempotent(store, 'issued_document.issue')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(IssueDocumentRequestSchema) },
      responses: { 201: json('Issued', IssuedDocumentSchema), ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const { user } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const issuer = await mustIssuer(organization.id);
      const { documentDate, composed } = composeFrom(body, issuer, todayFor(organization, now), await creditedInvoice(organization.id, body));
      const customer = body.customerId ? await store.customers.getById(organization.id, body.customerId) : null;
      if (body.customerId && !customer) throw new ApiError('NOT_FOUND', 'No such customer', { field: 'customerId' });
      // I1-a: a document for a captured Received prints how that money came in.
      const fromPayment = body.fromEntry?.kind === 'received' ? await store.payments.getById(organization.id, body.fromEntry.id) : null;
      if (body.fromEntry?.kind === 'received' && !fromPayment) throw new ApiError('NOT_FOUND', 'No such entry', { field: 'fromEntry' });
      const payment = fromPayment
        ? { method: fromPayment.method, reference: fromPayment.reference, receivedOn: fromPayment.receivedOn }
        : body.payment
          ? { method: body.payment.method, reference: body.payment.reference ?? null, receivedOn: pastMoneyDate(body.payment.receivedOn, todayFor(organization, now), 'payment.receivedOn') }
          : null;
      const input: IssueDocumentInput = {
        organizationId: organization.id,
        docType: body.docType,
        documentDate,
        currency: body.currency,
        composed,
        issuer: issuerSnapshot(issuer),
        customerId: customer?.id ?? null,
        customer: customerSnapshot(customer),
        language: body.language,
        style: issuer.documentStyle,
        ink: issuer.ink,
        notes: body.notes ?? null,
        dueDate: body.docType === 'TAX_INVOICE' ? (body.dueDate ?? null) : null,
        originalId: body.originalId ?? null,
        payment,
        appliesToDocumentId: body.appliesToDocumentId ?? null,
        fromEntry: body.fromEntry ? { kind: body.fromEntry.kind === 'owed' ? 'receivable' : 'payment', id: body.fromEntry.id } : null,
        allocationNumber: null,
        titlePrefix: DOC_TYPE_TITLES[body.language][body.docType],
        coreVersion: ISSUING_CORE_VERSION,
        createdByUserId: user.id,
        requestKey: c.req.valid('header')['idempotency-key'],
        requestId: c.get('requestId'),
      };
      const result = await store.issuing.issue(input, now);
      switch (result.kind) {
        case 'date_before_last':
          throw new ApiError('VALIDATION_FAILED', `Documents of this type are already dated ${result.lastDate}; a new one can't be earlier`, { field: 'documentDate', reason: 'DATE_BEFORE_LAST_DOCUMENT', lastDate: result.lastDate });
        case 'customer_not_found':
          throw new ApiError('NOT_FOUND', 'No such customer', { field: 'customerId' });
        case 'original_not_found':
          throw new ApiError('NOT_FOUND', 'No such tax invoice for this customer', { field: body.originalId ? 'originalId' : 'appliesToDocumentId' });
        case 'original_paid':
          throw new ApiError('VALIDATION_FAILED', 'A credit note credits only what is still owed on its tax invoice', { field: 'lines', reason: 'ORIGINAL_PAID', outstanding: result.outstandingMinor.toString() });
        case 'exceeds_outstanding':
          throw new ApiError('VALIDATION_FAILED', 'The receipt is more than the tax invoice still owes', { field: 'lines', reason: 'EXCEEDS_OUTSTANDING', outstanding: result.outstandingMinor.toString() });
        case 'entry_not_found':
          throw new ApiError('NOT_FOUND', 'No such entry to issue for, or it already has a document', { field: 'fromEntry' });
        case 'entry_mismatch':
          throw new ApiError('VALIDATION_FAILED', `The document's ${result.field} must match the entry's`, { field: 'fromEntry', reason: 'ENTRY_MISMATCH', mismatch: result.field });
        case 'issued':
          if (result.created) await audit(c, 'issued_document.issued', 'issued_document', result.document.id, { docType: result.document.docType, number: result.document.number });
          return c.json(serializeIssuedDocument(result.document), 201);
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issued-documents',
      tags: ['Issuing'],
      summary: 'Issued documents, newest first',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      request: { query: ListIssuedDocumentsQuerySchema },
      responses: { 200: json('A page', IssuedDocumentPageSchema), ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      const q = c.req.valid('query');
      const page = await store.issuing.list(organization.id, { ...(q.docType ? { docType: q.docType } : {}), ...(q.customerId ? { customerId: q.customerId } : {}) }, { limit: q.limit, cursor: q.cursor ? decodeCursor(q.cursor) : null });
      return c.json({ items: page.items.map(serializeIssuedDocument), nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issued-documents/{documentId}',
      tags: ['Issuing'],
      summary: 'One issued document',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      request: { params: IssuedDocumentIdParamSchema },
      responses: { 200: json('The document', IssuedDocumentSchema), ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      const document = await store.issuing.getById(organization.id, c.req.valid('param').documentId);
      if (!document) throw new ApiError('NOT_FOUND', 'No such document');
      return c.json(serializeIssuedDocument(document), 200);
    },
  );

  function registerPdfRoutes(renderIssuedDocumentPdf: IssuedPdfRenderer) {
    // ---- MUT-640: the PDF. Copies are produced only through POST …/pdf, so the original is always printed (review fix 7).

    const pdfResponse = { description: 'The PDF', content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } } };

    /** The number of the tax invoice a credit note credits or a receipt pays (printed on it). */
    async function originalNumberOf(organizationId: string, doc: IssuedDocumentRecord): Promise<number | null> {
      if (!doc.originalId) return null;
      return (await store.issuing.getById(organizationId, doc.originalId))?.number ?? null;
    }

    function pdf(c: Context<AppEnv>, bytes: Uint8Array, filename: string) {
      return c.body(new Uint8Array(bytes), 200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${filename}"`, 'cache-control': 'no-store' });
    }

    // Registered before /{documentId}/pdf, so "preview" is never read as a document id.
    app.openapi(
      createRoute({
        method: 'post',
        path: '/v1/issued-documents/preview/pdf',
        tags: ['Issuing'],
        summary: 'The PDF a document would be, marked as a draft',
        description: 'D7: stateless, like the preview. Watermarked "draft" in the document\'s language; shows the number the next document of its type would take.',
        security: PERSON_OR_MALAFAT,
        middleware: [requireScope('issuing:read')] as const,
        request: { body: jsonBody(IssueDocumentRequestSchema) },
        responses: { 200: pdfResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
      }),
      async (c) => {
        const organization = await issuingProfile(c, false);
        const issuer = await mustIssuer(organization.id);
        const body = c.req.valid('json');
        const original = await creditedInvoice(organization.id, body);
        const { documentDate, composed } = composeFrom(body, issuer, todayFor(organization, c.get('now')()), original);
        const customer = body.customerId ? await store.customers.getById(organization.id, body.customerId) : null;
        const next = (await store.issuing.counters(organization.id)).find((k) => k.docType === body.docType)?.next ?? 1;
        const draft: IssuedDocumentRecord = {
          id: '00000000-0000-0000-0000-000000000000',
          organizationId: organization.id,
          docType: body.docType,
          number: next,
          documentDate,
          issuedAt: c.get('now')(),
          currency: body.currency,
          subtotalMinor: composed.subtotalMinor,
          discountMinor: composed.discountMinor,
          netMinor: composed.netMinor,
          vatRateBasisPoints: composed.vatRateBasisPoints,
          vatMinor: composed.vatMinor,
          grossMinor: composed.grossMinor,
          pricesIncludeVat: composed.pricesIncludeVat,
          issuer: issuerSnapshot(issuer),
          customerId: customer?.id ?? null,
          customer: customerSnapshot(customer),
          language: body.language,
          style: issuer.documentStyle,
          ink: issuer.ink,
          notes: body.notes ?? null,
          originalId: body.originalId ?? body.appliesToDocumentId ?? null,
          paymentDetails: body.payment ? { method: body.payment.method, reference: body.payment.reference ?? null, receivedOn: body.payment.receivedOn } : null,
          allocationNumber: null,
          receivableId: null,
          paymentId: null,
          creditId: null,
          coreVersion: ISSUING_CORE_VERSION,
          createdByUserId: sessionAuth(c).user.id,
          requestKey: '',
          lines: composed.lines.map((l) => ({ index: l.index, description: l.description.trim(), kind: l.kind, quantityMilli: l.quantityMilli, unitPriceMinor: l.unitPriceMinor, discountMinor: l.discountMinor, netMinor: l.netMinor, pricesIncludeVat: l.pricesIncludeVat, vatRateBasisPoints: l.vatRateBasisPoints, vatMinor: l.vatMinor })),
        };
        const paid = body.appliesToDocumentId ? await store.issuing.getById(organization.id, body.appliesToDocumentId) : null;
        const bytes = await renderIssuedDocumentPdf(draft, { mark: 'DRAFT', originalNumber: original?.number ?? paid?.number ?? null, logo: null });
        return pdf(c, bytes, 'draft.pdf');
      },
    );

    app.openapi(
      createRoute({
        method: 'get',
        path: '/v1/issued-documents/{documentId}/pdf',
        tags: ['Issuing'],
        summary: 'View a document as a PDF (a copy, not counted)',
        description: 'D-PDF2: prints "copy" and records nothing. Downloading, emailing or sharing is POST, which counts the copy (the first is the original).',
        security: PERSON_OR_MALAFAT,
        middleware: [requireScope('issuing:read')] as const,
        request: { params: IssuedDocumentIdParamSchema },
        responses: { 200: pdfResponse, ...notFoundResponse, ...validationResponse, ...errorResponses },
      }),
      async (c) => {
        const organization = await issuingProfile(c, false);
        const doc = await store.issuing.getById(organization.id, c.req.valid('param').documentId);
        if (!doc) throw new ApiError('NOT_FOUND', 'No such document');
        const bytes = await renderIssuedDocumentPdf(doc, { mark: 'COPY', originalNumber: await originalNumberOf(organization.id, doc), logo: null });
        return pdf(c, bytes, `${doc.docType.toLowerCase()}-${doc.number}.pdf`);
      },
    );

    app.openapi(
      createRoute({
        method: 'post',
        path: '/v1/issued-documents/{documentId}/pdf',
        tags: ['Issuing'],
        summary: 'Produce a copy of a document as a PDF (download, email, share)',
        description: 'Records the copy and prints its mark: the first copy ever produced is the original ("מקור"), every later one a copy ("העתק"). A retry with the same Idempotency-Key gets the same copy.',
        security: PERSON_OR_MALAFAT,
        // Not the idempotency middleware (it replays JSON): the copy keeps its request key, so a retry gets the same copy and mark.
        middleware: [requireScope('issuing:write')] as const,
        request: { headers: IdempotencyHeaderSchema, params: IssuedDocumentIdParamSchema, body: jsonBody(IssuedCopyRequestSchema) },
        responses: { 200: pdfResponse, ...notFoundResponse, ...validationResponse, ...errorResponses },
      }),
      async (c) => {
        const organization = await issuingProfile(c, true);
        const { user } = sessionAuth(c);
        const { documentId } = c.req.valid('param');
        const doc = await store.issuing.getById(organization.id, documentId);
        if (!doc) throw new ApiError('NOT_FOUND', 'No such document');
        const copy = await store.issuing.recordCopy(organization.id, documentId, { producedByUserId: user.id, channel: c.req.valid('json').channel, requestKey: c.req.valid('header')['idempotency-key'] }, c.get('now')());
        if (!copy) throw new ApiError('NOT_FOUND', 'No such document');
        const bytes = await renderIssuedDocumentPdf(doc, { mark: copyLabel(copy.copyIndex), originalNumber: await originalNumberOf(organization.id, doc), logo: null });
        return pdf(c, bytes, `${doc.docType.toLowerCase()}-${doc.number}.pdf`);
      },
    );
  }

  if (renderIssuedDocumentPdf) registerPdfRoutes(renderIssuedDocumentPdf);

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuing/gaps',
      tags: ['Issuing'],
      summary: 'Missing document numbers, per type',
      description: 'AC5: every number from a type’s first to its last taken that has no document. Empty in normal use.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      responses: { 200: json('Gaps per type', IssuingGapsSchema), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      return c.json({ types: await store.issuing.gaps(organization.id) }, 200);
    },
  );

  return app;
}

