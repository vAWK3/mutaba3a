import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { expenseDate, parseExpenseAmount } from '../expenses/compose.js';
import { dateWindow, rankMatches, type MatchCandidate } from '../expenses/similarity.js';
import { decodeInboxCursor, encodeInboxCursor } from '../inbox/cursor.js';
import { SUPPORTED_CURRENCIES, formatMoney, type Currency } from '../money.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { ownedOrCoOwnedProfilesOf, profileOwnerOf, profileTypeOf } from '../personal-profile.js';
import type { Organization } from '../repositories/ports.js';
import { serializeInboxEntry } from '../serializers.js';
import { TOOL_PAGE_DEFAULT, agentProfile, hasScope, pageOf, pagingInput, runTool, type McpContext } from './context.js';

/**
 * MUT-435: the read tools — where an expense could go (profiles), how to file it (categories, clients, vendors), what
 * is already waiting (inbox) and whether the purchase is already recorded (look-alikes). Every one reads through the
 * guarded store and, when it names a profile, through `agentProfile` (owned or co-owned only, P1).
 */
export const SHOW_BEFORE_WRITING = 'Show the person what you found before you write anything, and let them choose.';

const SIMILAR_MAX_RESULTS = 10;
/** Candidate rows read per source: a ±3-day window beyond this is pathological, and the result says it was cut. */
const SIMILAR_MAX_CANDIDATES = 200;
const SIMILAR_PAGE = 100;
const VENDOR_LIMIT_MAX = 25;

const profileIdInput = z.string().uuid().describe('A profile id from list_profiles.');
const page = <T extends z.ZodRawShape>(item: T) => ({ items: z.array(z.object(item)), nextCursor: z.string().nullable() });

function profileView(organization: Organization, userId: string) {
  const type = profileTypeOf(organization);
  return {
    id: organization.id,
    name: organization.name,
    type: type ? (type.toLowerCase() as 'personal' | 'business') : null,
    defaultCurrency: organization.defaultCurrency,
    timezone: organization.timezone,
    isPersonalDefault: organization.personalOwnerUserId === userId,
    coOwned: profileOwnerOf(organization) !== userId,
  };
}

