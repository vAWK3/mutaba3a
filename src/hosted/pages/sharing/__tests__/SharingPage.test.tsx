import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { AccountantGrant, AccountantGrantList, Me } from '../../../api/client';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';

const track = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../../analytics/portalAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../analytics/portalAnalytics')>()),
  trackPortal: track,
}));

/**
 * MUT-561 slice A: the owner's Sharing page (layout B). Who gets it and the ways in (D8), the Accountants column's
 * rows and their actions, the empty page, per-column loading and errors. The Links column (MUT-560) is off, so the
 * page runs as a server with SHARE_LINKS off does: Accountants alone, and the empty page offers Invite only.
 */

const NOW = new Date('2026-11-06T10:00:00.000Z');
const personal = profile({ id: ORG_A, name: 'Personal', owned: true, type: 'PERSONAL', isPersonalDefault: true, writerOfRecord: null, owners: [] });
const studio = profile({ id: ORG_B, name: 'Studio', owned: true, type: 'BUSINESS', isPersonalDefault: false, writerOfRecord: null, owners: [] });
const firm = profile({ id: ORG_B, name: 'Haddad & Partners', owned: false });
const on = (profiles = [personal, studio]): Me => ({ ...me(profiles), clients: [] });

const SAMI: AccountantGrant = {
  id: 'g-sami',
  email: 'sami@khoury-cpa.com',
  name: 'Sami Khoury',
  status: 'active',
  invitedAt: '2026-10-10T09:00:00.000Z',
  expiresAt: '2026-10-24T09:00:00.000Z',
  acceptedAt: '2026-10-12T09:00:00.000Z',
  lastViewedAt: '2026-11-04T08:00:00.000Z',
};
const MAYA: AccountantGrant = { id: 'g-maya', email: 'maya@ledger.co', name: null, status: 'pending', invitedAt: '2026-11-03T09:00:00.000Z', expiresAt: '2026-11-17T09:00:00.000Z', acceptedAt: null, lastViewedAt: null };
const HALA: AccountantGrant = { id: 'g-hala', email: 'h.audit@firm.com', name: null, status: 'expired', invitedAt: '2026-10-01T09:00:00.000Z', expiresAt: '2026-10-15T09:00:00.000Z', acceptedAt: null, lastViewedAt: null };
const ALL: AccountantGrantList = { items: [SAMI, MAYA, HALA], limit: 5 };

