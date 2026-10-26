import { DEFAULT_MAX_REQUEST_BODY_SIZE, readRequestBody, requestBodyTooLargeMessage } from '@modelcontextprotocol/sdk/server/requestBody.js';
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
    // Review D1: one request is one call. The rate limit counts requests, and protocol 2025-06-18 dropped JSON-RPC
    // batching, so an array body is refused before any tool runs (the SDK would run up to 100 calls at once). The body
    // is read once, under the SDK's own size cap, and handed to the transport parsed (re-review finding 1).
    const read = await readRequestBody(c.req.raw, DEFAULT_MAX_REQUEST_BODY_SIZE);
    if (read.tooLarge) return c.json({ jsonrpc: '2.0', error: { code: -32600, message: requestBodyTooLargeMessage(DEFAULT_MAX_REQUEST_BODY_SIZE) }, id: null }, 413);
    let body: unknown;
    try {
      body = JSON.parse(read.text);
    } catch {
      return c.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: the body is not JSON' }, id: null }, 400);
    }
    if (Array.isArray(body)) {
      return c.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: batching is not supported; send one JSON-RPC message per request' }, id: null }, 400);
    }
    const server = createMcpServer({
      agent: c.get('agent'),
      store: options.guardedStore,
      gateStore: options.store,
      billingGate: c.get('billingGate') === true,
      reporter: options.reporter,
      now: c.get('now'),
      requestId: c.get('requestId'),
      version: options.version,
    });
    // No sessionIdGenerator: stateless mode, a fresh server per request.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw, { parsedBody: body });
    } finally {
      await server.close();
    }
  });

  return app;
}
