import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { todayFor, validationError } from '../agreements/compose.js';
import { ApiError } from '../errors.js';
import { InsufficientCapacity } from '../repositories/memory.js';
import { groupCreate, groupFilter, groupPatch, isGroupMember, MAX_GROUPS_PER_PROFILE, seriesBounds } from '../expenses/groups.js';
import { summarizeGroup } from '../expenses/summary.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import type { ExpenseCurrencyTotal, ExpenseGroupRecord, ExpenseRecord, JsonObject, LedgerStore } from '../repositories/ports.js';
import {
  CreateExpenseGroupRequestSchema,
  ExpenseGroupDetailSchema,
  ExpenseGroupExpenseParamSchema,
  ExpenseGroupIdParamSchema,
  ExpenseGroupListSchema,
  ExpenseGroupOverrideSchema,
  ExpenseGroupSchema,
  ExpenseGroupSummarySchema,
  IfMatchHeaderSchema,
  ListExpenseGroupsQuerySchema,
  SetExpenseGroupOverrideRequestSchema,
  UpdateExpenseGroupRequestSchema,
} from '../schemas.js';
import { serializeExpenseGroup, serializeExpenseGroupOverride } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse, versionMismatch } from './shared.js';

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const noContent = { 204: { description: 'Done' } } as const;
/** Per-group aggregates run at most this many at a time, so a long list can't take every pooled connection (re-review A2). */
const TOTALS_CONCURRENCY = 4;
const SUMMARY_PAGE = 200;

/**
 * /v1/expense-groups (MUT-267, ADR-094): trips and other date ranges on a
 * hosted profile. Members are worked out when read (groups.ts); a mark keeps
 * or leaves out one expense. Part of the expenses domain — session-only, the
 * same scopes, audited as USER, never listed to Malafat's key.
 */
