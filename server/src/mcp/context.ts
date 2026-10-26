import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
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
  return organization;
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

/** For lists the store returns whole (a profile's categories, a person's profiles): an offset cursor over them. */
export function pageOf<T>(items: readonly T[], cursor: string | undefined, limit = TOOL_PAGE_DEFAULT): { items: T[]; nextCursor: string | null } {
  const start = cursor === undefined ? 0 : decodeOffset(cursor);
  const end = start + limit;
  return { items: items.slice(start, end), nextCursor: end < items.length ? Buffer.from(JSON.stringify({ o: end }), 'utf8').toString('base64url') : null };
}

function decodeOffset(cursor: string): number {
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0) return o;
  } catch {
    // fall through
  }
  throw new ApiError('VALIDATION_FAILED', 'cursor is not a cursor this tool issued', { field: 'cursor' });
}
