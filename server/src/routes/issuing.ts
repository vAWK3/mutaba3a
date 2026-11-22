import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash } from 'node:crypto';
import { parseAmount, todayFor } from '../agreements/compose.js';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { hasFeature } from '../features.js';
import { idempotent } from '../idempotency.js';
import { pastMoneyDate } from '../income/compose.js';
import { composeDocument, parseQuantity, type ComposeInput } from '../issuing/compose.js';
import { copyLabel } from '../issuing/copies.js';
import { DOC_TYPE_TITLES } from '../issuing/labels.js';
import { ISSUED_DOC_TYPES, type IssuedDocType } from '../issuing/types.js';
import { ISSUING_CORE_VERSION } from '../issuing/version.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { isMalafatFirm, notOwner, ownsProfile, profileOwnerOf, profileTypeOf } from '../personal-profile.js';
import type { CustomerRecord, IssueDocumentInput, IssuedDocumentRecord, IssuerDetailsInput, IssuerDetailsRecord, IssuingSetupRecord, JsonObject, LedgerStore, Organization } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  IssueDocumentRequestSchema,
  IssuedCopyRequestSchema,
  IssuedDocTypeParamSchema,
  IssuedDocumentIdParamSchema,
  IssuedDocumentPageSchema,
  IssuedDocumentPreviewSchema,
  IssuedDocumentSchema,
  IssuerDefaultsRequestSchema,
  IssuerDetailsRequestSchema,
  IssuerDetailsSchema,
  IssuingCounterSchema,
  IssuingGapsSchema,
  IssuingNumberingRequestSchema,
  IssuingSetupSchema,
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

/** The business details printed on a document, frozen on it at issue (MUT-646: with the logo it prints, by id). */
const issuerSnapshot = (issuer: IssuerDetailsRecord, logoId: string | null): JsonObject => ({
  legalName: issuer.legalName,
  vatId: issuer.vatId,
  dealerType: issuer.dealerType,
  address: issuer.address,
  city: issuer.city,
  phone: issuer.phone,
  email: issuer.email,
  website: issuer.website,
  ...(issuer.bankDetails ? { bankDetails: issuer.bankDetails } : {}),
  ...(issuer.footerNote ? { footerNote: issuer.footerNote } : {}),
  ...(logoId ? { logoId } : {}),
});

/** MUT-646: a logo is a PNG or a JPEG of at most this size, told apart by its first bytes (never the header's word). */
export const ISSUER_LOGO_MAX_BYTES = 256 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const logoTypeOf = (bytes: Uint8Array): 'image/png' | 'image/jpeg' | null => {
  const at = (i: number) => bytes[i] ?? -1;
  // A PNG: its signature, then an IHDR chunk with a width and height, and an IEND at the end.
  if (PNG_SIGNATURE.every((b, i) => at(i) === b)) {
    const ihdr = String.fromCharCode(at(12), at(13), at(14), at(15)) === 'IHDR';
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sized = bytes.length > 24 && size.getUint32(16) > 0 && size.getUint32(20) > 0;
    const end = String.fromCharCode(at(bytes.length - 8), at(bytes.length - 7), at(bytes.length - 6), at(bytes.length - 5)) === 'IEND';
    return ihdr && sized && end ? 'image/png' : null;
  }
  // A JPEG: its start marker, a frame header (SOF0-2) and its end marker.
  if (at(0) === 0xff && at(1) === 0xd8 && at(bytes.length - 2) === 0xff && at(bytes.length - 1) === 0xd9) {
    for (let i = 2; i < bytes.length - 1; i++) if (at(i) === 0xff && at(i + 1) >= 0xc0 && at(i + 1) <= 0xc2) return 'image/jpeg';
  }
  return null;
};

/** MUT-646 (S1-a): what still blocks issuing. The logo and the defaults are optional; the Tax Authority waits for MUT-571. */
export function setupMissing(issuer: IssuerDetailsRecord | null, setup: IssuingSetupRecord | null): ('DETAILS' | 'NUMBERING')[] {
  return [...(issuer ? [] : ['DETAILS' as const]), ...(setup?.numberingAnsweredAt ? [] : ['NUMBERING' as const])];
}

/** The details' defaults before the defaults step is saved. */
const DEFAULTS: Pick<IssuerDetailsInput, 'ink' | 'documentStyle' | 'defaultLanguage' | 'paymentTermsDays' | 'bankDetails' | 'footerNote' | 'pricesIncludeVat'> = {
  ink: 'BLACK',
  documentStyle: 'PROFESSIONAL',
  defaultLanguage: 'he',
  paymentTermsDays: null,
  bankDetails: null,
  footerNote: null,
  pricesIncludeVat: false,
};

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
export type IssuedPdfRenderer = (doc: IssuedDocumentRecord, options: { mark: 'ORIGINAL' | 'COPY' | 'DRAFT'; originalNumber: number | null; logo: Uint8Array | null }) => Promise<Uint8Array>;
export interface IssuedPdf {
  render: IssuedPdfRenderer;
  /** MUT-646: whether the PDF engine can draw this logo (checked once, at upload). */
  logoPrints(bytes: Uint8Array): Promise<boolean>;
  /** MUT-646: told when a document printed without its logo because the logo could not be drawn. */
  logoFailed?(details: { organizationId: string; documentId: string; error: unknown }): void;
}

