import { createHash } from 'node:crypto';
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { todayFor } from '../agreements/compose.js';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import { documentsDue, olderThan, type DocumentsDueInput, type DueItem } from '../issuing/documents-due.js';
import { DEFAULT_LINE_DESCRIPTION, DOCUMENT_LANGUAGES, type DocumentLanguage } from '../issuing/labels.js';
import { formatMoney, type Currency } from '../money.js';
import type { IssuedDocumentRecord, JsonObject, LedgerStore, NotForInvoiceItem, Organization } from '../repositories/ports.js';
import type { IssueDocumentRequestSchema } from '../schemas.js';
import {
  DocumentsDueCountSchema,
  DocumentsDueQuerySchema,
  DocumentsDueSchema,
  IfMatchHeaderSchema,
  IssueDueRequestSchema,
  IssueDueResultSchema,
  NotForInvoiceEntrySchema,
  NotForInvoiceRequestSchema,
  NotForInvoiceResultSchema,
  SetNotForInvoiceRequestSchema,
  SettleAndIssueRequestSchema,
  SettleAndIssueResponseSchema,
} from '../schemas.js';
import { serializeIssuedDocument } from '../serializers.js';
import { isSettleableOrigin, settleOwed } from './receivables.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse } from './shared.js';

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const json = <T>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } });

/**
 * MUT-660 (ADR-270): documents due per client. The list and its count are derived on each read (`documentsDue`);
 * Issue all goes through the same single issue as POST /v1/issued-documents, one document per item, in sequence.
 * Same gate as every issuing route: 404 unless invoicing is on; writes are the owner's.
 */

type IssueRequest = z.infer<typeof IssueDocumentRequestSchema>;
type EntryKind = 'owed' | 'received';
const ReceivableParamSchema = z.object({ receivableId: z.string().uuid() });
const PaymentParamSchema = z.object({ paymentId: z.string().uuid() });

export interface DocumentsDueDeps {
  store: LedgerStore;
  issuingProfile: (c: Context<AppEnv>, write: boolean) => Promise<Organization>;
  issueOne: (c: Context<AppEnv>, organization: Organization, body: IssueRequest, requestKey: string) => Promise<{ document: IssuedDocumentRecord; created: boolean }>;
  audit: (c: Context<AppEnv>, action: string, entityType: string, entityId: string, metadata?: JsonObject) => Promise<unknown>;
}

/** Issue all: at most this many documents per call (each one may ask the Tax Authority for a number, MUT-572). */
export const ISSUE_ALL_MAX = 25;

/** A row of either view: a due document, or (not-for-invoice view, kind null) an entry marked not for invoice. */
type ViewItem = Omit<DueItem, 'kind'> & { kind: DueItem['kind'] | null };

const storeKind = (kind: EntryKind): NotForInvoiceItem['kind'] => (kind === 'owed' ? 'receivable' : 'payment');
const apiKind = (kind: NotForInvoiceItem['kind']): EntryKind => (kind === 'receivable' ? 'owed' : 'received');

export function notForInvoiceItems(inputs: DocumentsDueInput): ViewItem[] {
  const owed = inputs.receivables
    .filter((r) => r.notForInvoice && !r.deleted && r.origin !== 'ISSUED_DOCUMENT')
    .map((r): ViewItem => ({ kind: null, entry: { kind: 'receivable', id: r.id, number: r.number }, customerId: r.customerId, amountMinor: r.grossMinor - r.creditedMinor, currency: r.currency, date: r.postingDate, issuable: false, linkOnly: false }));
  const received = inputs.payments
    .filter((p) => p.notForInvoice)
    .map((p): ViewItem => ({ kind: null, entry: { kind: 'payment', id: p.id, number: p.number }, customerId: p.customerId, amountMinor: p.amountMinor, currency: p.currency, date: p.receivedOn, issuable: false, linkOnly: false }));
  return [...owed, ...received].sort((a, b) => (a.customerId ?? '￿').localeCompare(b.customerId ?? '￿') || a.date.localeCompare(b.date));
}

function serializeItem(i: ViewItem) {
  return {
    kind: i.kind,
    entry: { kind: apiKind(i.entry.kind), id: i.entry.id, number: i.entry.number },
    customerId: i.customerId,
    amount: formatMoney({ minor: i.amountMinor, currency: i.currency as Currency }),
    currency: i.currency as Currency,
    date: i.date,
    issuable: i.issuable,
    reason: i.reason ?? null,
    appliesToDocumentId: i.appliesToDocumentId ?? null,
  };
}

function grouped(items: readonly ViewItem[]) {
  const groups = new Map<string | null, ViewItem[]>();
  for (const i of items) groups.set(i.customerId, [...(groups.get(i.customerId) ?? []), i]);
  return [...groups.entries()].map(([customerId, list]) => ({ customerId, items: list.map(serializeItem) }));
}

