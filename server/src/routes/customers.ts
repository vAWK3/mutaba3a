import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import { UniqueViolation } from '../repositories/memory.js';
import type { CustomerRecord, LedgerStore, UpdateCustomerPatch } from '../repositories/ports.js';
import {
  CreateCustomerRequestSchema,
  CustomerIdParamSchema,
  CustomerPageSchema,
  CustomerSchema,
  IfMatchHeaderSchema,
  ListCustomersQuerySchema,
  UpdateCustomerRequestSchema,
} from '../schemas.js';
import { serializeCustomer } from '../serializers.js';
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
export function customerRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/customers',
      tags: ['Customers'],
      summary: 'Create a customer',
      description:
        'With `externalReference`, creation is idempotent on that reference: a known reference returns the existing customer with 200 and changes nothing. Requires a CONNECTED integration for the provider.',
      security: [{ apiKey: [] }],
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
      const { organization, apiKey } = c.get('auth');
      const body = c.req.valid('json');
      const now = c.get('now')();
      const reference = body.externalReference;

      if (reference) {
        await requireConnectedIntegration(store, organization.id, reference.provider);
        const existing = await findByReference(store, organization.id, reference);
        if (existing) return c.json(serializeCustomer(existing.customer, existing.ref), 200);
      }

      let customer: CustomerRecord;
      try {
        customer = await store.customers.create(
          { organizationId: organization.id, name: body.name, email: body.email ?? null, phone: body.phone ?? null, notes: body.notes ?? null, vatTreatment: body.vatTreatment ?? null },
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
        actorType: 'API_KEY',
        actorId: apiKey.id,
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
      security: [{ apiKey: [] }],
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
      security: [{ apiKey: [] }],
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
      security: [{ apiKey: [] }],
      middleware: [requireScope('customers:write'), ifMatch()] as const,
      request: { params: CustomerIdParamSchema, headers: IfMatchHeaderSchema, body: { required: true, content: { 'application/json': { schema: UpdateCustomerRequestSchema } } } },
      responses: { 200: { description: 'Updated', ...customerJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const body = c.req.valid('json');
      const patch: UpdateCustomerPatch = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.email !== undefined) patch.email = body.email;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.vatTreatment !== undefined) patch.vatTreatment = body.vatTreatment;

      const result = await store.customers.update(organization.id, c.req.valid('param').customerId, c.get('expectedVersion'), patch, c.get('now')());
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such customer');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);

      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
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
      const { organization, apiKey } = c.get('auth');
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

  return app;
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