function portal(path: string, routes: Record<string, Handler> = {}, account: Me = on()) {
  const stub = stubApi({
    ...emptyProfileRoutes(),
    'GET /v1/me': () => ok(account),
    [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok(ALL),
    ...routes,
  });
  return { ...renderPortal(path), stub };
}

const row = (name: RegExp) => screen.getAllByRole('listitem').find((item) => name.test(item.textContent ?? '')) as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  track.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('who gets the Sharing page (D8)', () => {
  it('an owner, signed in, with accountant access: the title, the scope note, the Accountants column', async () => {
    portal(`/p/${ORG_B}/you/sharing`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sharing Studio' })).toBeInTheDocument();
    expect(screen.getByText("Whoever you share with reads expenses, income and receipts only. They can't add or change anything.")).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Accountants' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Profiles/ })).toHaveAttribute('href', `/p/${ORG_B}/you`);
  });

  it.each([
    ['a member of a firm profile', on([personal, firm])],
    ['a server with accountant access off', me([personal, studio])],
  ])('%s goes back to You › Profiles', async (_label, account) => {
    const { router } = portal(`/p/${ORG_B}/you/sharing`, {}, account);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/you`));
    expect(screen.queryByRole('heading', { name: /Sharing/ })).not.toBeInTheDocument();
  });

  it('runs as SHARE_LINKS off: Accountants alone, full width, and no Links column (TODO MUT-560)', async () => {
    const { stub } = portal(`/p/${ORG_B}/you/sharing`);
    await screen.findByText('Sami Khoury');
    expect(screen.queryByRole('heading', { name: /Links/ })).not.toBeInTheDocument();
    expect(document.querySelector('.hp-sharing-columns--one')).not.toBeNull();
    expect(stub.calls.some((call) => call.url.pathname.includes('share-links'))).toBe(false);
  });
});

describe('the ways in', () => {
  it('You › Profiles offers "Share with your accountant" for the open profile, to its owner', async () => {
    const { user, router } = portal(`/p/${ORG_B}/you`);
    const link = await screen.findByRole('link', { name: /Share with your accountant/ });
    expect(link).toHaveTextContent('Studio');
    await user.click(link);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/you/sharing`));
  });

  it.each([
    ['a member of a firm profile', on([personal, firm])],
    ['a server with accountant access off', me([personal, studio])],
  ])('You › Profiles has no such row for %s', async (_label, account) => {
    portal(`/p/${ORG_B}/you`, {}, account);
    await screen.findByRole('button', { name: /Manage profiles/ });
    expect(screen.queryByRole('link', { name: /Share with your accountant/ })).not.toBeInTheDocument();
  });

  it("Manage profiles' edit pane has a Sharing row that opens that profile's page", async () => {
    const { user, router } = portal(`/p/${ORG_A}/you?manageProfiles=true&editProfile=${ORG_B}`);
    const dialog = await screen.findByRole('dialog', { name: 'Studio' });
    await user.click(within(dialog).getByRole('link', { name: /^Sharing/ }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/you/sharing`));
  });
});

describe('the Accountants column (B1)', () => {
  it('lists active, pending and expired with their meta, chip and one action; the limit under them', async () => {
    portal(`/p/${ORG_B}/you/sharing`);
    await screen.findByText('Sami Khoury');
    const sami = row(/Sami Khoury/);
    expect(sami).toHaveTextContent('sami@khoury-cpa.com');
    expect(sami).toHaveTextContent('Since Oct 12 · viewed 2 days ago');
    expect(within(sami).getByText('Active')).toBeInTheDocument();
    expect(within(sami).getByRole('button', { name: "Stop Sami Khoury's access" })).toHaveTextContent('Stop');

    const maya = row(/maya@ledger\.co/);
    expect(maya).toHaveTextContent('Sent Nov 3 · ends Nov 17');
    expect(within(maya).getByText('Pending')).toBeInTheDocument();
    expect(within(maya).getByRole('button', { name: 'Cancel the invite to maya@ledger.co' })).toBeInTheDocument();

    const hala = row(/h\.audit@firm\.com/);
    expect(hala).toHaveTextContent('Not accepted within 14 days');
    expect(within(hala).getByText('Expired')).toBeInTheDocument();
    expect(within(hala).getByRole('button', { name: 'Invite h.audit@firm.com again' })).toBeInTheDocument();

    expect(screen.getByText('Up to 5 accountants per profile.')).toBeInTheDocument();
  });

  it('Stop confirms in place with focus on Cancel; confirming sends DELETE, the row goes, and it is counted', async () => {
    let stopped = false;
    const { user, stub } = portal(`/p/${ORG_B}/you/sharing`, {
      [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok(stopped ? { ...ALL, items: [MAYA, HALA] } : ALL),
      [`DELETE /v1/profiles/${ORG_B}/accountants/g-sami`]: () => {
        stopped = true;
        return new Response(null, { status: 204 });
      },
    });
    await user.click(await screen.findByRole('button', { name: "Stop Sami Khoury's access" }));
    const confirm = screen.getByRole('group', { name: /Stop Sami Khoury's access to Studio\?/ });
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Stop access' }));
    await waitFor(() => expect(screen.queryByText('Sami Khoury')).not.toBeInTheDocument());
    expect(stub.count(`DELETE /v1/profiles/${ORG_B}/accountants/g-sami`)).toBe(1);
    expect(await screen.findByText('Sami Khoury can no longer open Studio')).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('accountant_revoked', { was: 'active' });
  });

  it('Cancel on the confirm puts the Stop button back, focused, and sends nothing', async () => {
    const { user, stub } = portal(`/p/${ORG_B}/you/sharing`);
    await user.click(await screen.findByRole('button', { name: "Stop Sami Khoury's access" }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: "Stop Sami Khoury's access" })).toHaveFocus());
    expect(stub.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  it('cancelling a pending invite counts was: pending', async () => {
    const { user } = portal(`/p/${ORG_B}/you/sharing`, { [`DELETE /v1/profiles/${ORG_B}/accountants/g-maya`]: () => new Response(null, { status: 204 }) });
    await user.click(await screen.findByRole('button', { name: 'Cancel the invite to maya@ledger.co' }));
    await user.click(screen.getByRole('button', { name: 'Cancel invite' }));
    expect(await screen.findByText('Invite to maya@ledger.co cancelled')).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('accountant_revoked', { was: 'pending' });
  });

  it('a Stop the server refuses puts the row back and says so (D11)', async () => {
    let lists = 0;
    const { user } = portal(`/p/${ORG_B}/you/sharing`, {
      [`GET /v1/profiles/${ORG_B}/accountants`]: () => (lists++ === 0 ? ok(ALL) : never()),
      [`DELETE /v1/profiles/${ORG_B}/accountants/g-sami`]: () => fail(500, 'INTERNAL'),
    });
    await user.click(await screen.findByRole('button', { name: "Stop Sami Khoury's access" }));
    await user.click(screen.getByRole('button', { name: 'Stop access' }));
    expect(await screen.findByText("That didn't go through. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.getByText('Sami Khoury')).toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  it('Invite again sends the same address in the portal language, with no confirm', async () => {
    const fresh: AccountantGrant = { ...HALA, id: 'g-hala-2', status: 'pending', invitedAt: NOW.toISOString(), expiresAt: '2026-11-20T10:00:00.000Z' };
    const { user, stub } = portal(`/p/${ORG_B}/you/sharing`, { [`POST /v1/profiles/${ORG_B}/accountants`]: () => ok(fresh, 201) });
    await user.click(await screen.findByRole('button', { name: 'Invite h.audit@firm.com again' }));
    expect(await screen.findByText('Invite sent to h.audit@firm.com')).toBeInTheDocument();
    expect(stub.calls.find((call) => call.method === 'POST')?.body).toEqual({ email: 'h.audit@firm.com', locale: 'en' });
    expect(track).toHaveBeenCalledWith('accountant_invited', {});
  });

  it('at the limit, Invite by email says why and opens nothing', async () => {
    const full = { items: [SAMI, MAYA], limit: 2 };
    const { user, router } = portal(`/p/${ORG_B}/you/sharing`, { [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok(full) });
    const invite = await screen.findByRole('button', { name: 'Invite by email' });
    await screen.findByText('Sami Khoury');
    expect(invite).toHaveAttribute('aria-disabled', 'true');
    expect(invite).toHaveAccessibleDescription('This profile has 2, the most it can. Stop one to invite someone else.');
    await user.click(invite);
    expect(locationOf(router)).not.toContain('invite');
  });

  it('Invite by email opens the drawer by its URL key', async () => {
    const { user, router } = portal(`/p/${ORG_B}/you/sharing`);
    await screen.findByText('Sami Khoury');
    await user.click(screen.getByRole('button', { name: 'Invite by email' }));
    expect(await screen.findByRole('dialog', { name: 'Invite an accountant' })).toBeInTheDocument();
    expect(locationOf(router)).toContain('invite=true');
  });
});

describe('empty, loading and errors', () => {
  it('nothing shared yet: the scene, the title, the four points and Invite only (links off)', async () => {
    portal(`/p/${ORG_B}/you/sharing`, { [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok({ items: [], limit: 5 }) });
    expect(await screen.findByRole('heading', { name: "You haven't shared this profile yet" })).toBeInTheDocument();
    expect(document.querySelector('[data-scene="accountant-empty"]')).not.toBeNull();
    const points = screen.getByRole('list', { name: 'What whoever you share with can do' });
    expect(within(points).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Sees this profile’s expenses, income and receipts',
      'Can download them for a period',
      'Can’t add, change or delete anything',
      'Doesn’t see your other profiles or your account',
    ]);
    expect(screen.getByRole('button', { name: 'Invite by email' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /link/i })).not.toBeInTheDocument();
  });

  it('loading shows the column skeleton under its heading', async () => {
    portal(`/p/${ORG_B}/you/sharing`, { [`GET /v1/profiles/${ORG_B}/accountants`]: never });
    await screen.findByRole('heading', { name: 'Accountants' });
    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('a failed list keeps the page and its heading, with Retry in the column', async () => {
    let tries = 0;
    const { user } = portal(`/p/${ORG_B}/you/sharing`, { [`GET /v1/profiles/${ORG_B}/accountants`]: () => (tries++ === 0 ? fail(500, 'INTERNAL') : ok(ALL)) });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('heading', { level: 1, name: 'Sharing Studio' })).toBeInTheDocument();
    await user.click(retry);
    expect(await screen.findByText('Sami Khoury')).toBeInTheDocument();
  });
});