function countsOf(items: readonly ViewItem[]) {
  const byKind: Record<string, number> = {};
  for (const i of items) if (i.kind) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  return { total: items.length, byKind };
}

/** Each item's own idempotency key, so a retried batch never issues an item twice. */
function itemKey(batchKey: string, entryId: string): string {
  return `due:${createHash('sha256').update(`${batchKey}\u0000${entryId}`).digest('hex').slice(0, 64)}`;
}

function languageOf(value: string): DocumentLanguage {
  return (DOCUMENT_LANGUAGES as readonly string[]).includes(value) ? (value as DocumentLanguage) : 'he';
}

export function registerDocumentsDueRoutes(app: OpenAPIHono<AppEnv>, deps: DocumentsDueDeps): void {
  const { store, issuingProfile, issueOne, audit } = deps;

  /** The single issue for one due item: one line for its amount, VAT included, linked to its entry (MUT-648's shape). */
  async function requestFor(organization: Organization, item: DueItem, today: string): Promise<IssueRequest> {
    const issuer = await store.issuing.getIssuer(organization.id);
    const language = languageOf(issuer?.defaultLanguage ?? 'he');
    const owed = item.entry.kind === 'receivable' ? await store.receivables.getById(organization.id, item.entry.id) : null;
    const description = owed?.title?.trim() || DEFAULT_LINE_DESCRIPTION[language];
    return {
      docType: item.kind as IssueRequest['docType'],
      documentDate: today,
      currency: 'ILS',
      language,
      customerId: item.customerId,
      ...(owed && owed.dueDate >= today ? { dueDate: owed.dueDate } : {}),
      ...(item.appliesToDocumentId ? { appliesToDocumentId: item.appliesToDocumentId } : {}),
      fromEntry: { kind: apiKind(item.entry.kind), id: item.entry.id },
      pricesIncludeVat: true,
      lines: [{ description, kind: 'SERVICE', quantity: '1', unitPrice: formatMoney({ minor: item.amountMinor, currency: 'ILS' }), pricesIncludeVat: true }],
    } as IssueRequest;
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/documents-due',
      tags: ['Issuing'],
      summary: 'Documents due, grouped by client',
      description:
        'MUT-660: what each income entry is due, derived from the client’s documents preference (else the profile default) and what is issued or attached; never stored. view=not-for-invoice lists the entries marked not for invoice instead (kind null). olderThanMonths keeps items dated before today minus N months. Groups are by customerId (null: no client), in the order the items sort; the client’s name is the caller’s. 404 unless invoicing is on.',
      security: [{ session: [] }, { deviceSession: [] }],
      middleware: [requireScope('issuing:read')] as const,
      request: { query: DocumentsDueQuerySchema },
      responses: { 200: json('The documents due', DocumentsDueSchema), ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      const q = c.req.valid('query');
      const inputs = await store.issuing.dueInputs(organization.id);
      const all: ViewItem[] = q.view === 'not-for-invoice' ? notForInvoiceItems(inputs) : documentsDue(inputs);
      const items = olderThan(all, q.olderThanMonths, todayFor(organization, c.get('now')()));
      return c.json({ view: q.view, groups: grouped(items), counts: countsOf(items) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/documents-due/count',
      tags: ['Issuing'],
      summary: 'How many documents are due (Home’s To issue)',
      description: 'MUT-660: every listed item counts (N2), including those that can’t be issued in MTB3A yet (they can be attached or marked). 404 unless invoicing is on.',
      security: [{ session: [] }, { deviceSession: [] }],
      middleware: [requireScope('issuing:read')] as const,
      responses: { 200: json('The count', DocumentsDueCountSchema), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, false);
      return c.json({ total: documentsDue(await store.issuing.dueInputs(organization.id)).length }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/documents-due/issue',
      tags: ['Issuing'],
      summary: 'Issue all: one client’s due documents, each with its type and amount',
      description: `MUT-660: issues each item (at most ${ISSUE_ALL_MAX}, one client per call) in turn, through the same single issue as POST /v1/issued-documents: a tax invoice, receipt or invoice-receipt linked to its entry, dated today, one line for its amount with VAT included. Each item answers issued, held (the Tax Authority held its allocation number: issue it on its own to choose) or refused (NOT_DUE, OTHER_CLIENT, a DueReason, or the issue’s own reason). Irreversible per item. The same Idempotency-Key returns the same answer, and an item is never issued twice. 409 ISSUING_SETUP_INCOMPLETE before the setup is done.`,
      security: [{ session: [] }, { deviceSession: [] }],
      middleware: [requireScope('issuing:write'), idempotent(store, 'documents_due.issue')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(IssueDueRequestSchema) },
      responses: { 200: json('What happened to each item', IssueDueResultSchema), ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const body = c.req.valid('json');
      const batchKey = c.req.valid('header')['idempotency-key'];
      const today = todayFor(organization, c.get('now')());
      const due = documentsDue(await store.issuing.dueInputs(organization.id));
      const results = [];
      for (const ref of body.items) {
        const item = due.find((d) => d.entry.id === ref.id && apiKind(d.entry.kind) === ref.kind);
        const refused = (reason: string) => ({ entry: ref, status: 'refused' as const, reason, document: null });
        if (!item) results.push(refused('NOT_DUE'));
        else if (item.customerId !== body.customerId) results.push(refused('OTHER_CLIENT'));
        else if (!item.issuable) results.push(refused(item.reason ?? 'NOT_ISSUABLE'));
        else {
          try {
            const { document } = await issueOne(c, organization, await requestFor(organization, item, today), itemKey(batchKey, ref.id));
            results.push({ entry: ref, status: 'issued' as const, reason: null, document: serializeIssuedDocument(document) });
          } catch (err) {
            if (!(err instanceof ApiError)) throw err;
            const reason = String((err.details as { reason?: unknown } | undefined)?.reason ?? err.code);
            if (reason === 'ISSUING_SETUP_INCOMPLETE') throw err;
            results.push({ entry: ref, status: reason === 'ALLOCATION_HELD' ? ('held' as const) : ('refused' as const), reason, document: null });
          }
        }
      }
      return c.json({ results, issued: results.filter((r) => r.status === 'issued').length }, 200);
    },
  );

  /** The key a payment's own document is issued under: derived from the request's key and the payment, so a retry never issues twice. */
  const paymentDocumentKey = (key: string, paymentId: string) => `pay:${createHash('sha256').update(`${key}\u0000${paymentId}`).digest('hex').slice(0, 64)}`;

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receivables/{receivableId}/settle-and-issue',
      tags: ['Issuing'],
      summary: 'Record a payment against an Owed and issue its document in the same step',
      description:
        'MUT-661 (ADR-279): the payment is recorded exactly as POST /v1/receivables/{id}/settle records it (the amount defaults to what is outstanding, paidAt to today). Then, unless issue is false, the document that payment is due (MUT-660, derived from the client’s documents preference: a receipt on the Owed’s tax invoice, or an invoice-receipt for the amount paid; a payment request first client’s payment gets the document that refers to its request) is issued through the same single issue as POST /v1/issued-documents, linked to the payment. The payment is the commitment: if issuing is refused (no allocation number, the Tax Authority held it, the setup incomplete) the answer is still 201, issue.status says held or failed and why, and the document stays in To issue. A payment due no document (a No document client, marked not for invoice) answers issue.status not_due. The Idempotency-Key covers both: a retry returns the payment recorded before and the document issued before, never a second of either. 404 unless invoicing is on for the profile; 403 for a profile the person doesn’t own.',
      security: [{ session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:write'), requireScope('issuing:write'), idempotent(store, 'receivables.settle_and_issue')] as const,
      request: { params: ReceivableParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(SettleAndIssueRequestSchema) },
      responses: { 201: json('Recorded, and issued where it could be', SettleAndIssueResponseSchema), ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const { issue, ...settleBody } = c.req.valid('json');
      const key = c.req.valid('header')['idempotency-key'];
      const receivable = await store.receivables.getById(organization.id, c.req.valid('param').receivableId);
      if (!receivable || !isSettleableOrigin(receivable)) throw new ApiError('NOT_FOUND', 'No such receivable');
      const settled = await settleOwed(store, c, receivable, settleBody);
      const done = (status: 'issued' | 'not_requested' | 'not_due' | 'held' | 'failed', reason: string | null, document: IssuedDocumentRecord | null) =>
        c.json({ receivable: settled.receivable, payment: settled.payment, issue: { status, reason, document: document ? serializeIssuedDocument(document) : null } }, 201);
      if (issue === false) return done('not_requested', null, null);
      const paymentId = settled.payment.id;
      const documentKey = paymentDocumentKey(key, paymentId);
      // A retry after the document was issued: answer with it (the payment is no longer due one).
      const existing = await store.issuing.moneyDocumentOn(organization.id, paymentId);
      if (existing) {
        const document = await store.issuing.getById(organization.id, existing.id);
        if (document) return done('issued', null, document);
      }
      const item = documentsDue(await store.issuing.dueInputs(organization.id)).find((d) => d.entry.kind === 'payment' && d.entry.id === paymentId);
      if (!item) return done('not_due', 'NOT_DUE', null);
      if (!item.issuable) return done('failed', item.reason ?? 'NOT_ISSUABLE', null);
      try {
        const { document } = await issueOne(c, organization, await requestFor(organization, item, todayFor(organization, c.get('now')())), documentKey);
        return done('issued', null, document);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        const reason = String((err.details as { reason?: unknown } | undefined)?.reason ?? err.code);
        return done(reason === 'ALLOCATION_HELD' ? 'held' : 'failed', reason, null);
      }
    },
  );

  async function mark(c: Context<AppEnv>, organization: Organization, items: NotForInvoiceItem[], value: boolean) {
    const result = await store.issuing.setNotForInvoice(organization.id, items, value, c.get('now')());
    switch (result.kind) {
      case 'not_found':
        throw new ApiError('NOT_FOUND', 'No such entry', { kind: apiKind(result.item.kind), id: result.item.id });
      case 'stale':
        throw new ApiError('CONFLICT', 'The entry changed since you read it', { reason: 'VERSION_MISMATCH', currentVersion: result.version });
      case 'has_tax_document':
        throw new ApiError('CONFLICT', 'This entry has a tax document; issue a credit note first', { reason: 'HAS_TAX_DOCUMENT', kind: apiKind(result.item.kind), id: result.item.id });
      case 'done':
        return result;
    }
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/documents-due/not-for-invoice',
      tags: ['Issuing'],
      summary: 'Mark entries not for invoice, or bring them back (bulk)',
      description:
        'MUT-660: all or nothing, in one transaction. A marked entry is due no document and counts outside Invoice income (it stays in All income, the accountant’s view and exports). An entry already at `value` is left alone, so a replay changes nothing (`changed` counts what changed). Marking an entry with a tax document (a live tax invoice or an invoice-receipt; a receipt doesn’t count) is 409 HAS_TAX_DOCUMENT and changes nothing: a credit note comes first.',
      security: [{ session: [] }, { deviceSession: [] }],
      middleware: [requireScope('issuing:write'), idempotent(store, 'documents_due.not_for_invoice')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(NotForInvoiceRequestSchema) },
      responses: { 200: json('Done', NotForInvoiceResultSchema), ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const organization = await issuingProfile(c, true);
      const body = c.req.valid('json');
      const result = await mark(c, organization, body.items.map((i: { kind: EntryKind; id: string }) => ({ kind: storeKind(i.kind), id: i.id })), body.value);
      if (result.changed > 0) await audit(c, body.value ? 'documents_due.marked_not_for_invoice' : 'documents_due.unmarked_not_for_invoice', 'organization', organization.id, { count: result.changed });
      return c.json({ changed: result.changed }, 200);
    },
  );

  for (const kind of ['owed', 'received'] as const) {
    const path = kind === 'owed' ? '/v1/receivables/{receivableId}/not-for-invoice' : '/v1/payments/{paymentId}/not-for-invoice';
    app.openapi(
      createRoute({
        method: 'put',
        path,
        tags: ['Issuing'],
        summary: kind === 'owed' ? 'Mark an Owed entry not for invoice, or bring it back' : 'Mark a Received entry not for invoice, or bring it back',
        description: 'MUT-660: the single-entry form of POST /v1/documents-due/not-for-invoice, with the version you read in If-Match (409 VERSION_MISMATCH otherwise). Setting the value it already has answers 200 unchanged. 409 HAS_TAX_DOCUMENT as there.',
        security: [{ session: [] }, { deviceSession: [] }],
        middleware: [requireScope('issuing:write'), ifMatch()] as const,
        request: { params: kind === 'owed' ? ReceivableParamSchema : PaymentParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(SetNotForInvoiceRequestSchema) },
        responses: { 200: json('Set', NotForInvoiceEntrySchema), ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
      }),
      async (c) => {
        const organization = await issuingProfile(c, true);
        const params = c.req.valid('param') as { receivableId?: string; paymentId?: string };
        const id = (params.receivableId ?? params.paymentId)!;
        const result = await mark(c, organization, [{ kind: storeKind(kind), id, expectedVersion: c.get('expectedVersion') }], c.req.valid('json').value);
        const record = kind === 'owed' ? result.receivables[0] : result.payments[0];
        if (!record) throw new ApiError('NOT_FOUND', 'No such entry');
        if (result.changed > 0) await audit(c, record.notForInvoice ? 'documents_due.marked_not_for_invoice' : 'documents_due.unmarked_not_for_invoice', kind === 'owed' ? 'receivable' : 'payment', id, { count: 1 });
        return c.json({ kind, id, notForInvoice: record.notForInvoice, version: record.version }, 200);
      },
    );
  }
}
