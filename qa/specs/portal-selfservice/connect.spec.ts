import { createHash, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { address, chooseLanguage, grantFeature, liveState, operatorAccount, signInThroughForm } from '../../support/selfService';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-434: an MCP agent signs in with OAuth 2.1, against the live dev API (support/selfservice-live.mjs, with
 * OAUTH_DERIVE_KEY). The spec plays the agent with fetch — registration, PKCE, the token exchange and /mcp — and the
 * person in the browser. The agent's redirect is a loopback address (Claude Code listens on one); the page routes it,
 * so the browser "arrives" there and the spec reads the code from the URL.
 */

const PASSWORD = 'the first long passphrase';
const HOME = /\/p\/[0-9a-f-]{36}$/;
const CALLBACK = 'http://127.0.0.1:59871/callback';

interface Agent {
  clientId: string;
  verifier: string;
  authorizeUrl: string;
}

/** The agent's half: DCR registration, then the authorize link it would open in the browser. */
async function registerAgent(): Promise<Agent> {
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
async function catchCallback(page: Page): Promise<() => Promise<URL>> {
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

async function exchange(agent: Agent, code: string): Promise<string> {
  const { origin } = liveState();
  const res = await fetch(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: agent.clientId, code, code_verifier: agent.verifier, redirect_uri: CALLBACK, resource: `${origin}/mcp` }).toString(),
  });
  expect(res.status, `token ${await res.clone().text()}`).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

function mcpInitialize(accessToken: string): Promise<Response> {
  return fetch(`${liveState().origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa', version: '1' } } }),
  });
}

async function person(page: Page, { agentAccess }: { agentAccess: boolean }) {
  const email = address('agent');
  const { id } = await operatorAccount(email, 'en', PASSWORD);
  if (agentAccess) await grantFeature(id);
  await signInThroughForm(page, email, PASSWORD);
  await expect(page).toHaveURL(HOME);
}

/** Sign in, approve on the consent page, exchange: a connected agent's access token. */
async function connect(page: Page): Promise<string> {
  const agent = await registerAgent();
  const landed = await catchCallback(page);
  await page.goto(agent.authorizeUrl);
  await expect(page.getByRole('heading', { name: 'Connect an app' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  const code = (await landed()).searchParams.get('code') ?? '';
  return exchange(agent, code);
}

test.beforeEach(async ({ page }) => {
  await chooseLanguage(page, 'en');
});

test('An agent signs in through the consent page and initializes /mcp', { tag: '@portal-selfservice.connect.approve' }, async ({ page, step }) => {
  await person(page, { agentAccess: true });
  const agent = await registerAgent();
  const landed = await catchCallback(page);
  await step('The agent registers and opens the sign-in link', async () => {
    await page.goto(agent.authorizeUrl);
    await expect(page).toHaveURL(/\/connect\/approve\?request=/);
  });
  await step('On Connect an app, the agent is named and its reach is listed; press Allow', async () => {
    await expect(page.getByText('This is an app on your own computer, such as Claude Code.')).toBeVisible();
    await expect(page.getByText(/See your profiles, clients/)).toBeVisible();
    await expect(page.getByText(/Add expenses to your inbox/)).toBeVisible();
    await page.getByRole('button', { name: 'Allow' }).click();
  });
  let accessToken = '';
  await step('The browser lands on the agent’s redirect with a code and MTB3A’s issuer', async () => {
    const url = await landed();
    expect(url.searchParams.get('code')).toMatch(/^mac_/);
    expect(url.searchParams.get('state')).toBe('qa-state');
    expect(url.searchParams.get('iss')).toBe(liveState().origin);
    accessToken = await exchange(agent, url.searchParams.get('code') ?? '');
  });
  await step('/mcp answers the agent’s initialize as mtb3a', async () => {
    const res = await mcpInitialize(accessToken);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('mtb3a');
  });
});

test('Without agent access, the consent page refuses and sends the person back to the agent', { tag: '@portal-selfservice.connect.refused' }, async ({ page, step }) => {
  await person(page, { agentAccess: false });
  const agent = await registerAgent();
  const landed = await catchCallback(page);
  await step('Open the agent’s sign-in link', async () => {
    await page.goto(agent.authorizeUrl);
    await expect(page.getByRole('heading', { name: 'Connecting apps isn’t on for you' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  });
  await step('Press Back to the agent; it receives access_denied', async () => {
    await page.getByRole('button', { name: 'Back to Claude Code' }).click();
    expect((await landed()).searchParams.get('error')).toBe('access_denied');
  });
});

test('Disconnecting from You › Account ends the agent’s access on its next call', { tag: '@portal-selfservice.connect.revoke' }, async ({ page, step }) => {
  await person(page, { agentAccess: true });
  let accessToken = '';
  await step('Connect an agent', async () => {
    accessToken = await connect(page);
    expect((await mcpInitialize(accessToken)).status).toBe(200);
  });
  await step('Open You › Account › Connect Claude: the MCP address and the connected app', async () => {
    await page.goto('/');
    await openYou(page, 'account');
    await youRow(page, 'Connect Claude').click();
    const dialog = page.getByRole('dialog', { name: 'Connect Claude' });
    await expect(dialog.getByLabel('MCP address')).toHaveValue(`${liveState().origin}/mcp`);
    await expect(dialog.getByText('Claude Code', { exact: true })).toBeVisible();
  });
  await step('Press Disconnect and confirm', async () => {
    const dialog = page.getByRole('dialog', { name: 'Connect Claude' });
    await dialog.getByRole('button', { name: 'Disconnect Claude Code' }).click();
    await dialog.getByRole('group').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('Claude Code disconnected')).toBeVisible();
    await expect(dialog.getByText('No apps connected yet.')).toBeVisible();
  });
  await step('The agent’s next call is refused', async () => {
    expect((await mcpInitialize(accessToken)).status).toBe(401);
  });
});

test('Connect Claude is offered only to a person with agent access', { tag: '@portal-selfservice.connect.row-hidden' }, async ({ page, step }) => {
  await person(page, { agentAccess: false });
  await step('Open You › Account: there is no Connect Claude row', async () => {
    await openYou(page, 'account');
    await expect(youRow(page, 'Passkeys')).toBeVisible();
    await expect(youRow(page, 'Connect Claude')).toHaveCount(0);
  });
});