export function registerReadTools(server: McpServer, ctx: McpContext): void {
  if (!hasScope(ctx, 'read')) return;
  const userId = ctx.agent.user.id;

  server.registerTool(
    'list_profiles',
    {
      title: 'List profiles',
      description: `The profiles this person can file expenses to: their personal profile and the business profiles they own or co-own, with each one's default currency. Never choose a profile for them. ${SHOW_BEFORE_WRITING}`,
      inputSchema: pagingInput,
      outputSchema: page({ id: z.string(), name: z.string(), type: z.enum(['personal', 'business']).nullable(), defaultCurrency: z.string(), timezone: z.string(), isPersonalDefault: z.boolean(), coOwned: z.boolean() }),
      annotations: { readOnlyHint: true },
    },
    ({ limit, cursor }) =>
      runTool(ctx, async () => {
        const profiles = await ownedOrCoOwnedProfilesOf(ctx.store, userId);
        return pageOf(profiles.map((o) => profileView(o, userId)), cursor, limit);
      }),
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List expense categories',
      description: `A profile's expense categories, in the order the person set them up. Ask which category fits before filing. ${SHOW_BEFORE_WRITING}`,
      inputSchema: { profileId: profileIdInput, includeArchived: z.boolean().optional().describe('Include archived categories (default false).'), ...pagingInput },
      outputSchema: { ...page({ id: z.string(), name: z.string(), archived: z.boolean() }), hint: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ profileId, includeArchived, limit, cursor }) =>
      runTool(ctx, async () => {
        const organization = await agentProfile(ctx, profileId);
        // Never seeds the preset (GET /v1/expense-categories does): a read tool writes nothing.
        const categories = await ctx.store.expenseCategories.list(organization.id, { includeArchived: includeArchived ?? false });
        const result = pageOf(categories.map((c) => ({ id: c.id, name: c.name, archived: c.archivedAt !== null })), cursor, limit);
        return categories.length === 0 ? { ...result, hint: 'This profile has no categories yet. The person can open it in MTB3A once to get the default set; an expense can also be filed without one.' } : result;
      }),
  );

  server.registerTool(
    'list_clients',
    {
      title: 'List clients',
      description: `A profile's active clients, for an expense that belongs to one. Most expenses have no client; only link one when the person says so. ${SHOW_BEFORE_WRITING}`,
      inputSchema: { profileId: profileIdInput, ...pagingInput },
      outputSchema: page({ id: z.string(), name: z.string() }),
      annotations: { readOnlyHint: true },
    },
    ({ profileId, limit, cursor }) =>
      runTool(ctx, async () => {
        const organization = await agentProfile(ctx, profileId);
        const result = await ctx.store.customers.list(organization.id, { status: 'ACTIVE' }, { limit: limit ?? TOOL_PAGE_DEFAULT, cursor: cursor ? decodeCursor(cursor) : null });
        return { items: result.items.map((c) => ({ id: c.id, name: c.name })), nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null };
      }),
  );

  server.registerTool(
    'list_vendors',
    {
      title: 'Find vendors',
      description: `Search a profile's saved vendors by name (Arabic, Hebrew or English, as typed), best match first — to write a vendor the way the person already does. ${SHOW_BEFORE_WRITING}`,
      inputSchema: {
        profileId: profileIdInput,
        q: z.string().min(1).max(200).describe('Part of the vendor name.'),
        limit: z.number().int().min(1).max(VENDOR_LIMIT_MAX).optional().describe(`At most ${VENDOR_LIMIT_MAX} (default 10).`),
      },
      outputSchema: { items: z.array(z.object({ id: z.string(), name: z.string(), matchedName: z.string(), exact: z.boolean() })) },
      annotations: { readOnlyHint: true },
    },
    ({ profileId, q, limit }) =>
      runTool(ctx, async () => {
        const organization = await agentProfile(ctx, profileId);
        const found = await ctx.store.vendors.search(organization.id, q, limit ?? 10);
        return { items: found.map((s) => ({ id: s.vendor.id, name: s.vendor.canonicalName, matchedName: s.matchedName, exact: s.exact })) };
      }),
  );

  server.registerTool(
    'list_inbox',
    {
      title: 'List the inbox',
      description: `The person's unsorted entries (captured with no profile yet), newest first. Check here before adding something that may already be waiting. ${SHOW_BEFORE_WRITING}`,
      inputSchema: pagingInput,
      outputSchema: page({ id: z.string(), kind: z.enum(['income', 'expense']), amount: z.string(), currency: z.string(), occurredOn: z.string(), note: z.string().nullable(), captureSource: z.string().nullable() }),
      annotations: { readOnlyHint: true },
    },
    ({ limit, cursor }) =>
      runTool(ctx, async () => {
        const result = await ctx.store.inboxEntries.list(userId, { limit: limit ?? TOOL_PAGE_DEFAULT, cursor: cursor ? decodeInboxCursor(cursor) : null });
        return {
          items: result.items.map((e) => {
            const { id, kind, amount, currency, occurredOn, note, captureSource } = serializeInboxEntry(e);
            return { id, kind, amount, currency, occurredOn, note, captureSource };
          }),
          nextCursor: result.nextCursor ? encodeInboxCursor(result.nextCursor) : null,
        };
      }),
  );

  server.registerTool(
    'find_similar_expenses',
    {
      title: 'Find look-alike expenses',
      description:
        'Before adding an expense, check whether the same purchase is already recorded: same currency and amount, dated within 3 days, a similar vendor ranked first. ' +
        `Searches one profile, or every profile and the inbox when profileId is omitted. If anything comes back, ask the person whether it is the same purchase. ${SHOW_BEFORE_WRITING}`,
      inputSchema: {
        amount: z.string().describe('Decimal amount as on the receipt, e.g. "45.90" (JOD takes 3 decimals).'),
        currency: z.enum(SUPPORTED_CURRENCIES),
        date: z.string().describe('The purchase date, YYYY-MM-DD.'),
        vendor: z.string().max(200).optional(),
        profileId: profileIdInput.optional(),
      },
      outputSchema: {
        items: z.array(
          z.object({
            where: z.enum(['profile', 'inbox']),
            profileId: z.string().nullable(),
            id: z.string(),
            amount: z.string(),
            currency: z.string(),
            occurredOn: z.string(),
            vendor: z.string().nullable(),
            title: z.string().nullable(),
            daysApart: z.number(),
            reasons: z.array(z.string()),
          }),
        ),
        truncated: z.boolean(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ amount, currency, date, vendor, profileId }) =>
      runTool(ctx, async () => {
        const probe = { amountMinor: parseExpenseAmount(amount, currency as Currency), currency, occurredOn: expenseDate(date), vendor };
        const profiles = profileId ? [await agentProfile(ctx, profileId)] : await ownedOrCoOwnedProfilesOf(ctx.store, userId);
        const window = dateWindow(probe.occurredOn);
        let truncated = false;

        type Candidate = MatchCandidate & { where: 'profile' | 'inbox'; profileId: string | null; id: string; title: string | null };
        const candidates: Candidate[] = [];
        for (const organization of profiles) {
          let cursor = null;
          let read = 0;
          do {
            const result = await ctx.store.expenses.list(organization.id, { ...window, currency }, { limit: SIMILAR_PAGE, cursor });
            for (const e of result.items) candidates.push({ where: 'profile', profileId: organization.id, id: e.id, amountMinor: e.amountMinor, currency: e.currency, occurredOn: e.occurredOn, vendor: e.vendor, title: e.title });
            read += result.items.length;
            cursor = result.nextCursor;
          } while (cursor && read < SIMILAR_MAX_CANDIDATES);
          if (cursor) truncated = true;
        }
        if (!profileId) {
          let cursor = null;
          let read = 0;
          do {
            const result = await ctx.store.inboxEntries.list(userId, { limit: SIMILAR_PAGE, cursor });
            for (const e of result.items) {
              if (e.kind === 'EXPENSE') candidates.push({ where: 'inbox', profileId: null, id: e.id, amountMinor: e.amountMinor, currency: e.currency, occurredOn: e.occurredOn, vendor: null, title: e.note });
            }
            read += result.items.length;
            cursor = result.nextCursor;
          } while (cursor && read < SIMILAR_MAX_CANDIDATES);
          if (cursor) truncated = true;
        }

        const items = rankMatches(probe, candidates)
          .slice(0, SIMILAR_MAX_RESULTS)
          .map(({ item, match }) => ({
            where: item.where,
            profileId: item.profileId,
            id: item.id,
            amount: formatMoney({ minor: item.amountMinor, currency: item.currency as Currency }),
            currency: item.currency,
            occurredOn: item.occurredOn,
            vendor: item.vendor,
            title: item.title,
            daysApart: match.daysApart,
            reasons: match.reasons,
          }));
        return { items, truncated };
      }),
  );
}
