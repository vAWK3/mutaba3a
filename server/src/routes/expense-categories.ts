import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { displayCategoryNames, presetFor, presetKeyForName } from '../expenses/presets.js';
import { profileTypeOf } from '../personal-profile.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import { UniqueViolation } from '../repositories/memory.js';
import type { ExpenseCategoryRecord, JsonObject, LedgerStore, UpdateExpenseCategoryPatch, UserLocale } from '../repositories/ports.js';
import {
  CreateExpenseCategoryRequestSchema,
  ExpenseCategoryIdParamSchema,
  ExpenseCategoryListSchema,
  ExpenseCategorySchema,
  IfMatchHeaderSchema,
  ListExpenseCategoriesQuerySchema,
  UpdateExpenseCategoryRequestSchema,
} from '../schemas.js';
import { serializeExpenseCategory } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, requestLanguage, validationResponse, versionMismatch } from './shared.js';

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const categoryJson = { content: { 'application/json': { schema: ExpenseCategorySchema } } };

/**
 * /v1/expense-categories — a hosted profile's categories (MUT-42 D2), as the
 * offline ExpenseCategory. The first list on a profile with none seeds a
 * preset in the user's language, as SYSTEM: law-firm where Malafat is the
 * writer of record, personal on a PERSONAL profile, general on a BUSINESS one
 * or any other firm. Archived, never deleted — except that changing a profile's
 * type replaces them all (MUT-182, PATCH /v1/profiles/{id}).
 *
 * MUT-464: every answer shows a seeded category in the request's language (`requestLanguage`), whatever language
 * it was seeded in; the stored name never changes.
 */
export function expenseCategoryRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  function audit(c: Context<AppEnv>, action: string, entityId: string, metadata: JsonObject) {
    const auth = sessionAuth(c);
    return store.audit.append({ organizationId: auth.organization.id, actorType: 'USER', actorId: auth.user.id, action, entityType: 'expense_category', entityId, metadata, requestId: c.get('requestId') });
  }

  /** One category as the viewer reads it: whether it follows the language depends on the rest of the profile's list. */
  async function displayed(organizationId: string, record: ExpenseCategoryRecord, lang: UserLocale) {
    if (presetKeyForName(record.name) === null) return { ...record, presetKey: null };
    const all = await store.expenseCategories.list(organizationId, { includeArchived: true });
    return displayCategoryNames(all.map((r) => (r.id === record.id ? record : r)), lang).find((r) => r.id === record.id)!;
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/expense-categories',
      tags: ['Expenses'],
      summary: 'The profile’s expense categories, in creation order',
      description: 'Names of seeded categories follow Accept-Language (ar or en, else the signed-in user’s language); names people typed show as typed. The first call on a profile with no categories seeds a preset in the signed-in user’s language: the law-firm preset when Malafat records the profile’s income, the personal preset on a PERSONAL profile, the general one on a BUSINESS profile or any other organization. Archived categories only with includeArchived=true.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { query: ListExpenseCategoriesQuerySchema },
      responses: { 200: { description: 'Categories', content: { 'application/json': { schema: ExpenseCategoryListSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user, writerOfRecord } = sessionAuth(c);
      const now = c.get('now')();
      if ((await store.expenseCategories.list(organization.id, { includeArchived: true })).length === 0) {
        // profileTypeOf: a MUT-120 profile the old revision wrote unstamped is still PERSONAL (qa-reconcile D1); it seeds once, so it must be right.
        const { preset, categories } = presetFor({ writerOfRecord, profileType: profileTypeOf(organization) }, user.locale);
        if (await store.expenseCategories.seed(organization.id, categories, now)) {
          await store.audit.append({ organizationId: organization.id, actorType: 'SYSTEM', actorId: null, action: 'expense_category.seeded', entityType: 'expense_category', entityId: null, metadata: { preset, count: categories.length, locale: user.locale }, requestId: c.get('requestId') });
        }
      }
      // The whole list, archived too, decides which row of a cross-language pair follows the language.
      const all = displayCategoryNames(await store.expenseCategories.list(organization.id, { includeArchived: true }), requestLanguage(c));
      const items = c.req.valid('query').includeArchived === 'true' ? all : all.filter((r) => r.archivedAt === null);
      return c.json({ items: items.map(serializeExpenseCategory) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/expense-categories',
      tags: ['Expenses'],
      summary: 'Add an expense category',
      description: '409 CATEGORY_NAME_TAKEN when the profile already has the name in any letter case, or has the seeded category it names in the other language.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), idempotent(store, 'expense-categories.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateExpenseCategoryRequestSchema) },
      responses: { 201: { description: 'Added', ...categoryJson }, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const body = c.req.valid('json');
      const category = await nameTaken(() => store.expenseCategories.create(organization.id, { name: body.name, color: body.color ?? null }, c.get('now')()));
      await audit(c, 'expense_category.created', category.id, { name: category.name });
      return c.json(serializeExpenseCategory(await displayed(organization.id, category, requestLanguage(c))), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/expense-categories/{categoryId}',
      tags: ['Expenses'],
      summary: 'Rename, recolour, archive or restore a category (optimistic, If-Match)',
      description: 'An archived category stays on the expenses that have it but cannot be newly chosen.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), ifMatch()] as const,
      request: { params: ExpenseCategoryIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(UpdateExpenseCategoryRequestSchema) },
      responses: { 200: { description: 'Changed', ...categoryJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const body = c.req.valid('json');
      const patch: UpdateExpenseCategoryPatch = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.color !== undefined) patch.color = body.color;
      if (body.archived !== undefined) patch.archived = body.archived;
      const result = await nameTaken(() => store.expenseCategories.update(organization.id, c.req.valid('param').categoryId, c.get('expectedVersion'), patch, c.get('now')()));
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such category');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      await audit(c, 'expense_category.updated', result.record.id, { fields: Object.keys(patch), version: result.record.version });
      return c.json(serializeExpenseCategory(await displayed(organization.id, result.record, requestLanguage(c))), 200);
    },
  );

  return app;
}

async function nameTaken<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof UniqueViolation) throw new ApiError('CONFLICT', 'This profile already has a category with that name', { reason: 'CATEGORY_NAME_TAKEN' });
    throw err;
  }
}
