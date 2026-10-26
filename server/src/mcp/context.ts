import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { agentPersonReadRefusal, agentReadRefusal, type GateStore } from '../auth/billing-gate.js';
import { mayWriteFor, profileWriterOf, type Domain } from '../auth/writability.js';
import { requestFingerprint, runIdempotent, type ClaimOps } from '../idempotency.js';
import type { AgentIdentity } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import type { OAuthScope } from '../oauth/protocol.js';
import type { ErrorReporter } from '../observability/reporter.js';
import { ownsProfile } from '../personal-profile.js';
import type { LedgerStore, Organization } from '../repositories/ports.js';

/**
 * MUT-435: what every MCP tool runs with, for one /mcp request. `store` is the request-scoped (guarded) store: every
 * call a tool makes passes the agent guard (AGENT_STORE_METHODS), because the tool runs inside the request.
 */
export interface McpContext {
  agent: AgentIdentity;
  store: LedgerStore;
  /** The raw store narrowed to what the lapse gate reads (billing facts are session-only under the agent guard). */
  gateStore: GateStore;
  /** The server's BILLING_GATE. */
  billingGate: boolean;
  reporter: ErrorReporter;
  now: () => Date;
  requestId: string;
}

export function hasScope(ctx: McpContext, scope: OAuthScope): boolean {
  return ctx.agent.grant.scopes.includes(scope);
}

/**
 * The one door from a tool to a profile (P1, ADR-200): the person must be a member AND own it — its creator or a
 * co-owner (`ownsProfile`, MUT-373). A firm, a Malafat-fed profile or another person's profile they only belong to
 * answers the same "not found" as an id that doesn't exist, so an agent learns nothing about what it can't see.
 */
export async function agentProfile(ctx: McpContext, profileId: string): Promise<Organization> {
  const membership = await ctx.store.memberships.find(ctx.agent.user.id, profileId);
  const organization = membership ? await ctx.store.organizations.getById(profileId) : null;
  if (!membership || !organization || !ownsProfile(organization, ctx.agent.user.id, membership.role)) {
    throw new ApiError('NOT_FOUND', 'Profile not found. Call list_profiles for the profiles you can use.');
  }
  const refusal = await agentReadRefusal(ctx.gateStore, organization, ctx.now(), ctx.billingGate);
  if (refusal) throw refusal;
  return organization;
}

/** The person's inbox may be read unless every profile they have is LOCKED (as a session's GET /v1/inbox). */
export async function inboxReadable(ctx: McpContext): Promise<ApiError | null> {
  return agentPersonReadRefusal(ctx.gateStore, ctx.agent.user.id, ctx.now(), ctx.billingGate);
}

/** The profiles an agent may read right now: owned or co-owned (P1), minus any LOCKED by billing (review D2). */
export async function readableProfiles(ctx: McpContext, profiles: readonly Organization[]): Promise<Organization[]> {
  const refusals = await Promise.all(profiles.map((o) => agentReadRefusal(ctx.gateStore, o, ctx.now(), ctx.billingGate)));
  return profiles.filter((_, i) => refusals[i] === null);
}

// ---- Results ---------------------------------------------------------------------------------------------------

export function toolResult<T extends Record<string, unknown>>(structuredContent: T): CallToolResult {
  return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] };
}

const RETRY_TEXT = 'INTERNAL: MTB3A had a problem answering this. Try again in a moment.';

/** Our own bug, not the agent's: Sentry hears it (tagged with the tool), the agent gets a plain retry message. */
function internalError(ctx: McpContext, tool: string, err: unknown): CallToolResult {
  ctx.reporter.captureException(err, { requestId: ctx.requestId, route: `mcp:${tool}` });
  return { isError: true, content: [{ type: 'text', text: RETRY_TEXT }] };
}

/**
 * A tool's failure as something the agent can read and act on: an API refusal keeps its code and message. A store
 * method the agent guard refused (a tool calling outside AGENT_STORE_METHODS) and anything unexpected are our bugs.
 */
export function toolError(ctx: McpContext, tool: string, err: unknown): CallToolResult {
  if (err instanceof ApiError && err.code !== 'PRINCIPAL_NOT_ACCEPTED') {
    const details = err.details ? ` ${JSON.stringify(err.details)}` : '';
    return { isError: true, content: [{ type: 'text', text: `${err.code}: ${err.message}${details}` }] };
  }
  return internalError(ctx, tool, err);
}

/**
 * Runs one tool call. The result is checked against the tool's own output schema here, before the SDK checks it again,
 * so drift between data and schema reaches Sentry instead of only the agent (the SDK reports nothing).
 */
export async function runTool(ctx: McpContext, tool: string, output: z.ZodRawShape, run: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    const result = await run();
    const checked = z.object(output).safeParse(result);
    if (!checked.success) return internalError(ctx, tool, new Error(`${tool} result does not match its output schema: ${checked.error.message}`));
    return toolResult(result);
  } catch (err) {
    return toolError(ctx, tool, err);
  }
}

// ---- Paging (AC4) -------------------------------------------------------------------------------------------------

export const TOOL_PAGE_MAX = 50;
export const TOOL_PAGE_DEFAULT = 25;

