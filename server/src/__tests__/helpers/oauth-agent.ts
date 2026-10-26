import { expect, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../../app.js';
import { s256Challenge } from '../../oauth/protocol.js';
import type { ErrorContext, ErrorReporter } from '../../observability/reporter.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { provisionUser } from './provision.js';

/**
 * MUT-434/435: a test app with OAuth on, a flagged person and an agent connected the way Claude connects — shared by
 * the OAuth route tests and the MCP tool tests, which must run through the real /mcp so the agent store guard applies.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;
export const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

export const ORIGIN = 'http://localhost';
export const RESOURCE = `${ORIGIN}/mcp`;
export const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
export const JOB_TOKEN = 'test-job-token-with-at-least-32-characters!!';
export const COOKIE = 'mut_session';
export const SAME_ORIGIN = { origin: ORIGIN };
export const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
export const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
export const T0 = new Date('2026-10-25T09:00:00Z');
export const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

export function recordingReporter() {
  const messages: Array<{ level: string; message: string; tags: Record<string, string> | undefined }> = [];
  const exceptions: Array<{ error: unknown; context: ErrorContext | undefined }> = [];
  const reporter: ErrorReporter = {
    enabled: true,
    captureException: (error, context) => void exceptions.push({ error, context }),
    captureMessage: (level, message, tags) => void messages.push({ level, message, tags }),
    flush: async () => true,
  };
  return { reporter, messages, exceptions };
}

export function harness(options: { oauth?: boolean; registerLimit?: number; tokenClientLimit?: number; billingGate?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  let now = T0;
  const { reporter, messages, exceptions } = recordingReporter();
  const fetchMetadata = vi.fn();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => now,
    reporter,
    jobToken: JOB_TOKEN,
    billingGate: options.billingGate ?? false,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: false, trustedProxyHops: 1, portalOrigin: ORIGIN },
    oauth:
      options.oauth === false
        ? null
        : {
            deriveKey: 'derive-key-with-at-least-32-characters!!',
            fetchMetadata,
            limiters: {
              register: new SlidingWindowRateLimiter(options.registerLimit ?? 1000, 3_600_000),
              authorize: new SlidingWindowRateLimiter(1000),
              tokenClient: new SlidingWindowRateLimiter(options.tokenClientLimit ?? 1000),
              tokenIp: new SlidingWindowRateLimiter(1000),
              revoke: new SlidingWindowRateLimiter(1000),
            },
          },
  });
  return { app, store, messages, exceptions, fetchMetadata, setNow: (at: Date) => void (now = at), now: () => now };
}
export type Harness = ReturnType<typeof harness>;

export const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
export const form = (body: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

export async function person(h: Harness, { flag = true } = {}) {
  const email = `agent${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const userId = created.user.id as string;
  if (flag) expect((await h.app.request(`/admin/v1/users/${userId}/features/agent_access`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  return { cookie: { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN }, userId, password: created.password as string, personalId: created.personalProfile.id as string };
}
export type Person = Awaited<ReturnType<typeof person>>;

export async function register(h: Harness, redirect = CLAUDE_CB): Promise<string> {
  const res = await h.app.request('/oauth/register', json({ client_name: 'Claude', redirect_uris: [redirect] }));
  expect(res.status).toBe(201);
  return (await read(res)).client_id as string;
}

export async function authorize(h: Harness, clientId: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CLAUDE_CB, code_challenge: s256Challenge(VERIFIER), code_challenge_method: 'S256', state: 'st-1', resource: RESOURCE, ...extra });
  return h.app.request(`/oauth/authorize?${query.toString()}`);
}

export async function requestIdFrom(res: Response): Promise<string> {
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location') ?? '', ORIGIN);
  expect(location.pathname).toBe('/connect/approve');
  return location.searchParams.get('request') ?? '';
}

/** Register, authorize, approve as `p`, exchange: an agent's live tokens. */
export async function connect(h: Harness, p: Person) {
  const clientId = await register(h);
  const requestId = await requestIdFrom(await authorize(h, clientId));
  const decided = await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'approve' }, p.cookie));
  expect(decided.status).toBe(200);
  const code = new URL((await read(decided)).redirectTo).searchParams.get('code') ?? '';
  const res = await h.app.request('/oauth/token', form({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE }));
  expect(res.status).toBe(200);
  const tokens = (await read(res)) as { access_token: string; refresh_token: string };
  return { clientId, ...tokens, bearer: { authorization: `Bearer ${tokens.access_token}` } };
}

export const initialize = (h: Harness, headers: Record<string, string>) =>
  h.app.request('/mcp', { method: 'POST', headers: { ...MCP_HEADERS, ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });

