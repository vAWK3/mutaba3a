/**
 * MUT-487 (ADR-232, D6/D7, AM4, R5/D9): the legacy run.app forwarder.
 *
 * A run.app hostname belongs to its GCP project, so after MTB3A moved to mtb3a-production the old service in
 * malafat-production runs this instead of the API: a streaming reverse proxy to the new service, for the phone builds
 * that still call run.app (Dart doesn't follow redirects on a POST). It is its own entrypoint, `node dist/forwarder.js`
 * from the same image (Terraform's legacy_forwarder), and loads no config, no database and no secret but its token.
 *
 * Each request goes on as it came: method, path and query, headers, body; the response comes back the same way, and
 * redirects are never followed. The caller's IP is read from this service's own X-Forwarded-For (Cloud Run's front end
 * appends it: one hop) and handed over in x-mutaba3a-client-ip with the forwarder token, which the new service trusts
 * for the IP alone (auth/sessions.ts). A request that already carries the front door's header (the Cloudflare Worker,
 * until its upstream is repointed) passes through unchanged. MUT-521 retires it.
 */
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pathToFileURL } from 'node:url';
import { FORWARDER_HEADER, FRONT_DOOR_CLIENT_IP_HEADER, FRONT_DOOR_HEADER } from './auth/sessions.js';

/** Answered here, never relayed: Cloud Run's startup probe (Terraform's local.forwarder_health_path). */
export const FORWARDER_HEALTH_PATH = '/forwarder/health';
const DEFAULT_PORT = 8787;
const MIN_TOKEN_LENGTH = 32;

/** Hop-by-hop headers (RFC 9110 §7.6.1) belong to one connection and are never relayed. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

export interface ForwarderOptions {
  /** The new service's origin, e.g. https://mutaba3a-api-<hash>-zf.a.run.app (no path). */
  target: string;
  /** FORWARDER_TOKEN: vouches for the client IP to the new service. */
  token: string;
}

/** FORWARD_TO, FORWARDER_TOKEN and PORT from the environment; throws naming the variable that is wrong. */
export function readForwarderEnv(env: Record<string, string | undefined>): ForwarderOptions & { port: number } {
  const target = env.FORWARD_TO ?? '';
  if (!/^https:\/\/[^/]+$/.test(target)) throw new Error('FORWARD_TO must be the new service\'s https:// origin, with no path');
  const token = env.FORWARDER_TOKEN ?? '';
  if (token.length < MIN_TOKEN_LENGTH) throw new Error(`FORWARDER_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  const port = env.PORT ? Number(env.PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a port number');
  return { target, token, port };
}

/** The caller as Cloud Run's front end saw it: the last X-Forwarded-For entry (one trusted hop). */
function callerIp(headers: IncomingHttpHeaders, socketAddress: string | undefined): string {
  const forwarded = headers['x-forwarded-for'];
  const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  return chain.at(-1) ?? socketAddress ?? '';
}

function relayedHeaders(req: IncomingMessage, target: URL, token: string): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || name === 'host' || name === FORWARDER_HEADER) continue;
    out[name] = value;
  }
  out.host = target.host;
  out['x-forwarded-host'] = req.headers.host ?? '';
  out['x-forwarded-proto'] = 'https';
  // The Worker already vouched for this request with its own token and client IP: leave both as they are.
  if (req.headers[FRONT_DOOR_HEADER] === undefined) {
    out[FRONT_DOOR_CLIENT_IP_HEADER] = callerIp(req.headers, req.socket.remoteAddress);
    out[FORWARDER_HEADER] = token;
  }
  return out;
}

function relayedResponseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) out[name] = value;
  }
  return out;
}

function badGateway(res: ServerResponse): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error: { code: 'FORWARD_FAILED', message: 'The service could not be reached. Try again shortly.' } }));
}

/** The forwarder as an http.Server; the caller listens on it. */
export function createForwarder(options: ForwarderOptions): Server {
  const target = new URL(options.target);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return createServer((req, res) => {
    if (req.url === FORWARDER_HEALTH_PATH) {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('ok');
      return;
    }
    const upstream = send(
      { protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: req.method, path: req.url, headers: relayedHeaders(req, target, options.token) },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, relayedResponseHeaders(answer.headers));
        answer.pipe(res);
      },
    );
    upstream.on('error', () => badGateway(res));
    req.pipe(upstream);
  });
}

/* c8 ignore start: the process entrypoint, exercised on Cloud Run */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port, ...options } = readForwarderEnv(process.env);
  createForwarder(options).listen(port, () => {
    process.stdout.write(`${JSON.stringify({ level: 'info', msg: 'forwarder listening', port, target: options.target })}\n`);
  });
}
/* c8 ignore stop */
