import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import { UniqueViolation } from '../repositories/memory.js';
import type { LedgerStore, ProjectRecord, UpdateProjectPatch } from '../repositories/ports.js';
import {
  CreateProjectRequestSchema,
  IfMatchHeaderSchema,
  ListProjectsQuerySchema,
  ProjectIdParamSchema,
  ProjectPageSchema,
  ProjectSchema,
  UpdateProjectRequestSchema,
} from '../schemas.js';
import { serializeProject } from '../serializers.js';
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

const projectJson = { content: { 'application/json': { schema: ProjectSchema } } };

/** /v1/projects — the container every agreement, receivable and payment hangs off (M2 brief §2.2). */
export function projectRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/projects',
      tags: ['Projects'],
      summary: 'Create a project',
      description:
        'One currency per project. With `externalReference`, creation is idempotent on that reference: a known reference returns the existing project with 200 when it belongs to the same customer, or 409 CUSTOMER_MISMATCH when it does not.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('projects:write'), idempotent(store, 'projects.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: { required: true, content: { 'application/json': { schema: CreateProjectRequestSchema } } } },
      responses: {
        200: { description: 'Already exists for this external reference', ...projectJson },
        201: { description: 'Created', ...projectJson },
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

      const customer = await store.customers.getById(organization.id, body.customerId);
      if (!customer) throw new ApiError('VALIDATION_FAILED', 'customerId does not name a customer of this organization', { field: 'customerId', reason: 'CUSTOMER_NOT_FOUND' });
      if (customer.status === 'ARCHIVED') throw new ApiError('VALIDATION_FAILED', 'The customer is archived', { field: 'customerId', reason: 'CUSTOMER_ARCHIVED' });

      if (reference) {
        await requireConnectedIntegration(store, organization.id, reference.provider);
        const existing = await findByReference(store, organization.id, reference);
        if (existing) return c.json(serializeProject(await sameCustomerOrConflict(existing.project, body.customerId), existing.ref), 200);
      }

      let project: ProjectRecord;
      try {
        project = await store.projects.create({ organizationId: organization.id, customerId: body.customerId, name: body.name, currency: body.currency, vatTreatment: body.vatTreatment ?? null }, now, reference);
      } catch (err) {
        if (err instanceof UniqueViolation && reference) {
          const raced = await findByReference(store, organization.id, reference);
          if (raced) return c.json(serializeProject(await sameCustomerOrConflict(raced.project, body.customerId), raced.ref), 200);
        }
        throw err;
      }

      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'project.created',
        entityType: 'project',
        entityId: project.id,
        metadata: { customerId: project.customerId, currency: project.currency, ...(reference ? { externalReference: reference } : {}) },
        requestId: c.get('requestId'),
      });
      const ref = reference ? await store.externalReferences.findByExternalId(organization.id, reference.provider, 'PROJECT', reference.externalId) : null;
      return c.json(serializeProject(project, ref), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/projects',
      tags: ['Projects'],
      summary: 'List projects',
      security: [{ apiKey: [] }],
      middleware: [requireScope('projects:read')] as const,
      request: { query: ListProjectsQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: ProjectPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const page = await store.projects.list(
        organization.id,
        {
          ...(q.status ? { status: q.status } : {}),
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.currency ? { currency: q.currency } : {}),
          ...(q.externalId ? { provider: q.provider, externalId: q.externalId } : {}),
        },
        toPageRequest(q),
      );
      const refs = await referencesByEntity(store, organization.id, 'PROJECT', page.items.map((i) => i.id));
      return c.json({ items: page.items.map((i) => serializeProject(i, refs.get(i.id))), nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/projects/{projectId}',
      tags: ['Projects'],
      summary: 'Get a project',
      security: [{ apiKey: [] }],
      middleware: [requireScope('projects:read')] as const,
      request: { params: ProjectIdParamSchema },
      responses: { 200: { description: 'The project', ...projectJson }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const project = await mustGet(store, organization.id, c.req.valid('param').projectId);
      const refs = await referencesByEntity(store, organization.id, 'PROJECT', [project.id]);
      return c.json(serializeProject(project, refs.get(project.id)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/projects/{projectId}',
      tags: ['Projects'],
      summary: 'Update a project (optimistic, If-Match)',
      description: '`currency` can change only while nothing is posted against the project; afterwards it is refused with 409 CURRENCY_LOCKED. `customerId` is immutable.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('projects:write'), ifMatch()] as const,
      request: { params: ProjectIdParamSchema, headers: IfMatchHeaderSchema, body: { required: true, content: { 'application/json': { schema: UpdateProjectRequestSchema } } } },
      responses: { 200: { description: 'Updated', ...projectJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const body = c.req.valid('json');
      const id = c.req.valid('param').projectId;
      const current = await mustGet(store, organization.id, id);

      const patch: UpdateProjectPatch = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.vatTreatment !== undefined) patch.vatTreatment = body.vatTreatment;
      if (body.currency !== undefined && body.currency !== current.currency) {
        if (await store.projects.hasPostedActivity(organization.id, id)) {
          throw new ApiError('CONFLICT', 'Currency is locked: financial activity has been posted against this project', { reason: 'CURRENCY_LOCKED', currency: current.currency });
        }
        if (await store.feeProposals.findOpenByProject(organization.id, id)) {
          throw new ApiError('CONFLICT', 'Currency is locked: a fee proposal is open on this project; withdraw it first', { reason: 'CURRENCY_LOCKED', currency: current.currency });
        }
        patch.currency = body.currency;
      }

      const result = await store.projects.update(organization.id, id, c.get('expectedVersion'), patch, c.get('now')());
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such project');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);

      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'project.updated',
        entityType: 'project',
        entityId: result.record.id,
        metadata: { fields: Object.keys(patch), version: result.record.version },
        requestId: c.get('requestId'),
      });
      const refs = await referencesByEntity(store, organization.id, 'PROJECT', [result.record.id]);
      return c.json(serializeProject(result.record, refs.get(result.record.id)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/projects/{projectId}/archive',
      tags: ['Projects'],
      summary: 'Archive a project',
      description: 'Idempotent. Refused with 409 PROJECT_HAS_OUTSTANDING while receivables are outstanding and 409 PROPOSAL_OPEN while a fee proposal is open (withdraw it first). Nothing is ever deleted.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('projects:write'), idempotent(store, 'projects.archive')] as const,
      request: { params: ProjectIdParamSchema, headers: IdempotencyHeaderSchema },
      responses: { 200: { description: 'Archived (or already was)', ...projectJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const project = await mustGet(store, organization.id, c.req.valid('param').projectId);
      const refs = await referencesByEntity(store, organization.id, 'PROJECT', [project.id]);
      if (project.status === 'ARCHIVED') return c.json(serializeProject(project, refs.get(project.id)), 200);
      const outstanding = await store.receivables.countOutstandingByProject(organization.id, project.id);
      if (outstanding > 0) throw new ApiError('CONFLICT', 'Receivables are outstanding on this project', { reason: 'PROJECT_HAS_OUTSTANDING', outstandingReceivables: outstanding });
      const openProposal = await store.feeProposals.findOpenByProject(organization.id, project.id);
      if (openProposal) throw new ApiError('CONFLICT', 'A fee proposal is open on this project; withdraw it first', { reason: 'PROPOSAL_OPEN', openProposalId: openProposal.id, status: openProposal.status });
      const archived = await store.projects.archive(organization.id, project.id, c.get('now')());
      if (!archived) throw new ApiError('NOT_FOUND', 'No such project');
      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'project.archived',
        entityType: 'project',
        entityId: archived.id,
        requestId: c.get('requestId'),
      });
      return c.json(serializeProject(archived, refs.get(archived.id)), 200);
    },
  );

  return app;
}

async function mustGet(store: LedgerStore, organizationId: string, id: string): Promise<ProjectRecord> {
  const project = await store.projects.getById(organizationId, id);
  if (!project) throw new ApiError('NOT_FOUND', 'No such project');
  return project;
}

async function findByReference(store: LedgerStore, organizationId: string, reference: { provider: 'MALAFAT'; externalId: string }) {
  const ref = await store.externalReferences.findByExternalId(organizationId, reference.provider, 'PROJECT', reference.externalId);
  if (!ref) return null;
  const project = await store.projects.getById(organizationId, ref.entityId);
  return project ? { project, ref } : null;
}

async function sameCustomerOrConflict(project: ProjectRecord, customerId: string): Promise<ProjectRecord> {
  if (project.customerId !== customerId) {
    throw new ApiError('CONFLICT', 'This external reference already names a project of a different customer', {
      reason: 'CUSTOMER_MISMATCH',
      existingProjectId: project.id,
      existingCustomerId: project.customerId,
    });
  }
  return project;
}
