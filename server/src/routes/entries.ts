import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { decodeFeedCursor, encodeFeedCursor } from '../entries/merge.js';
import type { LedgerStore } from '../repositories/ports.js';
import { EntryPageSchema, ListEntriesQuerySchema } from '../schemas.js';
import { serializeEntry } from '../serializers.js';
import { errorResponses, notFoundResponse, validationResponse } from './shared.js';

// MUT-64: a device session is the same 'session' principal, so it reaches every route a cookie session does.
const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];

/**
 * Names no profile: it reads across the person's memberships, so it carries no `X-Mutaba3a-Profile`, like
 * `GET /v1/inbox`. Merged into `app.ts`'s organization-independent set.
 */
export const ENTRIES_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/entries']);

/**
 * /v1/entries (MUT-270): one newest-first feed of what a person's profiles hold — expenses, received payments,
 * Owed entries and conversions — so the phone's Recent mirrors the portal. Scheduled installments and retainer
 * charges are not entries (D2), and reading never lazy-posts. MUT-390: `order=occurredOn` lists by money date, so
 * Recent groups by the day money moved, with day and logged-since filters for its window and its backdated card.
 */
export function entriesRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/entries',
      tags: ['Entries'],
      summary: 'Your entries across profiles, newest logged or newest money day first',
      description:
        'Expenses, received payments, Owed entries and conversions on every profile you belong to (or the profiles you name), ordered by when each was logged (default) or, with order=occurredOn, by its money date. ' +
        'Everything on a profile, whoever logged it, Malafat\'s payments included; scheduled installments and retainer charges are not entries. ' +
        'No X-Mutaba3a-Profile. Unsorted entries are listed by GET /v1/inbox. ' +
        'Filters: occurredFrom with order=occurredOn; occurredBefore with order=occurredOn, or with loggedSince; loggedSince with the default order. Any other combination answers 422, since it could not be served from an index. ' +
        'A page is a snapshot: an entry edited or deleted later changes only when that page is read again (a deleted one is simply absent), so cache only the pages you re-read. ' +
        'With order=occurredOn an entry whose date changes between page reads can show twice or be missed until page one is read again: dedupe by id, and re-read page one after an edit. ' +
        'A settle shows as a received payment with settlesOwedId (its Owed is settled once paid in full, open before); a Malafat correction as a received payment with replacesPaymentId. In the default order each usually sits next to its partner; by money date they can be days apart.',
      security: SESSION_ONLY,
      request: { query: ListEntriesQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: EntryPageSchema } } }, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const q = c.req.valid('query');
      // MUT-390 D5: each filter only with the order whose index bounds it, so no page walks a firm's whole history.
      if (q.occurredFrom !== undefined && q.order !== 'occurredOn') throw new ApiError('VALIDATION_FAILED', 'occurredFrom needs order=occurredOn', { field: 'occurredFrom' });
      if (q.loggedSince !== undefined && q.order !== 'createdAt') throw new ApiError('VALIDATION_FAILED', 'loggedSince needs the default order', { field: 'loggedSince' });
      if (q.occurredBefore !== undefined && q.order === 'createdAt' && q.loggedSince === undefined) throw new ApiError('VALIDATION_FAILED', 'occurredBefore needs order=occurredOn or loggedSince', { field: 'occurredBefore' });
      const cursor = q.cursor ? decodeFeedCursor(q.cursor, q.order) : null;
      const memberships = await store.memberships.listByUser(c.get('identity').user.id);
      const mine = memberships.map((m) => m.organizationId);
      const requested = [...new Set(q.profileId ?? [])];
      // Same answer for a profile that exists elsewhere and one that never did (selectProfile's rule).
      if (requested.some((id) => !mine.includes(id))) throw new ApiError('NOT_FOUND', 'Profile not found');
      const organizationIds = requested.length > 0 ? requested : mine;

      const page = await store.entries.list(organizationIds, {
        limit: q.limit,
        order: q.order,
        cursor,
        ...(q.occurredFrom !== undefined && { occurredFrom: q.occurredFrom }),
        ...(q.occurredBefore !== undefined && { occurredBefore: q.occurredBefore }),
        ...(q.loggedSince !== undefined && { loggedSince: new Date(q.loggedSince) }),
      });
      const expenseIds = page.items.flatMap((row) => (row.kind === 'expense' ? [row.record.id] : []));
      // Only a capture with money applied can be a settle; most pages ask nothing.
      const settleCandidates = page.items.flatMap((row) => (row.kind === 'payment' && row.record.origin === 'CAPTURE' && row.record.allocatedMinor > 0n ? [row.record.id] : []));
      const [receiptCounts, settledOwed] = await Promise.all([
        store.expenseReceipts.countReadyByExpenseIds(organizationIds, expenseIds),
        store.entries.settledOwedIds(organizationIds, settleCandidates),
      ]);
      return c.json({ items: page.items.map((row) => serializeEntry(row, { receiptCounts, settledOwed })), nextCursor: page.nextCursor ? encodeFeedCursor(page.nextCursor) : null }, 200);
    },
  );

  return app;
}
