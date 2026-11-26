import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { actorOf, keyAuth, lazyPostingOf, requireScope, type AppEnv } from '../auth/middleware.js';
import { todayFor, validationError } from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import { buildStatement, decodeStatementCursor } from '../statements/build.js';
import { serializeStatement } from '../statements/serialize.js';
import { statementTags, type StatementLineTags } from '../statements/tags.js';
import { customerBalances } from '../statements/balances.js';
import { ledgerEntries } from '../statements/lines.js';
import { formatMoney, type Currency } from '../money.js';
import type { StatementLine } from '../statements/build.js';
import { documentsDue } from '../issuing/documents-due.js';
import { invoicingOn } from '../issuing/invoicing-on.js';
import { ApiError } from '../errors.js';
import { normalizeTaxId } from '../israel/tax-id.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import { UniqueViolation } from '../repositories/memory.js';
import type { CustomerRecord, IssuedDocumentRecord, LedgerStore, Organization, UpdateCustomerPatch } from '../repositories/ports.js';
import {
  CreateCustomerRequestSchema,
  CustomerBalancesSchema,
  CustomerIdParamSchema,
  CustomerPageSchema,
  CustomerSchema,
  CustomerStatementQuerySchema,
  CustomerStatementSchema,
  IfMatchHeaderSchema,
  ListCustomersQuerySchema,
  UpdateCustomerRequestSchema,
} from '../schemas.js';
import { serializeCustomer } from '../serializers.js';
import { issuingProfileOf } from './issuing.js';
import {
  conflictResponse,
  encodeNextCursor,
  errorResponses,
  IdempotencyHeaderSchema,
  notFoundResponse,
  referencesByEntity,
  requireConnectedIntegration,
  toPageRequest,
  validationResponse,
  versionMismatch,
} from './shared.js';

const customerJson = { content: { 'application/json': { schema: CustomerSchema } } };

/** /v1/customers — the party money is owed by (M2 brief §2.2). */

