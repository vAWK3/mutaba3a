import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { agentWriteGate } from '../auth/billing-gate.js';
import { ApiError } from '../errors.js';
import {
  completeExpenseReceipt,
  completeLibraryReceipt,
  receiptAudit,
  signReceiptUpload,
  startExpenseReceipt,
  startLibraryReceipt,
  type ReceiptActor,
  type ReceiptDeps,
} from '../expenses/receipts-compose.js';
import type { RateLimiter } from '../rate-limit.js';
import type { Organization } from '../repositories/ports.js';
import { agentProfile, assertAgentMayWrite, hasScope, idempotencyKeyInput, runTool, withToolIdempotency, type McpContext } from './context.js';
import { CAPTURE_SOURCE_MCP } from './write-tools.js';

/**
 * MUT-436 (P2): receipts reach MTB3A the way the phone's do — a signed PUT URL, the bytes, then "complete" — through
 * the same receipts-compose code the routes run (type and size, room on the expense, the library's caps, the object
 * verified, the MUT-56 scan once it lands there; AC4). A client that can't make HTTP requests (a Claude.ai chat)
 * can't upload; the descriptions tell it to send the person to MTB3A instead.
 */
export interface ReceiptToolOptions extends Omit<ReceiptDeps, 'store'> {
  /** RECEIPTS_LIBRARY: a To-review target exists only where the library does. */
  receiptsLibrary: boolean;
  uploadLimiter: RateLimiter;
}

const UPLOAD_OUTPUT = {
  receiptId: z.string(),
  expenseId: z.string().nullable(),
  upload: z.object({ url: z.string(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expiresAt: z.string() }),
  replayed: z.boolean(),
};
const COMPLETE_OUTPUT = { receiptId: z.string(), expenseId: z.string().nullable(), status: z.string(), filingStatus: z.string() };

export function registerReceiptTools(server: McpServer, ctx: McpContext, options: ReceiptToolOptions): void {
  // Review D14 (MUT-437): like every write tool, only for a grant that can also read.
  if (!hasScope(ctx, 'write') || !hasScope(ctx, 'read')) return;
  const deps: ReceiptDeps = { store: ctx.store, storage: options.storage, urlTtlSeconds: options.urlTtlSeconds, reading: options.reading ?? null };
  const actorFor = (organization: Organization): ReceiptActor => ({
    organization,
    userId: ctx.agent.user.id,
    requestId: ctx.requestId,
    now: ctx.now(),
    audit: receiptAudit(ctx.store, { organizationId: organization.id, userId: ctx.agent.user.id, requestId: ctx.requestId }),
  });

  async function writableProfile(profileId: string): Promise<Organization> {
    const organization = await agentProfile(ctx, profileId);
    await assertAgentMayWrite(ctx, organization, 'expenses');
    await agentWriteGate(ctx.gateStore, organization, ctx.now(), ctx.billingGate);
    return organization;
  }

  const expenseTarget = z.object({ kind: z.literal('expense'), expenseId: z.string().uuid().describe('An expense id: from add_expense, file_inbox_entry or find_similar_expenses.') });
  const target = options.receiptsLibrary
    ? z.discriminatedUnion('kind', [expenseTarget, z.object({ kind: z.literal('to_review') })]).describe('{ kind: "expense", expenseId } to attach it to that expense, or { kind: "to_review" } to leave it for the person to review in MTB3A.')
    : expenseTarget.describe('{ kind: "expense", expenseId }: the expense this receipt belongs to.');

  server.registerTool(
    'start_receipt_upload',
    {
      title: 'Start a receipt upload',
      description:
        'Get a short-lived URL to upload one receipt file (PDF, JPEG or PNG, up to 10 MB). Then PUT the file bytes to upload.url with exactly upload.headers ' +
        '(for example: curl -X PUT -T receipt.pdf -H "Content-Type: application/pdf" …), then call complete_receipt_upload. ' +
        'If you cannot make HTTP requests yourself, do not call this: tell the person to attach the file in MTB3A. Each call holds an unfinished upload until it completes. ' +
        'For a receipt, call find_similar_expenses first and attach it to the look-alike the person confirms (one with hasReceipt false); after file_inbox_entry, use the expense id it returned.',
      inputSchema: {
        profileId: z.string().uuid().describe('A profile id from list_profiles.'),
        target,
        filename: z.string().min(1).max(255),
        mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
        sizeBytes: z.number().int().positive(),
        idempotencyKey: idempotencyKeyInput,
      },
      outputSchema: UPLOAD_OUTPUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) =>
      runTool(ctx, 'start_receipt_upload', UPLOAD_OUTPUT, async () => {
        const organization = await writableProfile(args.profileId);
        const file = { filename: args.filename, mimeType: args.mimeType, sizeBytes: args.sizeBytes };
        const result = await withToolIdempotency(ctx, { kind: 'profile', organizationId: organization.id }, 'start_receipt_upload', args, async () => {
          // The start budget and pending cap apply on both targets for an agent (review: no unlimited pending uploads).
          const limited = { ...deps, uploadLimiter: options.uploadLimiter };
          const started =
            args.target.kind === 'expense'
              ? await startExpenseReceipt(limited, actorFor(organization), args.target.expenseId, file)
              : await startLibraryReceipt(limited, actorFor(organization), file);
          return { receiptId: started.receipt.id, expenseId: started.receipt.expenseId, upload: started.upload };
        });
        // A replay after the signed URL expired gets a fresh one for the same receipt (review), not a dead URL.
        if (result.replayed && Date.parse(result.upload.expiresAt) <= ctx.now().getTime()) {
          const receipt = await ctx.store.expenseReceipts.getById(organization.id, result.receiptId);
          if (receipt && receipt.status !== 'READY') return { ...result, upload: await signReceiptUpload(deps, receipt, ctx.now()) };
        }
        return result;
      }),
  );

  server.registerTool(
    'complete_receipt_upload',
    {
      title: 'Finish a receipt upload',
      description: 'After the PUT succeeded: check the file arrived and attach it (or leave it To review). Safe to call again.',
      inputSchema: { profileId: z.string().uuid(), receiptId: z.string().uuid() },
      outputSchema: COMPLETE_OUTPUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ profileId, receiptId }) =>
      runTool(ctx, 'complete_receipt_upload', COMPLETE_OUTPUT, async () => {
        const organization = await writableProfile(profileId);
        const receipt = await ctx.store.expenseReceipts.getById(organization.id, receiptId);
        if (!receipt) throw new ApiError('NOT_FOUND', 'No such receipt');
        const audit = { captureSource: CAPTURE_SOURCE_MCP, oauthClientId: ctx.agent.grant.clientId, grantId: ctx.agent.grant.id };
        if (receipt.expenseId === null && !options.receiptsLibrary) throw new ApiError('NOT_FOUND', 'No such receipt');
        const done =
          receipt.expenseId !== null
            ? await completeExpenseReceipt(deps, actorFor(organization), receipt.expenseId, receipt.id, audit)
            : await completeLibraryReceipt(deps, actorFor(organization), receipt.id, audit);
        return { receiptId: done.id, expenseId: done.expenseId, status: done.status, filingStatus: done.filingStatus };
      }),
  );
}
