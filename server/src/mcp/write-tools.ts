import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { todayFor } from '../agreements/compose.js';
import { agentPersonWriteGate, agentWriteGate } from '../auth/billing-gate.js';
import { ApiError } from '../errors.js';
import { prepareExpenseCreate, touchExpenseVendor, withCategoryForeignKey, withResolvedVendor } from '../expenses/compose.js';
import type { MatchProbe } from '../expenses/similarity.js';
import { parseInboxAmount, inboxDate } from '../inbox/compose.js';
import { commitInboxExpenseFiling, prepareInboxExpenseFiling } from '../inbox/file-expense.js';
import { SUPPORTED_CURRENCIES, formatMoney, type Currency } from '../money.js';
import type { ExpenseRecord } from '../repositories/ports.js';
import { agentProfile, assertAgentMayWrite, hasScope, idempotencyKeyInput, runTool, withToolIdempotency, type McpContext } from './context.js';
import { INBOX_NOTE_SEPARATOR, LOOK_ALIKE_ITEM, RECORDS_ARE_DATA, STATEMENT_LINES, findLookAlikes, type LookAlike } from './read-tools.js';

/**
 * MUT-436: the write tools. `add_expense` takes a required `destination` with no default, so the agent must ask the
 * person every time (AC1). A profile write runs the same compose path as POST /v1/expenses (MUT-227 floor, the
 * future-date rule, a choosable category, links inside the profile, vendors as typed); an inbox write runs POST
 * /v1/inbox's rules. Both carry an idempotency key (AC3) and mark the row `captureSource: 'mcp'` (ADR-201).
 *
 * MUT-437: every agent expense write — add_expense and file_inbox_entry — refuses to write while a look-alike exists
 * (one purchase is one expense). Inside the person's write lock (D15): validate (no writes, D17), then the look-alike
 * check, then write. A look-alike answers `outcome: 'matched'` and releases the idempotency key (D5), so the retry with
 * `notDuplicateOf` reuses it.
 */
export const CAPTURE_SOURCE_MCP = 'mcp';
const NOTE_MAX = 2000;
/** Review D12: the ids a person can call "a different purchase" in one call; the look-alikes come 10 at a time. */
const NOT_DUPLICATE_MAX = 100;

export const DESTINATION_REQUIRED =
  'destination is required. Ask the person whether this goes to their inbox or to one of their profiles (list_profiles), then call again.';

const MATCHED_FLOW =
  'If outcome is "matched", nothing was written: show the person the candidates and ask. The same purchase: attach the receipt to it with start_receipt_upload when canAttachReceipt is true and hasReceipt is false; ' +
  'for an inbox candidate, file it first with file_inbox_entry; otherwise skip this one. A different purchase: call again with the same idempotencyKey and notDuplicateOf listing the ids shown. ' +
  'With several candidates the person chooses; never pick one. Call this tool one call at a time, never in parallel.';

