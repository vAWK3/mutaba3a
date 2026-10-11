import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { keyAuth, requireScope, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { planImport, type ImportRow, type ImportState, type PlanRow } from '../import/plan.js';
import { previewToken, verifyPreviewToken } from '../import/preview-token.js';
import { UniqueViolation } from '../repositories/memory.js';
import type { IntegrationProvider, LedgerStore } from '../repositories/ports.js';
import { ImportCommitRequestSchema, ImportCommitResponseSchema, ImportPreviewRequestSchema, ImportPreviewResponseSchema } from '../schemas.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, requireConnectedIntegration, validationResponse } from './shared.js';

interface CommitRow {
  index: number;
  entityType: PlanRow['entityType'];
  externalId: string;
  outcome: 'created' | 'linked' | 'failed';
  id?: string;
  reason?: string;
  warnings: PlanRow['warnings'];
}

/**
 * /v1/import — batch linking of an external system's customers and projects
 * (M2 brief §2.2). Preview and commit share `planImport`, so they cannot
 * disagree; commit is per-row and idempotent by external reference.
 */
export function importRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/import/preview',
      tags: ['Import'],
      summary: 'Plan an import without writing anything',
      security: [{ apiKey: [] }],
      middleware: [requireScope('customers:write'), requireScope('projects:write')] as const,
      request: { body: { required: true, content: { 'application/json': { schema: ImportPreviewRequestSchema } } } },
      responses: { 200: { description: 'The plan', content: { 'application/json': { schema: ImportPreviewResponseSchema } } }, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const body = c.req.valid('json');
      await requireConnectedIntegration(store, organization.id, body.provider);
      const rows = planImport(body.rows, await loadState(store, organization.id, body.provider, body.rows));
      return c.json(
        {
          rows: rows.map(publicPlanRow),
          totals: { create: count(rows, 'create'), link: count(rows, 'link'), conflict: count(rows, 'conflict') },
          previewToken: previewToken(organization.id, body.provider, body.rows),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/import/commit',
      tags: ['Import'],
      summary: 'Apply a previewed import',
      description:
        'Requires the `previewToken` of a preview of exactly these rows (409 PREVIEW_STALE otherwise). Re-plans against current state, applies customers then projects, each row independently; a re-run links what the first run created. Reports per-row outcomes.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('customers:write'), requireScope('projects:write'), idempotent(store, 'import.commit')] as const,
      request: { headers: IdempotencyHeaderSchema, body: { required: true, content: { 'application/json': { schema: ImportCommitRequestSchema } } } },
      responses: { 200: { description: 'Per-row outcomes', content: { 'application/json': { schema: ImportCommitResponseSchema } } }, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      await requireConnectedIntegration(store, organization.id, body.provider);
      if (!verifyPreviewToken(body.previewToken, organization.id, body.provider, body.rows)) {
        throw new ApiError('CONFLICT', 'previewToken does not match these rows; preview them again', { reason: 'PREVIEW_STALE' });
      }

      const plan = planImport(body.rows, await loadState(store, organization.id, body.provider, body.rows));
      const executor = new ImportExecutor(store, organization.id, apiKey.id, body.provider, body.rows, c.get('now')(), c.get('requestId'));
      const results = await executor.run(plan);
      const totals = { created: countOutcome(results, 'created'), linked: countOutcome(results, 'linked'), failed: countOutcome(results, 'failed') };

      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'import.committed',
        entityType: 'import',
        entityId: null,
        metadata: { provider: body.provider, rows: body.rows.length, totals },
        requestId: c.get('requestId'),
      });
      return c.json({ rows: results, totals }, 200);
    },
  );

  return app;
}

class ImportExecutor {
  private readonly createdCustomers = new Map<string, string>();

  constructor(
    private readonly store: LedgerStore,
    private readonly organizationId: string,
    private readonly apiKeyId: string,
    private readonly provider: IntegrationProvider,
    private readonly rows: readonly ImportRow[],
    private readonly now: Date,
    private readonly requestId: string,
  ) {}

  async run(plan: PlanRow[]): Promise<CommitRow[]> {
    const results: CommitRow[] = [];
    for (const row of plan.filter((r) => r.entityType === 'CUSTOMER')) results.push(await this.customer(row));
    for (const row of plan.filter((r) => r.entityType === 'PROJECT')) results.push(await this.project(row));
    return results.sort((a, b) => a.index - b.index);
  }

  private async customer(row: PlanRow): Promise<CommitRow> {
    const base = { index: row.index, entityType: row.entityType, externalId: row.externalId, warnings: row.warnings };
    if (row.action === 'conflict') return { ...base, outcome: 'failed', reason: reasonOf(row) };
    if (row.action === 'link' && row.existingId) {
      this.createdCustomers.set(row.externalId, row.existingId);
      return { ...base, outcome: 'linked', id: row.existingId };
    }
    const input = this.rows[row.index];
    if (!input || input.entityType !== 'CUSTOMER') return { ...base, outcome: 'failed', reason: 'VALIDATION' };
    try {
      const created = await this.store.customers.create(
        { organizationId: this.organizationId, name: input.name.trim(), email: input.email ?? null, phone: input.phone ?? null, notes: null },
        this.now,
        { provider: this.provider, externalId: row.externalId },
      );
      this.createdCustomers.set(row.externalId, created.id);
      await this.audit('customer.created', 'customer', created.id, { externalId: row.externalId });
      return { ...base, outcome: 'created', id: created.id };
    } catch (err) {
      return this.raced(err, 'CUSTOMER', row, base);
    }
  }