export function issuingRoutes(store: LedgerStore, issuedPdf: IssuedPdf | null = null): OpenAPIHono<AppEnv> {
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

  /** The If-Match version, or null when the header is absent. */
  function ifMatch(c: Context<AppEnv>): number | null {
    const header = c.req.header('if-match');
    const expected = header === undefined ? null : Number(header.replace(/"/g, ''));
    if (expected !== null && !Number.isInteger(expected)) throw new ApiError('VALIDATION_FAILED', 'If-Match must be a version number', { field: 'If-Match' });
    return expected;
  }

  /** MUT-646: the logo a document prints: the one its snapshot names, else (a draft) the profile's current one. */
  async function logoBytes(organizationId: string, logoId: unknown): Promise<Uint8Array | null> {
    if (typeof logoId !== 'string') return null;
    return (await store.issuing.getLogo(organizationId, logoId))?.bytes ?? null;
  }

  /**
   * MUT-646: a document always prints. A logo the PDF engine can't read (it passed the upload's checks but is broken
   * inside) costs the logo, never the copy the customer is owed.
   */
  async function renderPdf(render: IssuedPdfRenderer, doc: IssuedDocumentRecord, options: Omit<Parameters<IssuedPdfRenderer>[1], 'logo'>): Promise<Uint8Array> {
    const logo = await logoBytes(doc.organizationId, doc.issuer.logoId);
    if (!logo) return render(doc, { ...options, logo: null });
    try {
      return await render(doc, { ...options, logo });
    } catch (error) {
      issuedPdf?.logoFailed?.({ organizationId: doc.organizationId, documentId: doc.id, error });
      return render(doc, { ...options, logo: null });
    }
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
      const expectedVersion = ifMatch(c);
      // MUT-646: the defaults have their own step (PUT /v1/issuer/defaults); saving the details keeps them.
      const current = expectedVersion === null ? null : await store.issuing.getIssuer(organization.id);
      const kept = current ? { ink: current.ink, documentStyle: current.documentStyle, defaultLanguage: current.defaultLanguage, paymentTermsDays: current.paymentTermsDays, bankDetails: current.bankDetails, footerNote: current.footerNote } : DEFAULTS;
      const input: IssuerDetailsInput = { ...kept, legalName: body.legalName, vatId: body.vatId, dealerType: body.dealerType, address: body.address ?? null, city: body.city ?? null, phone: body.phone ?? null, email: body.email ?? null, website: body.website ?? null, pricesIncludeVat: body.pricesIncludeVat ?? current?.pricesIncludeVat ?? false };
      const result = await store.issuing.putIssuer(organization.id, input, expectedVersion, c.get('now')());
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No business details yet; send them without If-Match');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      await audit(c, 'issuer_details.saved', 'issuer_details', organization.id);
      return c.json(serializeIssuer(result.record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/issuer/defaults',
      tags: ['Issuing'],
      summary: 'Set the defaults new documents start with',
      description: 'MUT-646: the style, ink, language, VAT pricing, payment terms, bank details and footer. Needs the business details first (422 ISSUER_DETAILS_REQUIRED) and their version in If-Match. Issued documents keep what they were issued with.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      request: { body: jsonBody(IssuerDefaultsRequestSchema) },
      responses: { 200: json('Saved', IssuerDetailsSchema), ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const body = c.req.valid('json');
      const expectedVersion = ifMatch(c);
      if (expectedVersion === null) throw new ApiError('VALIDATION_FAILED', 'Send the details’ version in If-Match', { field: 'If-Match' });
      const current = await mustIssuer(organization.id);
      const details = { legalName: current.legalName, vatId: current.vatId, dealerType: current.dealerType, address: current.address, city: current.city, phone: current.phone, email: current.email, website: current.website };
      const input: IssuerDetailsInput = { ...details, documentStyle: body.documentStyle, ink: body.ink, defaultLanguage: body.defaultLanguage, pricesIncludeVat: body.pricesIncludeVat, paymentTermsDays: body.paymentTermsDays ?? null, bankDetails: body.bankDetails || null, footerNote: body.footerNote || null };
      const now = c.get('now')();
      const result = await store.issuing.putIssuer(organization.id, input, expectedVersion, now);
      if (result.kind === 'not_found') throw new ApiError('VALIDATION_FAILED', 'Add the business details printed on documents first', { reason: 'ISSUER_DETAILS_REQUIRED' });
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      await store.issuing.markSetup(organization.id, 'defaultsSavedAt', now);
      await audit(c, 'issuer_details.defaults_saved', 'issuer_details', organization.id);
      return c.json(serializeIssuer(result.record), 200);
    },
  );

  const logoError = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
  app.use(
    '/v1/issuer/logo',
    bodyLimit({
      maxSize: ISSUER_LOGO_MAX_BYTES,
      onError: (c) => {
        const err = new ApiError('PAYLOAD_TOO_LARGE', `A logo is at most ${ISSUER_LOGO_MAX_BYTES / 1024} KB`);
        return c.json(err.toEnvelope(c.get('requestId')), err.status);
      },
    }),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/issuer/logo',
      tags: ['Issuing'],
      summary: 'Set the logo printed on documents',
      description: `MUT-646: the raw PNG or JPEG file, at most ${ISSUER_LOGO_MAX_BYTES / 1024} KB (413 beyond). The type is read from the file itself (422 LOGO_NOT_AN_IMAGE). Each upload is kept unchanged, so documents already issued go on printing the logo they were issued with.`,
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      request: { body: { required: true, content: { 'image/png': { schema: z.string().openapi({ format: 'binary' }) }, 'image/jpeg': { schema: z.string().openapi({ format: 'binary' }) } } } },
      responses: { 204: { description: 'Saved' }, 413: logoError('PAYLOAD_TOO_LARGE'), ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.length > ISSUER_LOGO_MAX_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', `A logo is at most ${ISSUER_LOGO_MAX_BYTES / 1024} KB`);
      const contentType = logoTypeOf(bytes);
      if (!contentType || (issuedPdf && !(await issuedPdf.logoPrints(bytes)))) throw new ApiError('VALIDATION_FAILED', 'A logo is a PNG or a JPEG file', { field: 'body', reason: 'LOGO_NOT_AN_IMAGE' });
      const logo = await store.issuing.addLogo(organization.id, { contentType, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }, c.get('now')());
      await audit(c, 'issuer_logo.saved', 'issuer_details', organization.id, { logoId: logo.id, bytes: bytes.length });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuer/logo',
      tags: ['Issuing'],
      summary: 'The logo printed on new documents',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      responses: { 200: { description: 'The image', content: { 'image/png': { schema: z.string().openapi({ format: 'binary' }) }, 'image/jpeg': { schema: z.string().openapi({ format: 'binary' }) } } }, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      const setup = await store.issuing.getSetup(organization.id);
      const logo = setup?.logoId ? await store.issuing.getLogo(organization.id, setup.logoId) : null;
      if (!logo) throw new ApiError('NOT_FOUND', 'No logo');
      return c.body(logo.bytes as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': logo.contentType, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/issuer/logo',
      tags: ['Issuing'],
      summary: 'Print new documents without a logo',
      description: 'MUT-646: issued documents keep theirs.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      responses: { 204: { description: 'Removed' }, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      await store.issuing.clearLogo(organization.id, c.get('now')());
      await audit(c, 'issuer_logo.removed', 'issuer_details', organization.id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/issuing/numbering',
      tags: ['Issuing'],
      summary: 'Answer “already issuing documents elsewhere?”',
      description:
        'MUT-646: one answer, needed before the first document. `alreadyIssuing: false` starts every type without documents at 1 (undoing an earlier answer); `true` sets the next number of each type in `starts` (at least one), under the D3 rule: 409 HAS_DOCUMENTS, with nothing changed, when one of them has a document. Sending the same answer again is harmless.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      request: { body: jsonBody(IssuingNumberingRequestSchema) },
      responses: { 200: json('Answered', IssuingSetupSchema), ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const { alreadyIssuing, starts } = c.req.valid('json');
      const entries = (Object.entries(starts ?? {}) as [IssuedDocType, number | undefined][]).filter((e): e is [IssuedDocType, number] => e[1] !== undefined);
      if (alreadyIssuing && entries.length === 0) throw new ApiError('VALIDATION_FAILED', 'Say where the numbering continues for at least one document type', { field: 'starts', reason: 'STARTS_REQUIRED' });
      if (!alreadyIssuing && entries.length > 0) throw new ApiError('VALIDATION_FAILED', 'Starting numbers go with alreadyIssuing: true', { field: 'starts', reason: 'FIELD_NOT_ALLOWED' });
      // Review fix: refuse before changing anything, so a refused answer is never half applied.
      const counters = await store.issuing.counters(organization.id);
      const issued = new Set(counters.filter((k) => k.next > k.start).map((k) => k.docType));
      const fixed = entries.find(([docType]) => issued.has(docType));
      if (fixed) throw new ApiError('CONFLICT', 'Documents of this type were already issued; their numbering is fixed', { reason: 'HAS_DOCUMENTS', docType: fixed[0] });
      // "No" puts every type without documents back to 1, so a corrected answer never leaves an earlier "yes" behind.
      const sets: [IssuedDocType, number][] = alreadyIssuing ? entries : counters.filter((k) => !issued.has(k.docType) && k.start !== 1).map((k) => [k.docType, 1]);
      for (const [docType, start] of sets) {
        const result = await store.issuing.setStartingNumber(organization.id, docType, start);
        if (result.kind === 'has_documents') throw new ApiError('CONFLICT', 'Documents of this type were already issued; their numbering is fixed', { reason: 'HAS_DOCUMENTS', docType });
      }
      await store.issuing.markSetup(organization.id, 'numberingAnsweredAt', c.get('now')());
      await audit(c, 'issuing.numbering_answered', 'issuer_details', organization.id, { alreadyIssuing, ...(entries.length ? { starts: Object.fromEntries(entries) } : {}) });
      return c.json(await setupOf(organization.id), 200);
    },
  );

  async function setupOf(organizationId: string) {
    const [issuer, setup] = await Promise.all([store.issuing.getIssuer(organizationId), store.issuing.getSetup(organizationId)]);
    const missing = setupMissing(issuer, setup);
    const done = (ok: boolean) => (ok ? ('done' as const) : ('todo' as const));
    return {
      steps: { details: done(!!issuer), logo: done(!!setup?.logoId), defaults: done(!!setup?.defaultsSavedAt), numbering: done(!!setup?.numberingAnsweredAt), taxAuthority: 'later' as const },
      canIssue: missing.length === 0,
      missing,
      introSeen: !!setup?.introSeenAt,
      hasLogo: !!setup?.logoId,
    };
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuing/setup',
      tags: ['Issuing'],
      summary: 'Where this profile stands in the invoicing setup',
      description: 'MUT-646: the five steps; `canIssue` once the business details and the numbering answer are in (`missing` says which is not). The Tax Authority step stays `later` until the connection exists (MUT-571).',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      responses: { 200: json('The setup', IssuingSetupSchema), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      return c.json(await setupOf(organization.id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/issuing/setup/intro-seen',
      tags: ['Issuing'],
      summary: 'The introduction to issuing was read',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      responses: { 200: json('The setup', IssuingSetupSchema), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      await store.issuing.markSetup(organization.id, 'introSeenAt', c.get('now')());
      return c.json(await setupOf(organization.id), 200);
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
        'Irreversible: the document takes the next number of its type and is never changed or removed (a credit note corrects a tax invoice). It posts its money: a tax invoice an Owed, an invoice-receipt an Owed paid in full, a receipt a Received (paying appliesToDocumentId when given), a credit note a credit on its tax invoice up to what is still owed (422 ORIGINAL_PAID beyond). The date may not be in the future nor before the last document of its type (422 DATE_BEFORE_LAST_DOCUMENT). Sending the same Idempotency-Key again returns the same document. MUT-646: 409 ISSUING_SETUP_INCOMPLETE (`details.missing`) until the business details and the numbering answer are in.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write'), idempotent(store, 'issued_document.issue')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(IssueDocumentRequestSchema) },
      responses: { 201: json('Issued', IssuedDocumentSchema), ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const { user } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      // MUT-646 (S1-a): nothing is issued until the business details and the numbering answer are in.
      const [current, setup] = await Promise.all([store.issuing.getIssuer(organization.id), store.issuing.getSetup(organization.id)]);
      const missing = setupMissing(current, setup);
      if (missing.length > 0) throw new ApiError('CONFLICT', 'Finish the invoicing setup before issuing', { reason: 'ISSUING_SETUP_INCOMPLETE', missing });
      const issuer = current!;
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
        issuer: issuerSnapshot(issuer, setup?.logoId ?? null),
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
          issuer: issuerSnapshot(issuer, (await store.issuing.getSetup(organization.id))?.logoId ?? null),
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
        const bytes = await renderPdf(renderIssuedDocumentPdf, draft, { mark: 'DRAFT', originalNumber: original?.number ?? paid?.number ?? null });
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
        const bytes = await renderPdf(renderIssuedDocumentPdf, doc, { mark: 'COPY', originalNumber: await originalNumberOf(organization.id, doc) });
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
        const bytes = await renderPdf(renderIssuedDocumentPdf, doc, { mark: copyLabel(copy.copyIndex), originalNumber: await originalNumberOf(organization.id, doc) });
        return pdf(c, bytes, `${doc.docType.toLowerCase()}-${doc.number}.pdf`);
      },
    );
  }

  if (issuedPdf) registerPdfRoutes(issuedPdf.render);

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

