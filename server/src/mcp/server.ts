import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentIdentity } from '../auth/middleware.js';
import type { LedgerStore } from '../repositories/ports.js';

export const MCP_SERVER_NAME = 'mtb3a';

/**
 * MUT-434: the MCP server one /mcp request talks to, built per request for the authenticated agent (stateless).
 * It registers no tools yet (D10): MUT-435 adds the read tools here and MUT-436 the write tools, each opening its store
 * methods in the agent guard deliberately. `agent` and `store` are the seam they build on.
 */
export function createMcpServer(context: { agent: AgentIdentity; store: LedgerStore; version: string }): McpServer {
  void context.agent;
  void context.store;
  return new McpServer(
    { name: MCP_SERVER_NAME, version: context.version },
    { instructions: 'MTB3A keeps a freelancer’s income and expenses. Show the person what you found and ask before you write anything.' },
  );
}
