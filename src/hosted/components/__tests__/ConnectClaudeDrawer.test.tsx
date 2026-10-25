import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../__tests__/harness';

/**
 * MUT-434 (D15): You › Account › Connect Claude (`?connectClaude=true`) — only with agent_access; the MCP address to
 * copy, the two how-tos, and Connected apps with an in-row Disconnect confirm (AC3).
 */
const MCP_URL = 'https://app.mtb3a.com/mcp';
const CLAUDE = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clientName: 'Claude', clientKind: 'DCR', trust: 'VERIFIED', scopes: ['read', 'write'], connectedAt: '2026-10-20T09:00:00.000Z', lastUsedAt: null, expiresAt: '2027-04-18T09:00:00.000Z' };
const CODE = { ...CLAUDE, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', clientName: 'Claude Code', trust: 'LOOPBACK', scopes: ['read'], lastUsedAt: '2026-10-24T09:00:00.000Z' };

function withAgentAccess() {
  const person = me([profile()]);
  person.user.features = ['agent_access'];
  return person;
}

function portal(path: string, options: { flag?: boolean; items?: unknown[]; routes?: Record<string, Handler> } = {}) {
  let items = [...(options.items ?? [CLAUDE, CODE])];
  const api = stubApi({
    'GET /v1/me': () => ok(options.flag === false ? me([profile()]) : withAgentAccess()),
    ...emptyProfileRoutes(),
    'GET /v1/oauth/grants': () => ok({ items, mcpUrl: MCP_URL }),
    ...Object.fromEntries(
      [CLAUDE.id, CODE.id].map((id) => [
        `DELETE /v1/oauth/grants/${id}`,
        () => {
          items = items.filter((g) => (g as { id: string }).id !== id);
          return new Response(null, { status: 204 });
        },
      ]),
    ),
    ...options.routes,
  });
  return { ...renderPortal(path), api };
}
const calls = (all: StubRequest[], method: string, path: string) => all.filter((c) => c.method === method && c.url.pathname === path);

describe('Connect Claude (MUT-434)', () => {
  it('is a You › Account row only with agent_access, and opens as a drawer', async () => {
    const { user, router } = portal(`/p/${ORG_A}/you/account`);
    await user.click(await screen.findByRole('button', { name: /^Connect Claude/ }));
    expect(await screen.findByRole('dialog', { name: 'Connect Claude' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}/you/account?connectClaude=true`);
  });

  it('has no row without agent_access, and the drawer only says it is off', async () => {
    const { api } = portal(`/p/${ORG_A}/you/account?connectClaude=true`, { flag: false });
    expect(await screen.findByText(/isn’t turned on for your account/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Connect Claude/ })).toBeNull();
    expect(calls(api.calls, 'GET', '/v1/oauth/grants')).toHaveLength(0);
  });

  it('shows the MCP address to copy and both how-tos', async () => {
    const { user } = portal(`/p/${ORG_A}/you/account?connectClaude=true`);
    const field = await screen.findByLabelText('MCP address');
    expect(field).toHaveValue(MCP_URL);
    expect(field).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(`claude mcp add --transport http mtb3a ${MCP_URL}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    // userEvent stands in for the system clipboard.
    expect(await navigator.clipboard.readText()).toBe(MCP_URL);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('lists connected apps with their trust, dates and scope', async () => {
    portal(`/p/${ORG_A}/you/account?connectClaude=true`);
    const list = (await screen.findByRole('button', { name: 'Disconnect Claude' })).closest('ul')!;
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^ClaudeClaude · Connected .* · Not used yet · Can read and addDisconnect$/),
      expect.stringMatching(/^Claude CodeAn app on your computer · Connected .* · Last used .* · Can readDisconnect$/),
    ]);
  });

  it('disconnects after an in-row confirm, and Cancel returns to the button', async () => {
    const { user, api } = portal(`/p/${ORG_A}/you/account?connectClaude=true`);
    await user.click(await screen.findByRole('button', { name: 'Disconnect Claude' }));
    const confirm = screen.getByRole('group');
    expect(confirm).toHaveTextContent('Disconnect Claude? It loses access right away.');
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect Claude' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Disconnect Claude' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Claude disconnected')).toBeInTheDocument();
    expect(calls(api.calls, 'DELETE', `/v1/oauth/grants/${CLAUDE.id}`)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Disconnect Claude' })).toBeNull());
  });

  it('says so when disconnecting fails, and keeps the row', async () => {
    const { user } = portal(`/p/${ORG_A}/you/account?connectClaude=true`, { routes: { [`DELETE /v1/oauth/grants/${CLAUDE.id}`]: () => fail(500, 'INTERNAL') } });
    await user.click(await screen.findByRole('button', { name: 'Disconnect Claude' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t disconnect');
  });

  it('has an empty state', async () => {
    portal(`/p/${ORG_A}/you/account?connectClaude=true`, { items: [] });
    expect(await screen.findByText('No apps connected yet.')).toBeInTheDocument();
  });
});
