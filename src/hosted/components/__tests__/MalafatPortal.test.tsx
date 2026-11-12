import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import type { Me } from '../../api/client';
import { payment } from '../../pages/__tests__/fixtures';

/**
 * MUT-596: what a Malafat lawyer sees in the portal besides signing in: You › Account › Connected apps, a Malafat
 * firm's members (read-only), "via Malafat" on what Malafat recorded, and the second way in for an account Sign in
 * with Malafat created.
 */

const GRANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONNECTION = { grantId: GRANT, clientName: 'Malafat', tenantId: 'tenant-sader', firmName: 'Sader Law Office', scopes: ['read', 'write'], connectedAt: '2026-11-10T09:00:00.000Z', lastUsedAt: null };

function portal(path: string, routes: Record<string, Handler> = {}, person: Me = me([profile()])) {
  const api = stubApi({ 'GET /v1/me': () => ok(person), ...emptyProfileRoutes(), ...routes });
  return { ...renderPortal(path), api };
}
const calls = (all: StubRequest[], method: string, path: string) => all.filter((c) => c.method === method && c.url.pathname === path);

function malafatMade(): Me {
  const person = me([profile()]);
  person.user.ownSignIn = false;
  person.user.ownPassword = false;
  return person;
}

beforeEach(() => localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en'));
afterEach(() => localStorage.clear());

describe('Connected apps', () => {
  it('has no row where the server has Malafat access off (the list answers 404)', async () => {
    portal(`/p/${ORG_A}/you/account`);
    expect(await screen.findByRole('button', { name: /^Change password/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Connected apps/ })).not.toBeInTheDocument();
  });

  it('lists Malafat per firm and disconnects it after an in-row confirm', async () => {
    let items = [CONNECTION];
    const { user, api, router } = portal(`/p/${ORG_A}/you/account`, {
      'GET /v1/me/connected-apps': () => ok({ items }),
      [`DELETE /v1/me/connected-apps/${GRANT}`]: () => {
        items = [];
        return new Response(null, { status: 204 });
      },
    });
    await user.click(await screen.findByRole('button', { name: /^Connected apps/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Connected apps' });
    expect(locationOf(router)).toBe(`/p/${ORG_A}/you/account?connectedApps=true`);
    expect(within(drawer).getByText('Sader Law Office')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Disconnect: Sader Law Office' }));
    expect(within(drawer).getByText(/Disconnect Malafat from Sader Law Office\?/)).toBeInTheDocument();
    expect(calls(api.calls, 'DELETE', `/v1/me/connected-apps/${GRANT}`)).toHaveLength(0);
    await user.click(within(drawer).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Malafat is disconnected from Sader Law Office.')).toBeInTheDocument();
    expect(calls(api.calls, 'DELETE', `/v1/me/connected-apps/${GRANT}`)).toHaveLength(1);
    expect(await within(drawer).findByText('No apps act for you.')).toBeInTheDocument();
  });

  it('Keep leaves the connection alone', async () => {
    const { user, api } = portal(`/p/${ORG_A}/you/account?connectedApps=true`, { 'GET /v1/me/connected-apps': () => ok({ items: [CONNECTION] }) });
    await user.click(await screen.findByRole('button', { name: 'Disconnect: Sader Law Office' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('button', { name: 'Disconnect: Sader Law Office' })).toBeInTheDocument();
    expect(calls(api.calls, 'DELETE', `/v1/me/connected-apps/${GRANT}`)).toHaveLength(0);
  });
});

describe("a Malafat firm's members", () => {
  const FIRM = 'f1111111-1111-4111-8111-111111111111';
  const firm = profile({ id: FIRM, name: 'Sader Law Office', firm: true, role: 'OWNER', owned: false, type: 'BUSINESS', writerOfRecord: null });

  it('lists the seats read-only, with their Malafat role, on You › Profiles under the open firm', async () => {
    portal(
      `/p/${FIRM}/you`,
      {
        'GET /v1/members': () =>
          ok({
            managedInMalafat: true,
            items: [
              { name: 'Rana Sader', role: 'OWNER', malafatRole: 'PARTNER', pending: false, you: true },
              { name: 'nadia@sader.law', role: null, malafatRole: 'ASSOCIATE', pending: true, you: false },
            ],
          }),
        'GET /v1/expense-categories': () => ok([]),
        'GET /v1/expenses': () => ok({ items: [], nextCursor: null }),
      },
      me([firm, profile()]),
    );
    const section = (await screen.findByRole('heading', { name: 'Members' })).closest('section')!;
    expect(within(section).getByText("This office's name and members are managed in Malafat.")).toBeInTheDocument();
    expect(within(section).getByText('Partner · owner')).toBeInTheDocument();
    expect(within(section).getByText('Associate · hasn\'t signed in yet')).toBeInTheDocument();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows nothing on a firm Malafat does not manage', async () => {
    const { api } = portal(
      `/p/${FIRM}/you`,
      { 'GET /v1/members': () => ok({ managedInMalafat: false, items: [] }), 'GET /v1/expense-categories': () => ok([]), 'GET /v1/expenses': () => ok({ items: [], nextCursor: null }) },
      me([firm, profile()]),
    );
    await waitFor(() => expect(calls(api.calls, 'GET', '/v1/members')).toHaveLength(1));
    expect(screen.queryByRole('heading', { name: 'Members' })).not.toBeInTheDocument();
  });
});

describe('via Malafat', () => {
  it('marks a payment Malafat recorded for the person', async () => {
    const recorded = { ...payment('p1', 'PAY-2026-0001'), origin: 'capture', captureSource: 'malafat' };
    const own = { ...payment('p2', 'PAY-2026-0002'), origin: 'capture', captureSource: 'app' };
    portal(`/p/${ORG_A}/payments`, { 'GET /v1/payments': () => ok({ items: [recorded, own], nextCursor: null }) });
    const row = (await screen.findByText('PAY-2026-0001')).closest('tr')!;
    expect(within(row).getByText('Malafat')).toBeInTheDocument();
    expect(within(row).getByText('Malafat').closest('.badge, [class*="badge"]')).toHaveTextContent('via Malafat');
    const other = screen.getByText('PAY-2026-0002').closest('tr')!;
    expect(within(other).queryByText(/via/)).not.toBeInTheDocument();
  });
});

describe('the second way in', () => {
  it('offers a passkey or a password to an account Sign in with Malafat made, never "if Malafat stops"', async () => {
    portal(`/p/${ORG_A}`, {}, malafatMade());
    const card = (await screen.findByText('Add a second way to sign in')).closest('section')!;
    expect(card).toHaveTextContent('next to Malafat');
    expect(card).not.toHaveTextContent(/stops|down|unavailable/i);
    // MUT-370's card, whose note promises a password, stays away.
    expect(screen.queryByText('Your password still works.')).not.toBeInTheDocument();
  });

  it('Set a password opens Change password with no current password to give', async () => {
    const { user, api } = portal(`/p/${ORG_A}`, { 'POST /v1/me/password': () => ok({}) }, malafatMade());
    await user.click(await screen.findByRole('button', { name: 'Set a password' }));
    const drawer = await screen.findByRole('dialog', { name: 'Set a password' });
    expect(within(drawer).queryByLabelText('Current password')).not.toBeInTheDocument();
    await user.type(within(drawer).getByLabelText('New password'), 'a long enough passphrase');
    await user.click(within(drawer).getByRole('button', { name: /Save|Change/ }));
    await waitFor(() => expect(calls(api.calls, 'POST', '/v1/me/password')).toHaveLength(1));
    expect(calls(api.calls, 'POST', '/v1/me/password')[0]?.body).toEqual({ newPassword: 'a long enough passphrase' });
  });

  it('Not now hides it on this device', async () => {
    const view = portal(`/p/${ORG_A}`, {}, malafatMade());
    await view.user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Add a second way to sign in')).not.toBeInTheDocument();
    view.unmount();
    portal(`/p/${ORG_A}`, {}, malafatMade());
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('Add a second way to sign in')).not.toBeInTheDocument();
  });

  it('is not shown to a person with a way in of their own', async () => {
    portal(`/p/${ORG_A}`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('Add a second way to sign in')).not.toBeInTheDocument();
  });
});