  private async project(row: PlanRow): Promise<CommitRow> {
    const base = { index: row.index, entityType: row.entityType, externalId: row.externalId, warnings: row.warnings };
    if (row.action === 'conflict') return { ...base, outcome: 'failed', reason: reasonOf(row) };
    if (row.action === 'link' && row.existingId) return { ...base, outcome: 'linked', id: row.existingId };
    const input = this.rows[row.index];
    if (!input || input.entityType !== 'PROJECT') return { ...base, outcome: 'failed', reason: 'VALIDATION' };

    const customerId = row.customer?.kind === 'existing' ? row.customer.id : row.customer ? this.createdCustomers.get(row.customer.externalId) : undefined;
    if (!customerId) return { ...base, outcome: 'failed', reason: 'UNKNOWN_CUSTOMER' };
    try {
      const created = await this.store.projects.create(
        { organizationId: this.organizationId, customerId, name: input.name.trim(), currency: input.currency },
        this.now,
        { provider: this.provider, externalId: row.externalId },
      );
      await this.audit('project.created', 'project', created.id, { externalId: row.externalId, customerId, currency: input.currency });
      return { ...base, outcome: 'created', id: created.id };
    } catch (err) {
      return this.raced(err, 'PROJECT', row, base);
    }
  }

  /** A concurrent writer linked the same external id first: report it as linked. */
  private async raced(err: unknown, entityType: 'CUSTOMER' | 'PROJECT', row: PlanRow, base: Omit<CommitRow, 'outcome'>): Promise<CommitRow> {
    if (!(err instanceof UniqueViolation)) throw err;
    const ref = await this.store.externalReferences.findByExternalId(this.organizationId, this.provider, entityType, row.externalId);
    if (!ref) return { ...base, outcome: 'failed', reason: 'CONFLICT' };
    if (entityType === 'CUSTOMER') this.createdCustomers.set(row.externalId, ref.entityId);
    return { ...base, outcome: 'linked', id: ref.entityId };
  }

  private audit(action: string, entityType: string, entityId: string, metadata: Record<string, unknown>): Promise<unknown> {
    return this.store.audit.append({
      organizationId: this.organizationId,
      actorType: 'API_KEY',
      actorId: this.apiKeyId,
      action,
      entityType,
      entityId,
      metadata: { import: true, provider: this.provider, ...metadata },
      requestId: this.requestId,
    });
  }
}

async function loadState(store: LedgerStore, organizationId: string, provider: IntegrationProvider, rows: readonly ImportRow[]): Promise<ImportState> {
  const customerIds = rows.flatMap((r) => (r.entityType === 'CUSTOMER' ? [r.externalId] : [r.customerExternalId]));
  const projectIds = rows.filter((r) => r.entityType === 'PROJECT').map((r) => r.externalId);
  const [customerRefs, projectRefs] = await Promise.all([
    store.externalReferences.findByExternalIds(organizationId, provider, 'CUSTOMER', [...new Set(customerIds)]),
    store.externalReferences.findByExternalIds(organizationId, provider, 'PROJECT', [...new Set(projectIds)]),
  ]);
  const state: ImportState = { customersByExternalId: new Map(), projectsByExternalId: new Map() };
  for (const ref of customerRefs) {
    const customer = await store.customers.getById(organizationId, ref.entityId);
    if (customer) state.customersByExternalId.set(ref.externalId, { id: customer.id, name: customer.name, status: customer.status });
  }
  for (const ref of projectRefs) {
    const project = await store.projects.getById(organizationId, ref.entityId);
    if (project) state.projectsByExternalId.set(ref.externalId, { id: project.id, name: project.name, customerId: project.customerId, currency: project.currency, status: project.status });
  }
  return state;
}

function publicPlanRow(row: PlanRow) {
  return {
    index: row.index,
    entityType: row.entityType,
    externalId: row.externalId,
    action: row.action,
    ...(row.existingId ? { existingId: row.existingId } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.detail ? { detail: row.detail } : {}),
    warnings: row.warnings,
  };
}

function reasonOf(row: PlanRow): string {
  return row.reason === 'VALIDATION' && row.detail ? `VALIDATION:${row.detail}` : (row.reason ?? 'CONFLICT');
}

function count(rows: PlanRow[], action: PlanRow['action']): number {
  return rows.filter((r) => r.action === action).length;
}

function countOutcome(rows: CommitRow[], outcome: CommitRow['outcome']): number {
  return rows.filter((r) => r.outcome === outcome).length;
}