/** MUT-642: a customer's VAT, company or ID number, normalised to 9 digits, or 422 TAX_ID_INVALID. */
function validTaxId(raw: string): string {
  const taxId = normalizeTaxId(raw);
  if (!taxId) throw new ApiError('VALIDATION_FAILED', 'Not a valid VAT, company or ID number (9 digits with the check digit)', { field: 'taxId', reason: 'TAX_ID_INVALID' });
  return taxId;
}
export function customerRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/customers',
      tags: ['Customers'],
      summary: 'Create a customer',
      description:
        'With `externalReference`, creation is idempotent on that reference: a known reference returns the existing customer with 200 and changes nothing. Requires a CONNECTED integration for the provider. A session may create a customer on its own personal profile (MUT-65); it has no external reference to link, so externalReference is refused there.',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('customers:write'), idempotent(store, 'customers.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: { required: true, content: { 'application/json': { schema: CreateCustomerRequestSchema } } } },
      responses: {
        200: { description: 'Already exists for this external reference', ...customerJson },
        201: { description: 'Created', ...customerJson },
        ...conflictResponse,
        ...validationResponse,
        ...errorResponses,
      },
    }),
    async (c) => {
      const auth = c.get('auth');
      const { organization } = auth;
      const actor = actorOf(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const reference = body.externalReference;

      if (auth.kind === 'session' && reference) {
        throw validationError('EXTERNAL_REFERENCE_NOT_ALLOWED', 'A session has no external reference to link', { field: 'externalReference' });
      }

      if (reference) {
        await requireConnectedIntegration(store, organization.id, reference.provider);
        const existing = await findByReference(store, organization.id, reference);
        if (existing) return c.json(serializeCustomer(existing.customer, existing.ref), 200);
      }

      let customer: CustomerRecord;
      try {
        customer = await store.customers.create(
          { organizationId: organization.id, name: body.name, email: body.email ?? null, phone: body.phone ?? null, notes: body.notes ?? null, vatTreatment: body.vatTreatment ?? null, taxId: body.taxId?.trim() ? validTaxId(body.taxId) : null, address: body.address?.trim() || null },
          now,
          reference,
        );
      } catch (err) {
        if (err instanceof UniqueViolation && reference) {
          const raced = await findByReference(store, organization.id, reference);
          if (raced) return c.json(serializeCustomer(raced.customer, raced.ref), 200);
        }
        throw err;
      }

      await store.audit.append({
        organizationId: organization.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'customer.created',
        entityType: 'customer',
        entityId: customer.id,
        ...(reference ? { metadata: { externalReference: reference } } : {}),
        requestId: c.get('requestId'),
      });
      const ref = reference ? await store.externalReferences.findByExternalId(organization.id, reference.provider, 'CUSTOMER', reference.externalId) : null;
      return c.json(serializeCustomer(customer, ref), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/customers',
      tags: ['Customers'],
      summary: 'List customers',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('customers:read')] as const,
      request: { query: ListCustomersQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: CustomerPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const page = await store.customers.list(
        organization.id,
        { ...(q.status ? { status: q.status } : {}), ...(q.externalId ? { provider: q.provider, externalId: q.externalId } : {}) },
        toPageRequest(q),
      );
      const refs = await referencesByEntity(store, organization.id, 'CUSTOMER', page.items.map((i) => i.id));
      return c.json({ items: page.items.map((i) => serializeCustomer(i, refs.get(i.id))), nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/customers/{customerId}',
      tags: ['Customers'],
      summary: 'Get a customer',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('customers:read')] as const,
      request: { params: CustomerIdParamSchema },
      responses: { 200: { description: 'The customer', ...customerJson }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const customer = await mustGet(store, organization.id, c.req.valid('param').customerId);
      const refs = await referencesByEntity(store, organization.id, 'CUSTOMER', [customer.id]);
      return c.json(serializeCustomer(customer, refs.get(customer.id)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/customers/{customerId}',
      tags: ['Customers'],
      summary: 'Update a customer (optimistic, If-Match)',
      description: 'MUT-642: a session may update a customer on a profile it writes (its own, not a Malafat-fed one), e.g. to add the VAT number and address an issued document needs.',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('customers:write'), ifMatch()] as const,
      request: { params: CustomerIdParamSchema, headers: IfMatchHeaderSchema, body: { required: true, content: { 'application/json': { schema: UpdateCustomerRequestSchema } } } },
      responses: { 200: { description: 'Updated', ...customerJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const actor = actorOf(c);
      const body = c.req.valid('json');
      const patch: UpdateCustomerPatch = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.email !== undefined) patch.email = body.email;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.vatTreatment !== undefined) patch.vatTreatment = body.vatTreatment;
      if (body.taxId !== undefined) patch.taxId = body.taxId?.trim() ? validTaxId(body.taxId) : null;
      if (body.address !== undefined) patch.address = body.address?.trim() || null;
      // MUT-660: a person sets it, on an invoicing profile only (an API key or Malafat gets 404, as the issuing routes do).
      if (body.documentsPreference !== undefined) {
        await issuingProfileOf(store, c, false);
        patch.documentsPreference = body.documentsPreference;
      }

      const result = await store.customers.update(organization.id, c.req.valid('param').customerId, c.get('expectedVersion'), patch, c.get('now')());
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such customer');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);

      await store.audit.append({
        organizationId: organization.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: result.record.id,
        metadata: { fields: Object.keys(patch), version: result.record.version },
        requestId: c.get('requestId'),
      });
      const refs = await referencesByEntity(store, organization.id, 'CUSTOMER', [result.record.id]);
      return c.json(serializeCustomer(result.record, refs.get(result.record.id)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/customers/{customerId}/archive',
      tags: ['Customers'],
      summary: 'Archive a customer',
      description: 'Idempotent. Refused with 409 HAS_ACTIVE_PROJECTS while any of its projects is ACTIVE. Nothing is ever deleted.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('customers:write'), idempotent(store, 'customers.archive')] as const,
      request: { params: CustomerIdParamSchema, headers: IdempotencyHeaderSchema },
      responses: { 200: { description: 'Archived (or already was)', ...customerJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const customer = await mustGet(store, organization.id, c.req.valid('param').customerId);
      const refs = await referencesByEntity(store, organization.id, 'CUSTOMER', [customer.id]);
      if (customer.status === 'ARCHIVED') return c.json(serializeCustomer(customer, refs.get(customer.id)), 200);

      const activeProjects = await store.projects.countActiveByCustomer(organization.id, customer.id);
      if (activeProjects > 0) {
        throw new ApiError('CONFLICT', 'Archive or move the customer’s active projects first', { reason: 'HAS_ACTIVE_PROJECTS', activeProjects });
      }
      const archived = await store.customers.archive(organization.id, customer.id, c.get('now')());
      if (!archived) throw new ApiError('NOT_FOUND', 'No such customer');
      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'customer.archived',
        entityType: 'customer',
        entityId: archived.id,
        requestId: c.get('requestId'),
      });
      return c.json(serializeCustomer(archived, refs.get(archived.id)), 200);
    },
  );

  // ---- MUT-664: every client's balance (MUT-663's Clients list) ----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/customer-balances',
      tags: ['Customers'],
      summary: 'Every client\'s balance per currency',
      description: 'MUT-664: per client and currency, the closing balance of the whole statement with no period (charges − credits − payments + reversals). Negative: the client is in credit. Clients with no movement are absent; money with no client is not here. Dated installments whose date has arrived are posted first, as on the statement.',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:read')] as const,
      responses: { 200: { description: 'The balances', content: { 'application/json': { schema: CustomerBalancesSchema } } }, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const now = c.get('now')();
      const asOf = todayFor(organization, now);
      const posting = lazyPostingOf(c, store);
      await postDueItems(posting.store, organization, asOf, now, posting.actor);
      const rows = await store.receivables.periodSources(organization.id, null);
      const balances = customerBalances(ledgerEntries(rows, { asOf, timezone: organization.timezone }));
      return c.json({ asOf, balances: balances.map((b) => ({ customerId: b.customerId, currency: b.currency as Currency, balance: formatMoney({ minor: b.balanceMinor, currency: b.currency as Currency }) })) }, 200);
    },
  );

  // ---- MUT-478: the customer statement (ledger card) ----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/customers/{customerId}/statement',
      tags: ['Customers'],
      summary: 'The customer statement: dated charges, credits, payments and reversals with a running balance, in one currency',
      description:
        'Oldest first. Charges are debits; credits, payments are credits; a reversed payment shows its PAYMENT line and a PAYMENT_REVERSAL debit. Amounts are gross. With no projectId and no period, closingBalance equals the customer summary\'s outstanding − unallocated for the currency. Lines before `from` fold into openingBalance; openingBalance, totals and closingBalance are the whole period\'s and the same on every page, and runningBalance carries across pages. A project statement shows payments as their allocations to that project; unallocated money appears only on the whole-customer statement. Dated installments and retainer charges whose date has arrived are posted first.',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { params: CustomerIdParamSchema, query: CustomerStatementQuerySchema },
      responses: { 200: { description: 'One page of the statement', content: { 'application/json': { schema: CustomerStatementSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const now = c.get('now')();
      const asOf = todayFor(organization, now);
      if (q.from && q.to && q.from > q.to) throw validationError('PERIOD_INVALID', 'from must not be after to', { field: 'from' });
      const customer = await mustGet(store, organization.id, c.req.valid('param').customerId);
      if (q.projectId) {
        const project = await store.projects.getById(organization.id, q.projectId);
        if (!project || project.customerId !== customer.id) throw validationError('PROJECT_NOT_FOUND', "projectId does not name one of this customer's projects", { field: 'projectId' });
      }
      const cursor = q.cursor ? decodeStatementCursor(q.cursor) : null;
      const posting = lazyPostingOf(c, store);
      await postDueItems(posting.store, organization, asOf, now, posting.actor);
      const sources = await store.receivables.statementSources(organization.id, customer.id, q.currency);
      const view = { asOf, timezone: organization.timezone, from: q.from ?? null, to: q.to ?? null, projectId: q.projectId ?? null };
      const page = buildStatement(sources, view, { limit: q.limit, cursor, order: q.order });
      const tags = await tagsFor(store, organization, customer.id, q.currency, page.lines, c.get('invoicingForAll'));
      return c.json(serializeStatement({ customerId: customer.id, currency: q.currency, view, page, tags }), 200);
    },
  );

  return app;
}

/** MUT-664: the documents on each line of a page and the one it is due; none when invoicing is off for the profile. */
async function tagsFor(store: LedgerStore, organization: Organization, customerId: string, currency: string, lines: readonly StatementLine[], invoicingForAll: boolean): Promise<Map<string, StatementLineTags> | undefined> {
  if (lines.length === 0 || !(await invoicingOn(store, organization, invoicingForAll))) return undefined;
  const issued: IssuedDocumentRecord[] = [];
  let cursor: { createdAt: Date; id: string } | null = null;
  do {
    const page = await store.issuing.list(organization.id, { customerId, currency }, { limit: 200, cursor });
    issued.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  const owedIds = lines.filter((l) => l.kind === 'CHARGE').map((l) => l.receivableId!);
  const paymentIds = lines.filter((l) => l.kind === 'PAYMENT').map((l) => l.paymentId!);
  const [owed, received, inputs] = await Promise.all([
    owedIds.length ? store.issuing.liveExternal(organization.id, 'OWED', owedIds) : [],
    paymentIds.length ? store.issuing.liveExternal(organization.id, 'RECEIVED', paymentIds) : [],
    store.issuing.dueInputs(organization.id),
  ]);
  const due = documentsDue(inputs).filter((i) => i.customerId === customerId);
  return statementTags(lines, { issued, external: [...owed, ...received], due });
}

async function mustGet(store: LedgerStore, organizationId: string, id: string): Promise<CustomerRecord> {
  const customer = await store.customers.getById(organizationId, id);
  if (!customer) throw new ApiError('NOT_FOUND', 'No such customer');
  return customer;
}

async function findByReference(store: LedgerStore, organizationId: string, reference: { provider: 'MALAFAT'; externalId: string }) {
  const ref = await store.externalReferences.findByExternalId(organizationId, reference.provider, 'CUSTOMER', reference.externalId);
  if (!ref) return null;
  const customer = await store.customers.getById(organizationId, ref.entityId);
  return customer ? { customer, ref } : null;
}
