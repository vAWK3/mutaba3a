import { createHash, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect } from './qa';
import { address, grantFeature, liveState, operatorAccount, signInThroughForm } from './selfService';

/**
 * MUT-434/435: the agent's half of connecting to MTB3A, played with fetch against the live dev API — DCR registration,
 * PKCE, the token exchange, and JSON-RPC calls to /mcp. The person's half (sign-in, consent) happens in the browser.
 * The agent's redirect is a loopback address (Claude Code listens on one); the page routes it.
 */
const PASSWORD = 'the first long passphrase';
const HOME = /\/p\/[0-9a-f-]{36}$/;
export const CALLBACK = 'http://127.0.0.1:59871/callback';

export interface Agent {
  clientId: string;
  verifier: string;
  authorizeUrl: string;
}

/** The agent's half: DCR registration, then the authorize link it would open in the browser. */
export async function registerAgent(): Promise<Agent> {
  const { origin } = liveState();
  const res = await fetch(`${origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude Code', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', application_type: 'native' }),
  });
  expect(res.status, `register ${await res.clone().text()}`).toBe(201);
  const { client_id: clientId } = (await res.json()) as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'qa-state', resource: `${origin}/mcp` });
  return { clientId, verifier, authorizeUrl: `${origin}/oauth/authorize?${query.toString()}` };
}

/** Answers the loopback redirect inside the page, as the agent's local listener would, and returns where it landed. */
export async function catchCallback(page: Page): Promise<() => Promise<URL>> {
  let landed: URL | null = null;
  await page.route(`${CALLBACK}**`, async (route) => {
    landed = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>You can close this window.</p>' });
  });
  return async () => {
    await expect.poll(() => landed?.toString() ?? null, { message: 'the browser reached the agent’s redirect' }).not.toBeNull();
    return landed!;
  };
}

export async function exchange(agent: Agent, code: string): Promise<string> {
  const { origin } = liveState();
  const res = await fetch(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: agent.clientId, code, code_verifier: agent.verifier, redirect_uri: CALLBACK, resource: `${origin}/mcp` }).toString(),
  });
  expect(res.status, `token ${await res.clone().text()}`).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

export function mcpInitialize(accessToken: string): Promise<Response> {
  return fetch(`${liveState().origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa', version: '1' } } }),
  });
}

/** Sign in, approve on the consent page, exchange: a connected agent's access token. */
export async function connect(page: Page): Promise<string> {
  const agent = await registerAgent();
  const landed = await catchCallback(page);
  await page.goto(agent.authorizeUrl);
  await expect(page.getByRole('heading', { name: 'Connect an app' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  const code = (await landed()).searchParams.get('code') ?? '';
  return exchange(agent, code);
}


/** One JSON-RPC call to /mcp as the agent; the parsed body. */
export async function mcpCall(accessToken: string, method: string, params: Record<string, unknown> = {}): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const res = await fetch(`${liveState().origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}`, 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  expect(res.status, `/mcp ${method}`).toBe(200);
  return (await res.json()) as { result?: Record<string, unknown>; error?: unknown };
}

/** A person signed in to the portal through the form, with agent access or without; their id and personal profile. */
export async function person(page: Page, { agentAccess }: { agentAccess: boolean }): Promise<{ id: string; profileId: string }> {
  const email = address('agent');
  const { id } = await operatorAccount(email, 'en', PASSWORD);
  if (agentAccess) await grantFeature(id);
  await signInThroughForm(page, email, PASSWORD);
  await expect(page).toHaveURL(HOME);
  return { id, profileId: new URL(page.url()).pathname.split('/')[2] ?? '' };
}
