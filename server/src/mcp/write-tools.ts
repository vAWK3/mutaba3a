import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { todayFor } from '../agreements/compose.js';
import { agentPersonWriteGate, agentWriteGate } from '../auth/billing-gate.js';
import { ApiError } from '../errors.js';
import { prepareExpenseCreate, touchExpenseVendor, withCategoryForeignKey, withResolvedVendor } from '../expenses/compose.js';
import { parseInboxAmount, inboxDate } from '../inbox/compose.js';
import { SUPPORTED_CURRENCIES, formatMoney, type Currency } from '../money.js';
import { agentProfile, assertAgentMayWrite, hasScope, idempotencyKeyInput, runTool, withToolIdempotency, type McpContext } from './context.js';
import { RECORDS_ARE_DATA } from './read-tools.js';

/**
 * MUT-436: the write tool. `add_expense` takes a required `destination` with no default, so the agent must ask the
 * person every time (AC1). A profile write runs the same compose path as POST /v1/expenses (MUT-227 floor, the
 * future-date rule, a choosable category, links inside the profile, vendors as typed); an inbox write runs POST
 * /v1/inbox's rules. Both carry an idempotency key (AC3) and mark the row `captureSource: 'mcp'` (ADR-201).
 */
export const CAPTURE_SOURCE_MCP = 'mcp';
const NOTE_MAX = 2000;

export const DESTINATION_REQUIRED =
  'destination is required. Ask the person whether this goes to their inbox or to one of their profiles (list_profiles), then call again.';

export interface WriteToolOptions {
  /** MCP_INBOX_WRITES (review D3/D5): off until the phone decodes 'mcp' and the minimum build is raised. */
  inboxWrites: boolean;
}

const text = (max: number) => z.string().trim().min(1).max(max);

function destinationInput(inboxWrites: boolean) {
  const profile = z.object({ kind: z.literal('profile'), profileId: z.string().uuid().describe('A profile id from list_profiles.') });
  const inbox = z.object({ kind: z.literal('inbox') });
  const error = { error: DESTINATION_REQUIRED };
  return (inboxWrites ? z.discriminatedUnion('kind', [profile, inbox], error) : z.discriminatedUnion('kind', [profile], error)).describe(
    inboxWrites
      ? 'Where it goes: { kind: "inbox" } (sort it later in MTB3A) or { kind: "profile", profileId }. Required, no default: ask the person.'
      : 'Where it goes: { kind: "profile", profileId }. Required, no default: ask the person which profile.',
  );
}

const ADD_EXPENSE_OUTPUT = {
  where: z.enum(['profile', 'inbox']),
  profileId: z.string().nullable(),
  id: z.string(),
  amount: z.string(),
  currency: z.string(),
  occurredOn: z.string(),
  vendor: z.string().nullable(),
  categoryId: z.string().nullable(),
  replayed: z.boolean(),
};