export function expenseGroupRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  function audit(c: Context<AppEnv>, action: string, entityId: string, metadata?: JsonObject) {
    const { organization, user } = sessionAuth(c);
    return store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action, entityType: 'expense_group', entityId, ...(metadata ? { metadata } : {}), requestId: c.get('requestId') });
  }

  async function mustGetGroup(organizationId: string, id: string): Promise<ExpenseGroupRecord> {
    const group = await store.expenseGroups.getById(organizationId, id);
    if (!group) throw new ApiError('NOT_FOUND', 'No such expense group');
    return group;
  }

  async function mustGetExpense(organizationId: string, id: string): Promise<ExpenseRecord> {
    const expense = await store.expenses.getById(organizationId, id);
    if (!expense) throw new ApiError('NOT_FOUND', 'No such expense');
    return expense;
  }

  const totalsOf = (organizationId: string, group: ExpenseGroupRecord): Promise<ExpenseCurrencyTotal[]> =>
    store.expenses.totalsByCurrency(organizationId, { group: groupFilter(group) });

  async function withTotals(organizationId: string, groups: ExpenseGroupRecord[]) {
    const out: Array<ReturnType<typeof serializeExpenseGroup>> = [];
    for (let i = 0; i < groups.length; i += TOTALS_CONCURRENCY) {
      const chunk = groups.slice(i, i + TOTALS_CONCURRENCY);
      out.push(...(await Promise.all(chunk.map(async (g) => serializeExpenseGroup(g, await totalsOf(organizationId, g))))));
    }
    return out;
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/expense-groups',
      tags: ['Expense groups'],
      summary: 'List expense groups, newest start first, with their totals per currency',
      description: `Unpaged: a profile holds at most ${MAX_GROUPS_PER_PROFILE} live groups. With expenseId, only the groups that expense belongs to (dated in the window and not left out, or kept); 404 for an expense this profile does not have.`,
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { query: ListExpenseGroupsQuerySchema },
      responses: { 200: { description: 'The groups', content: { 'application/json': { schema: ExpenseGroupListSchema } } }, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const { expenseId } = c.req.valid('query');
      let groups = await store.expenseGroups.list(organization.id);
      if (expenseId) {
        const expense = await mustGetExpense(organization.id, expenseId);
        const marks = new Map((await store.expenseGroups.overridesForExpense(organization.id, expense.id)).map((m) => [m.groupId, m.mode]));
        groups = groups.filter((g) => isGroupMember(expense, g, marks.get(g.id) ?? null));
      }
      return c.json({ items: await withTotals(organization.id, groups) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/expense-groups',
      tags: ['Expense groups'],
      summary: 'Create an expense group',
      description: `Expenses dated from startOn to endOn (or, with no endOn, to a year after startOn) join automatically, including ones logged later. A profile holds at most ${MAX_GROUPS_PER_PROFILE} live groups (422 GROUP_LIMIT).`,
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), idempotent(store, 'expenseGroups.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateExpenseGroupRequestSchema) },
      responses: { 201: { description: 'Created', content: { 'application/json': { schema: ExpenseGroupSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const now = c.get('now')();
      const fields = groupCreate(c.req.valid('json'), todayFor(organization, now));
      let group: ExpenseGroupRecord;
      try {
        group = await store.expenseGroups.create({ organizationId: organization.id, ...fields, createdByUserId: user.id }, now, MAX_GROUPS_PER_PROFILE);
      } catch (err) {
        if (err instanceof InsufficientCapacity) throw validationError('GROUP_LIMIT', `A profile holds at most ${MAX_GROUPS_PER_PROFILE} expense groups; delete one first`, { max: MAX_GROUPS_PER_PROFILE });
        throw err;
      }
      await audit(c, 'expense_group.created', group.id, { startOn: group.startOn, endOn: group.endOn });
      return c.json(serializeExpenseGroup(group, await totalsOf(organization.id, group)), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/expense-groups/{groupId}',
      tags: ['Expense groups'],
      summary: 'An expense group with its totals and how many expenses inside its window are left out',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { params: ExpenseGroupIdParamSchema },
      responses: { 200: { description: 'The group', content: { 'application/json': { schema: ExpenseGroupDetailSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const group = await mustGetGroup(organization.id, c.req.valid('param').groupId);
      const [totals, excluded] = await Promise.all([totalsOf(organization.id, group), store.expenses.totalsByCurrency(organization.id, { group: groupFilter(group, 'excluded') })]);
      return c.json({ ...serializeExpenseGroup(group, totals), excludedCount: excluded.reduce((n, x) => n + x.count, 0) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/expense-groups/{groupId}',
      tags: ['Expense groups'],
      summary: 'Change an expense group (optimistic, If-Match)',
      description: 'null endOn = still going; null clears the notes. The merged range is checked. Keep and leave-out marks stay when the dates change. A stale If-Match is a 409 before any validation; a PATCH that changes nothing returns the group unchanged (same version, no audit).',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), ifMatch()] as const,
      request: { params: ExpenseGroupIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(UpdateExpenseGroupRequestSchema) },
      responses: { 200: { description: 'Changed', content: { 'application/json': { schema: ExpenseGroupSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const existing = await mustGetGroup(organization.id, c.req.valid('param').groupId);
      // A stale version is a 409 first, so the caller refetches instead of fixing a range against someone else's dates.
      if (existing.version !== c.get('expectedVersion')) throw versionMismatch(existing.version);
      const patch = groupPatch(existing, body, todayFor(organization, now));
      // Nothing changes: no write, no new version, no audit.
      if (Object.keys(patch).length === 0) return c.json(serializeExpenseGroup(existing, await totalsOf(organization.id, existing)), 200);
      const result = await store.expenseGroups.update(organization.id, existing.id, c.get('expectedVersion'), patch, now);
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such expense group');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      await audit(c, 'expense_group.updated', result.record.id, { fields: Object.keys(patch), version: result.record.version });
      return c.json(serializeExpenseGroup(result.record, await totalsOf(organization.id, result.record)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/expense-groups/{groupId}',
      tags: ['Expense groups'],
      summary: 'Delete an expense group (soft; its expenses are untouched)',
      description: '204 again for a group already deleted; 404 for an id this profile never had.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ExpenseGroupIdParamSchema },
      responses: { ...noContent, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const deleted = await store.expenseGroups.softDelete(organization.id, c.req.valid('param').groupId, c.get('now')());
      if (!deleted) throw new ApiError('NOT_FOUND', 'No such expense group');
      if (deleted.changed) await audit(c, 'expense_group.deleted', deleted.record.id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/expense-groups/{groupId}/expenses/{expenseId}',
      tags: ['Expense groups'],
      summary: 'Keep (included) or leave out (excluded) one expense',
      description: 'Idempotent; the last mark wins. Any mark is accepted on any expense of the profile, and it stays when the expense\'s date changes. 404 for a group or expense this profile does not have.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ExpenseGroupExpenseParamSchema, body: jsonBody(SetExpenseGroupOverrideRequestSchema) },
      responses: { 200: { description: 'Marked', content: { 'application/json': { schema: ExpenseGroupOverrideSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const { groupId, expenseId } = c.req.valid('param');
      const { mode } = c.req.valid('json');
      const group = await mustGetGroup(organization.id, groupId);
      const expense = await mustGetExpense(organization.id, expenseId);
      const marked = await store.expenseGroups.setOverride(organization.id, group.id, expense.id, mode, c.get('now')());
      if (marked.changed) await audit(c, 'expense_group.expense_marked', group.id, { expenseId: expense.id, mode });
      return c.json(serializeExpenseGroupOverride(marked.record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/expense-groups/{groupId}/expenses/{expenseId}',
      tags: ['Expense groups'],
      summary: 'Remove a keep or leave-out mark: the expense follows the date rule again',
      description: '204 whether or not a mark existed; 404 for a group this profile does not have.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ExpenseGroupExpenseParamSchema },
      responses: { ...noContent, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const { groupId, expenseId } = c.req.valid('param');
      const group = await mustGetGroup(organization.id, groupId);
      if (await store.expenseGroups.clearOverride(organization.id, group.id, expenseId)) await audit(c, 'expense_group.expense_unmarked', group.id, { expenseId });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/expense-groups/{groupId}/summary',
      tags: ['Expense groups'],
      summary: 'A group\'s spending per currency, by category, by client and by day',
      description:
        'One block per currency, never summed or converted (ADR-004, ADR-087). byDay zero-fills seriesFrom..seriesTo and adds a bucket for every member dated outside it (position before/after), so each currency\'s buckets sum to its total.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { params: ExpenseGroupIdParamSchema },
      responses: { 200: { description: 'Summary', content: { 'application/json': { schema: ExpenseGroupSummarySchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const group = await mustGetGroup(organization.id, c.req.valid('param').groupId);
      const series = seriesBounds(group, todayFor(organization, c.get('now')()));
      const members: ExpenseRecord[] = [];
      let cursor = null;
      do {
        const page = await store.expenses.list(organization.id, { group: groupFilter(group) }, { limit: SUMMARY_PAGE, cursor });
        members.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return c.json({ groupId: group.id, seriesFrom: series.from, seriesTo: series.to, currencies: summarizeGroup(members, series) }, 200);
    },
  );

  return app;
}