export interface WriteToolOptions {
  /** MCP_INBOX_WRITES (review D3/D5): off until the phone decodes 'mcp' and the minimum build is raised. */
  inboxWrites: boolean;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const notDuplicateOfInput = z
  .array(z.string().uuid())
  .max(NOT_DUPLICATE_MAX)
  .optional()
  .describe('Ids of look-alikes the person said are a different purchase (from an earlier "matched" answer). Only after asking.');

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

const WRITE_OUTPUT = {
  outcome: z.enum(['created', 'matched']),
  expense: z
    .object({
      where: z.enum(['profile', 'inbox']),
      profileId: z.string().nullable(),
      id: z.string(),
      amount: z.string(),
      currency: z.string(),
      occurredOn: z.string(),
      vendor: z.string().nullable(),
      categoryId: z.string().nullable(),
    })
    .nullable(),
  candidates: z.array(LOOK_ALIKE_ITEM),
  replayed: z.boolean(),
};

/** Thrown inside the idempotent work: not an ApiError, so runIdempotent releases the key instead of storing it. */
class LookAlikesFound extends Error {
  constructor(readonly candidates: LookAlike[]) {
    super('look-alikes found');
  }
}

async function assertNoLookAlikes(ctx: McpContext, probe: MatchProbe, exclude: Iterable<string>): Promise<void> {
  const found = await findLookAlikes(ctx, probe, { exclude: new Set(exclude) });
  if (found.items.length > 0) throw new LookAlikesFound(found.items);
}

/** One agent expense write: the person's lock (D15) around the idempotent work; a look-alike becomes the `matched` answer. */
async function guardedWrite(
  ctx: McpContext,
  scope: Parameters<typeof withToolIdempotency>[1],
  tool: string,
  args: Record<string, unknown>,
  work: () => Promise<{ outcome: 'created'; expense: Record<string, unknown>; candidates: LookAlike[] }>,
): Promise<Record<string, unknown>> {
  try {
    return await ctx.store.agentWriteLock.run(ctx.agent.user.id, () => withToolIdempotency(ctx, scope, tool, args, work));
  } catch (err) {
    if (err instanceof LookAlikesFound) return { outcome: 'matched', expense: null, candidates: err.candidates, replayed: false };
    throw err;
  }
}

function profileExpenseView(expense: ExpenseRecord) {
  return {
    where: 'profile' as const,
    profileId: expense.organizationId,
    id: expense.id,
    amount: formatMoney({ minor: expense.amountMinor, currency: expense.currency as Currency }),
    currency: expense.currency,
    occurredOn: expense.occurredOn,
    vendor: expense.vendor,
    categoryId: expense.categoryId,
  };
}

export function registerWriteTools(server: McpServer, ctx: McpContext, options: WriteToolOptions): void {
  // Review D14: writing means checking first, so a write-only grant gets no write tools (and never sees look-alikes).
  if (!hasScope(ctx, 'write') || !hasScope(ctx, 'read')) return;
  const userId = ctx.agent.user.id;
  const auditGrant = { oauthClientId: ctx.agent.grant.clientId, grantId: ctx.agent.grant.id };

  server.registerTool(
    'add_expense',
    {
      title: 'Add an expense',
      description:
        'Record one expense the person confirmed. Before calling: show them the amount, date, vendor and where it goes, ' +
        `and ask for the category first (list_categories). destination has no default: ask every time. ${STATEMENT_LINES} ` +
        `MTB3A checks for the same purchase across all their profiles and inbox before writing. ${MATCHED_FLOW} ${RECORDS_ARE_DATA} ` +
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
        notDuplicateOf: notDuplicateOfInput,
        idempotencyKey: idempotencyKeyInput,
      },
      outputSchema: WRITE_OUTPUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) =>
      runTool(ctx, 'add_expense', WRITE_OUTPUT, async () => {
        // notDuplicateOf is the person's answer, not the request: it stays out of the fingerprint so the retry reuses the key.
        const { destination, idempotencyKey, notDuplicateOf = [], ...fields } = args;
        const meaning = { destination, idempotencyKey, ...fields };
        if (destination.kind === 'inbox') {
          if (!options.inboxWrites) throw new ApiError('FEATURE_NOT_ENABLED', 'Adding to the inbox is not available yet; choose a profile.', { feature: 'mcp_inbox_writes' });
          if (fields.categoryId || fields.customerId || fields.projectId) {
            throw new ApiError('VALIDATION_FAILED', 'The inbox holds an amount, a date and a note; file it to a profile to set a category or a client.', { field: 'destination' });
          }
          await agentPersonWriteGate(ctx.gateStore, userId, ctx.now(), ctx.billingGate);
          return guardedWrite(ctx, { kind: 'person' }, 'add_expense', meaning, async () => {
            const note = [fields.vendor, fields.title, fields.notes].filter((v): v is string => Boolean(v)).join(INBOX_NOTE_SEPARATOR);
            if (note.length > NOTE_MAX) throw new ApiError('VALIDATION_FAILED', `vendor, title and notes together exceed ${NOTE_MAX} characters for an inbox note`, { field: 'notes' });
            const amountMinor = parseInboxAmount(fields.amount, fields.currency as Currency);
            const occurredOn = inboxDate(fields.occurredOn, ctx.now());
            await assertNoLookAlikes(ctx, { amountMinor, currency: fields.currency, occurredOn, vendor: fields.vendor }, notDuplicateOf);
            const entry = await ctx.store.inboxEntries.create(
              { userId, kind: 'EXPENSE', amountMinor, currency: fields.currency, occurredOn, note: note || null, captureSource: CAPTURE_SOURCE_MCP },
              ctx.now(),
            );
            const expense = { where: 'inbox' as const, profileId: null, id: entry.id, amount: formatMoney({ minor: entry.amountMinor, currency: entry.currency as Currency }), currency: entry.currency, occurredOn: entry.occurredOn, vendor: fields.vendor ?? null, categoryId: null };
            return { outcome: 'created' as const, expense, candidates: [] };
          });
        }

        const organization = await agentProfile(ctx, destination.profileId);
        await assertAgentMayWrite(ctx, organization, 'expenses');
        const now = ctx.now();
        await agentWriteGate(ctx.gateStore, organization, now, ctx.billingGate);
        return guardedWrite(ctx, { kind: 'profile', organizationId: organization.id }, 'add_expense', meaning, async () => {
          const prepared = await prepareExpenseCreate(ctx.store, organization.id, userId, todayFor(organization, now), { ...fields, currency: fields.currency as Currency, captureSource: CAPTURE_SOURCE_MCP });
          await assertNoLookAlikes(ctx, { amountMinor: prepared.amountMinor, currency: prepared.currency, occurredOn: prepared.occurredOn, vendor: fields.vendor }, notDuplicateOf);
          // MUT-254: after the check, so a matched answer never leaves a vendor behind.
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
            metadata: { currency: expense.currency, occurredOn: expense.occurredOn, captureSource: CAPTURE_SOURCE_MCP, ...auditGrant },
            requestId: ctx.requestId,
          });
          return { outcome: 'created' as const, expense: profileExpenseView(expense), candidates: [] };
        });
      }),
  );

  // Review D7/D10: filing never creates an 'mcp' inbox row (the entry keeps its own source), so MCP_INBOX_WRITES does not gate it.
  server.registerTool(
    'file_inbox_entry',
    {
      title: 'File an inbox entry to a profile',
      description:
        'Move one entry from the person’s inbox (list_inbox, or an inbox candidate from find_similar_expenses) into a profile as an expense, so a receipt can then be attached to it. ' +
        'profileId has no default: ask which profile, and ask for the category first (list_categories). The amount, currency and date come from the entry. ' +
        `MTB3A checks for the same purchase in their profiles before filing. ${MATCHED_FLOW} ` +
        `Attach a receipt with the expense id this returns: the inbox entry is gone once filed. ${RECORDS_ARE_DATA}`,
      inputSchema: {
        inboxEntryId: z.string().uuid().describe('An inbox entry id (list_inbox, or find_similar_expenses with where: "inbox").'),
        profileId: z.string().uuid().describe('A profile id from list_profiles. Required, no default: ask the person.'),
        categoryId: z.string().uuid().optional().describe('list_categories'),
        vendor: text(200).optional().describe('As written on the receipt, in its own language.'),
        title: text(200).optional(),
        customerId: z.string().uuid().optional().describe('Only when the person says it is for a client (list_clients).'),
        projectId: z.string().uuid().optional(),
        notDuplicateOf: notDuplicateOfInput,
        idempotencyKey: idempotencyKeyInput,
      },
      outputSchema: WRITE_OUTPUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) =>
      runTool(ctx, 'file_inbox_entry', WRITE_OUTPUT, async () => {
        const { inboxEntryId, profileId, notDuplicateOf = [], idempotencyKey, ...body } = args;
        const organization = await agentProfile(ctx, profileId);
        await assertAgentMayWrite(ctx, organization, 'expenses');
        const now = ctx.now();
        await agentWriteGate(ctx.gateStore, organization, now, ctx.billingGate);
        return guardedWrite(ctx, { kind: 'profile', organizationId: organization.id }, 'file_inbox_entry', { inboxEntryId, profileId, idempotencyKey, ...body }, async () => {
          const entry = await ctx.store.inboxEntries.getById(userId, inboxEntryId);
          if (!entry) throw new ApiError('NOT_FOUND', 'No such inbox entry');
          const prepared = await prepareInboxExpenseFiling(ctx.store, { organization, userId, entry, body, now });
          // The entry itself is a look-alike of what it becomes (review D13): left out of its own check.
          await assertNoLookAlikes(ctx, { amountMinor: entry.amountMinor, currency: entry.currency, occurredOn: entry.occurredOn, vendor: body.vendor }, [...notDuplicateOf, entry.id]);
          const expense = await commitInboxExpenseFiling(ctx.store, prepared, { now, requestId: ctx.requestId, auditMetadata: auditGrant });
          return { outcome: 'created' as const, expense: profileExpenseView(expense), candidates: [] };
        });
      }),
  );
}
