import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { authenticateAgent, type AgentAuthOptions } from '../auth/agent-auth.js';
import type { AppEnv } from '../auth/middleware.js';
import { createMcpServer } from '../mcp/server.js';
import type { ErrorReporter } from '../observability/reporter.js';
import type { LedgerStore } from '../repositories/ports.js';

export interface McpRouteOptions extends AgentAuthOptions {
  /** The guarded store tools will read through (the agent guard set by authenticateAgent applies). */
  guardedStore: LedgerStore;
  /** MUT-435: where a tool's unexpected failure goes (the agent only sees a retry message). */
  reporter: ErrorReporter;
  version: string;
}

/**
 * MUT-434: the MCP endpoint (streamable HTTP, stateless, JSON responses). Every request authenticates the agent first;
 * then a fresh server and transport answer it. GET (a server-sent event stream) and DELETE (ending a session) have no
 * meaning without sessions, so they answer 405 (OV9).
 */
export function mcpRoutes(options: McpRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/mcp', authenticateAgent(options));

  app.on(['GET', 'DELETE'], '/mcp', (c) => {
    c.header('Allow', 'POST');
    return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this MCP server is stateless; use POST' }, id: null }, 405);
  });

  app.post('/mcp', async (c) => {
    const server = createMcpServer({ agent: c.get('agent'), store: options.guardedStore, reporter: options.reporter, version: options.version });
    // No sessionIdGenerator: stateless mode, a fresh server per request.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });

  return app;
}