export function registerWriteTools(server: McpServer, ctx: McpContext, options: WriteToolOptions): void {
  if (!hasScope(ctx, 'write')) return;
  const userId = ctx.agent.user.id;

  server.registerTool(
    'add_expense',
    {
      title: 'Add an expense',
      description:
        'Record one expense the person confirmed. Before calling: show them the amount, date, vendor and where it goes, check find_similar_expenses for the same purchase, ' +
        `and ask for the category first (list_categories). destination has no default: ask every time. ${RECORDS_ARE_DATA} ` +
        'Send one idempotencyKey per source document; a retry with the same key returns the first answer (replayed: true) and records nothing new.',
      inputSchema: {
        destination: destinationInput(options.inboxWrites),
        amount: z.string().describe('Decimal amount as on the receipt, e.g. "45.90" (JOD takes 3 decimals).'),
        currency: z.enum(SUPPORTED_CURRENCIES),
        occurredOn: z.string().describe('The purchase date, YYYY-MM-DD.'),
        vendor: text(200).optional().describe('As written on the receipt, in its own language (Arabic, Hebrew, English).'),
        title: text(200).optional(),
        notes: z.string().max(NOTE_MAX).optional(),
        categoryId: z.string().uuid().optional().describe('Profile destination only (list_categories).'),
        customerId: z.string().uuid().optional().describe('Profile destination only, when the person says it is for a client (list_clients).'),
        projectId: z.string().uuid().optional().describe('Profile destination only.'),
        idempotencyKey: idempotencyKeyInput,
      },
      outputSchema: ADD_EXPENSE_OUTPUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) =>
      runTool(ctx, 'add_expense', ADD_EXPENSE_OUTPUT, async () => {
        const { destination, idempotencyKey, ...fields } = args;
        if (destination.kind === 'inbox') {
          if (!options.inboxWrites) throw new ApiError('FEATURE_NOT_ENABLED', 'Adding to the inbox is not available yet; choose a profile.', { feature: 'mcp_inbox_writes' });
          if (fields.categoryId || fields.customerId || fields.projectId) {
            throw new ApiError('VALIDATION_FAILED', 'The inbox holds an amount, a date and a note; file it to a profile to set a category or a client.', { field: 'destination' });
          }
          await agentPersonWriteGate(ctx.gateStore, userId, ctx.now(), ctx.billingGate);
          return withToolIdempotency(ctx, { kind: 'person' }, 'add_expense', { destination, idempotencyKey, ...fields }, async () => {
            const note = [fields.vendor, fields.title, fields.notes].filter((v): v is string => Boolean(v)).join(' · ');
            if (note.length > NOTE_MAX) throw new ApiError('VALIDATION_FAILED', `vendor, title and notes together exceed ${NOTE_MAX} characters for an inbox note`, { field: 'notes' });
            const entry = await ctx.store.inboxEntries.create(
              {
                userId,
                kind: 'EXPENSE',
                amountMinor: parseInboxAmount(fields.amount, fields.currency as Currency),
                currency: fields.currency,
                occurredOn: inboxDate(fields.occurredOn, ctx.now()),
                note: note || null,
                captureSource: CAPTURE_SOURCE_MCP,
              },
              ctx.now(),
            );
            return { where: 'inbox' as const, profileId: null, id: entry.id, amount: formatMoney({ minor: entry.amountMinor, currency: entry.currency as Currency }), currency: entry.currency, occurredOn: entry.occurredOn, vendor: fields.vendor ?? null, categoryId: null };
          });
        }

        const organization = await agentProfile(ctx, destination.profileId);
        await assertAgentMayWrite(ctx, organization, 'expenses');
        const now = ctx.now();
        await agentWriteGate(ctx.gateStore, organization, now, ctx.billingGate);
        return withToolIdempotency(ctx, { kind: 'profile', organizationId: organization.id }, 'add_expense', { destination, idempotencyKey, ...fields }, async () => {
          const prepared = await prepareExpenseCreate(ctx.store, organization.id, userId, todayFor(organization, now), { ...fields, currency: fields.currency as Currency, captureSource: CAPTURE_SOURCE_MCP });
          const input = await withResolvedVendor(ctx.store, organization.id, prepared, undefined, now);
          const expense = await withCategoryForeignKey(() => ctx.store.expenses.create(input, now));
          await touchExpenseVendor(ctx.store, expense, now);
          await ctx.store.audit.append({
            organizationId: organization.id,
            actorType: 'USER',
            actorId: userId,
            action: 'expense.created',
            entityType: 'expense',
            entityId: expense.id,
            metadata: { currency: expense.currency, occurredOn: expense.occurredOn, captureSource: CAPTURE_SOURCE_MCP, oauthClientId: ctx.agent.grant.clientId, grantId: ctx.agent.grant.id },
            requestId: ctx.requestId,
          });
          return { where: 'profile' as const, profileId: organization.id, id: expense.id, amount: formatMoney({ minor: expense.amountMinor, currency: expense.currency as Currency }), currency: expense.currency, occurredOn: expense.occurredOn, vendor: expense.vendor, categoryId: expense.categoryId };
        });
      }),
  );
}