export const pagingInput = {
  limit: z.number().int().min(1).max(TOOL_PAGE_MAX).optional().describe(`Items per page, 1–${TOOL_PAGE_MAX} (default ${TOOL_PAGE_DEFAULT}).`),
  cursor: z.string().optional().describe('The nextCursor from the previous page; omit for the first page.'),
};

/**
 * For lists the store returns whole (a profile's categories, a person's profiles): an offset cursor over them, tagged
 * with the call that issued it (`scope`: the tool and the arguments that shape the list), so a cursor sent to another
 * call is refused instead of silently skipping or repeating items (review D5).
 */
export function pageOf<T>(items: readonly T[], scope: string, cursor: string | undefined, limit = TOOL_PAGE_DEFAULT): { items: T[]; nextCursor: string | null } {
  const start = cursor === undefined ? 0 : decodeOffset(cursor, scope);
  const end = start + limit;
  return { items: items.slice(start, end), nextCursor: end < items.length ? Buffer.from(JSON.stringify({ o: end, s: scope }), 'utf8').toString('base64url') : null };
}

function decodeOffset(cursor: string, scope: string): number {
  try {
    const { o, s } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown; s?: unknown };
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0 && s === scope) return o;
  } catch {
    // fall through
  }
  throw new ApiError('VALIDATION_FAILED', 'cursor is not a cursor this call issued: send nextCursor back to the same tool with the same arguments', { field: 'cursor' });
}

// ---- Writes (MUT-436) ---------------------------------------------------------------------------------------------

/**
 * Review R1/D2: an agent writes as its person's session would — the session's column of the writability matrix, on
 * this profile's writer of record. For `expenses` that is every profile (parity); the agent's real reach is the store
 * allow-list (AGENT_STORE_METHODS). Refuses with the matrix's own error.
 */
export async function assertAgentMayWrite(ctx: McpContext, organization: Organization, domain: Domain): Promise<void> {
  const writer = await profileWriterOf(ctx.gateStore, organization.id);
  if (!mayWriteFor('session', domain, writer)) throw new ApiError('READ_ONLY_PROFILE', 'This profile is read-only here', { writerOfRecord: writer });
}

/** The idempotency key every write tool takes (MCP has no header per call). */
export const idempotencyKeyInput = z
  .string()
  .regex(/^[A-Za-z0-9_\-:.]{8,128}$/, 'idempotencyKey: 8–128 characters of A–Z a–z 0–9 _ - : .')
  .describe('One key per source document (a receipt, a statement line), reused only to retry that same call: never for another purchase.');

/**
 * Review D7/R7: an agent key lives in its person's namespace (`a:` + SHA-256 of person and key), so a retry after a
 * reconnect (a new OAuth grant) still replays, and it can never collide with a session's or an API key's key.
 */
export function agentClaimKey(userId: string, key: string): string {
  return `a:${createHash('sha256').update(`${userId}\n${key}`).digest('hex')}`;
}

/**
 * One write tool call under its idempotency key. An API refusal (4xx, not 429) is stored and replays as the same
 * refusal (OV4); a 5xx/429 or anything unexpected releases the key. Returns the result, or rethrows the refusal.
 */
export async function withToolIdempotency<T extends Record<string, unknown>>(
  ctx: McpContext,
  scope: { kind: 'profile'; organizationId: string } | { kind: 'person' },
  tool: string,
  args: Record<string, unknown>,
  work: () => Promise<T>,
): Promise<T & { replayed: boolean }> {
  const { idempotencyKey, ...meaning } = args;
  const key = agentClaimKey(ctx.agent.user.id, String(idempotencyKey));
  const ops: ClaimOps =
    scope.kind === 'profile'
      ? {
          claim: (a) => ctx.store.idempotency.claim({ organizationId: scope.organizationId, ...a }),
          complete: (a) => ctx.store.idempotency.complete({ organizationId: scope.organizationId, ...a }),
          fail: (a) => ctx.store.idempotency.fail({ organizationId: scope.organizationId, ...a }),
        }
      : {
          claim: (a) => ctx.store.userIdempotency.claim({ userId: ctx.agent.user.id, ...a }),
          complete: (a) => ctx.store.userIdempotency.complete({ userId: ctx.agent.user.id, ...a }),
          fail: (a) => ctx.store.userIdempotency.fail({ userId: ctx.agent.user.id, ...a }),
        };
  const fingerprint = requestFingerprint('MCP', tool, JSON.stringify(meaning));
  const outcome = await runIdempotent(ops, { key, operation: `mcp.${tool}`, fingerprints: [fingerprint], now: ctx.now() }, async () => {
    try {
      return { status: 200, body: await work() };
    } catch (err) {
      if (err instanceof ApiError && err.status < 500 && err.status !== 429 && err.code !== 'PRINCIPAL_NOT_ACCEPTED') {
        return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details ?? null } } };
      }
      throw err;
    }
  });
  if (outcome.status >= 400) {
    const { error } = outcome.body as { error: { code: ConstructorParameters<typeof ApiError>[0]; message: string; details: unknown } };
    throw new ApiError(error.code, error.message, error.details ?? undefined);
  }
  return { ...(outcome.body as T), replayed: outcome.replayed };
}

