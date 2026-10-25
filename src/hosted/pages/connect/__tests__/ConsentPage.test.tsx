import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../../__tests__/harness';
import { consentNavigation } from '../consentSearch';

/**
 * MUT-434: `/connect/approve` — who is asking and what it may do, Allow/Deny sending the browser to the agent (AC1),
 * the refusal without agent_access (AC2), answered or expired requests (Q2), and /oauth/authorize's page errors (D1).
 */
const REQUEST_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PATH = `/v1/oauth/requests/${REQUEST_ID}`;
const CODE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback?code=mac_x&state=st&iss=https%3A%2F%2Fapp.example.test';
const DENY_REDIRECT = 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=st&iss=https%3A%2F%2Fapp.example.test';

function request(overrides: Record<string, unknown> = {}) {
  return { id: REQUEST_ID, client: { name: 'Claude', kind: 'DCR', trust: 'VERIFIED', redirectHost: 'claude.ai' }, scopes: ['read', 'write'], expiresAt: '2026-10-25T10:30:00.000Z', agentAccess: true, ...overrides };
}

function portal(path: string, routes: Record<string, Handler> = {}) {
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile()])),
    ...emptyProfileRoutes(),
    [`GET ${PATH}`]: () => ok(request()),
    [`POST ${PATH}/decision`]: (req) => ok({ redirectTo: req.body?.decision === 'approve' ? CODE_REDIRECT : DENY_REDIRECT }),
    ...routes,
  });
  return { ...renderPortal(path), api };
}
const calls = (all: StubRequest[], method: string, path: string) => all.filter((c) => c.method === method && c.url.pathname === path);

afterEach(() => vi.restoreAllMocks());

describe('consent page (MUT-434)', () => {
  it('shows who is asking, how far it is trusted and what it may do', async () => {
    portal(`/connect/approve?request=${REQUEST_ID}`);
    expect(await screen.findByRole('heading', { name: 'Connect an app' })).toBeInTheDocument();
    expect(screen.getByText('Claude')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('This is Claude, by Anthropic.')).toBeInTheDocument();
    expect(screen.getByText(/See your profiles, clients/)).toBeInTheDocument();
    expect(screen.getByText(/Add expenses to your inbox/)).toBeInTheDocument();
  });

  it('Allow sends the browser to the agent with its code (AC1)', async () => {
    const assign = vi.spyOn(consentNavigation, 'assign').mockImplementation(() => undefined);
    const { user, api } = portal(`/connect/approve?request=${REQUEST_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(CODE_REDIRECT));
    expect(calls(api.calls, 'POST', `${PATH}/decision`).map((c) => c.body)).toEqual([{ decision: 'approve' }]);
  });

  it('Deny sends access_denied back, and both buttons lock while deciding', async () => {
    const assign = vi.spyOn(consentNavigation, 'assign').mockImplementation(() => undefined);
    const { user } = portal(`/connect/approve?request=${REQUEST_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(DENY_REDIRECT));
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
  });

  it('warns about an unverified app and names where it sends you', async () => {
    portal(`/connect/approve?request=${REQUEST_ID}`, { [`GET ${PATH}`]: () => ok(request({ client: { name: 'Claude', kind: 'DCR', trust: 'UNVERIFIED', redirectHost: 'evil.example' } })) });
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('We couldn’t verify this app');
    expect(note).toHaveTextContent('evil.example');
  });

  it('without agent_access refuses plainly, and Back to Claude denies (AC2)', async () => {
    const assign = vi.spyOn(consentNavigation, 'assign').mockImplementation(() => undefined);
    const { user, api } = portal(`/connect/approve?request=${REQUEST_ID}`, { [`GET ${PATH}`]: () => ok(request({ agentAccess: false })) });
    expect(await screen.findByRole('heading', { name: 'Connecting apps isn’t on for you' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to Claude' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(DENY_REDIRECT));
    expect(calls(api.calls, 'POST', `${PATH}/decision`).map((c) => c.body)).toEqual([{ decision: 'deny' }]);
  });

  it('an answered or expired request says to start again', async () => {
    portal(`/connect/approve?request=${REQUEST_ID}`, { [`GET ${PATH}`]: () => fail(404, 'NOT_FOUND') });
    expect(await screen.findByText('This request has expired or was already answered.')).toBeInTheDocument();
    expect(screen.getByText('Go back to your app and start connecting again.')).toBeInTheDocument();
  });

  it('a 409 on a second click re-reads the request and shows it is gone (Q2)', async () => {
    let answered = false;
    const { user } = portal(`/connect/approve?request=${REQUEST_ID}`, {
      [`GET ${PATH}`]: () => (answered ? fail(404, 'NOT_FOUND') : ok(request())),
      [`POST ${PATH}/decision`]: () => {
        answered = true;
        return fail(409, 'CONFLICT', { reason: 'REQUEST_GONE' });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('This request has expired or was already answered.')).toBeInTheDocument();
  });

  it.each([
    ['invalid_client', 'This app isn’t registered correctly with MTB3A.'],
    ['invalid_redirect_uri', 'This app asked to send you somewhere it didn’t register.'],
    ['something_else', 'Something went wrong with this request.'],
  ])('shows /oauth/authorize’s %s error on the page, never redirecting', async (code, text) => {
    portal(`/connect/approve?error=${code}`);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('back from sign-in, a next carrying ?request= lands on the consent page with the request intact', async () => {
    const { router } = portal(`/sign-in?next=${encodeURIComponent(`/connect/approve?request=${REQUEST_ID}`)}`);
    expect(await screen.findByRole('heading', { name: 'Connect an app' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/connect/approve?request=${REQUEST_ID}`);
  });

  it('signed out, goes to sign-in and keeps the request in next', async () => {
    const { router } = portal(`/connect/approve?request=${REQUEST_ID}`, { 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    await waitFor(() => expect(locationOf(router)).toMatch(/^\/sign-in\?next=/));
    const next = new URL(locationOf(router), 'http://portal.test').searchParams.get('next');
    expect(next).toBe(`/connect/approve?request=${REQUEST_ID}`);
  });
});
