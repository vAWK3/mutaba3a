import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { AccountantGrant, AccountantGrantList, Me, ShareLink } from '../../../api/client';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';

/** Review fix (d): a person's text inside a sentence is isolated (FSI … PDI). */
const iso = (text: string) => `\u2068${text}\u2069`;

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
/** Accountant access on for this server (`clients`) and this person (MUT-577's `accountant_access` feature). */
const on = (profiles = [personal, studio]): Me => { const base = me(profiles); return { ...base, user: { ...base.user, features: ['accountant_access'] }, clients: [] }; };

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
    expect(await screen.findByRole('heading', { level: 1, name: `Sharing ${iso('Studio')}` })).toBeInTheDocument();
    expect(screen.getByText("Whoever you share with reads expenses, income and receipts only. They can't add or change anything.")).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Accountants' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Profiles/ })).toHaveAttribute('href', `/p/${ORG_B}/you`);
  });

  it.each([
    ['a member of a firm profile', on([personal, firm])],
    ['a server with accountant access off', me([personal, studio])],
    ['MUT-577: a person without the accountant_access feature', { ...me([personal, studio]), clients: [] }],
  ])('%s goes back to You › Profiles', async (_label, account) => {
    const { router } = portal(`/p/${ORG_B}/you/sharing`, {}, account);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/you`));
    expect(screen.queryByRole('heading', { name: /Sharing/ })).not.toBeInTheDocument();
  });

  it('share links off (the list answers 404): Accountants alone, full width, and no Links column', async () => {
    const { stub } = portal(`/p/${ORG_B}/you/sharing`);
    await screen.findByText('Sami Khoury');
    await waitFor(() => expect(stub.count(`GET /v1/profiles/${ORG_B}/share-links`)).toBe(1));
    await waitFor(() => expect(document.querySelector('.hp-sharing-columns--one')).not.toBeNull());
    expect(screen.queryByRole('heading', { name: /Links/ })).not.toBeInTheDocument();
  });

  it('(h) a member of a hosted business profile (not an owner) goes back to You › Profiles', async () => {
    const member = profile({ id: ORG_B, name: 'Partner Studio', owned: false, type: 'BUSINESS', isPersonalDefault: false, writerOfRecord: null });
    const { router, stub } = portal(`/p/${ORG_B}/you/sharing`, {}, on([personal, member]));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/you`));
    expect(stub.count(`GET /v1/profiles/${ORG_B}/accountants`)).toBe(0);
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
    ['MUT-577: a person without the accountant_access feature', { ...me([personal, studio]), clients: [] }],
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
    const confirm = screen.getByRole('group', { name: new RegExp(`Stop ${iso('Sami Khoury')}'s access to ${iso('Studio')}\\?`) });
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Stop access' }));
    await waitFor(() => expect(screen.queryByText('Sami Khoury')).not.toBeInTheDocument());
    expect(stub.count(`DELETE /v1/profiles/${ORG_B}/accountants/g-sami`)).toBe(1);
    expect(await screen.findByText(`${iso('Sami Khoury')} can no longer open ${iso('Studio')}`)).toBeInTheDocument();
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
    expect(await screen.findByText(`Invite to ${iso('maya@ledger.co')} cancelled`)).toBeInTheDocument();
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
    expect(await screen.findByText(`Invite sent to ${iso('h.audit@firm.com')}`)).toBeInTheDocument();
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
    expect(screen.getAllByLabelText('Loading')[0]).toHaveAttribute('aria-busy', 'true');
  });

  it('a failed list keeps the page and its heading, with Retry in the column', async () => {
    let tries = 0;
    const { user } = portal(`/p/${ORG_B}/you/sharing`, { [`GET /v1/profiles/${ORG_B}/accountants`]: () => (tries++ === 0 ? fail(500, 'INTERNAL') : ok(ALL)) });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('heading', { level: 1, name: `Sharing ${iso('Studio')}` })).toBeInTheDocument();
    await user.click(retry);
    expect(await screen.findByText('Sami Khoury')).toBeInTheDocument();
  });
});

describe('review fixes (b, c)', () => {
  it('Invite again refused at the limit reads the list and /v1/me again', async () => {
    const { user, stub } = portal(`/p/${ORG_B}/you/sharing`, { [`POST /v1/profiles/${ORG_B}/accountants`]: () => fail(409, 'CONFLICT', { reason: 'ACCOUNTANT_LIMIT' }) });
    await user.click(await screen.findByRole('button', { name: 'Invite h.audit@firm.com again' }));
    expect(await screen.findByText('This profile already has 5 accountants or invites, the most it can. Stop one first.')).toBeInTheDocument();
    await waitFor(() => expect(stub.count(`GET /v1/profiles/${ORG_B}/accountants`)).toBe(2));
    expect(stub.count('GET /v1/me')).toBeGreaterThanOrEqual(2);
  });

  it('at the limit Invite again is inert and says why', async () => {
    const full = { items: [SAMI, MAYA, HALA], limit: 2 };
    const { user, stub } = portal(`/p/${ORG_B}/you/sharing`, { [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok(full) });
    const again = await screen.findByRole('button', { name: 'Invite h.audit@firm.com again' });
    expect(again).toHaveAttribute('aria-disabled', 'true');
    expect(again).toHaveAccessibleDescription('This profile has 2, the most it can. Stop one to invite someone else.');
    await user.click(again);
    expect(stub.count(`POST /v1/profiles/${ORG_B}/accountants`)).toBe(0);
  });

  it('inviting from the empty page moves focus to the new row', async () => {
    const items: AccountantGrant[] = [];
    const { user } = portal(`/p/${ORG_B}/you/sharing`, {
      [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok({ items, limit: 5 }),
      [`POST /v1/profiles/${ORG_B}/accountants`]: () => {
        items.push(MAYA);
        return ok(MAYA, 201);
      },
    });
    await screen.findByRole('heading', { name: "You haven't shared this profile yet" });
    await user.click(screen.getByRole('button', { name: 'Invite by email' }));
    await user.type(await screen.findByLabelText('Email'), 'maya@ledger.co');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(document.activeElement).toBe(row(/maya@ledger\.co/)));
  });
});

const LINK: ShareLink = {
  id: 'l-live',
  period: 'LAST_3_MONTHS',
  from: '2026-08-01',
  to: '2026-10-31',
  createdAt: '2026-11-05T09:00:00.000Z',
  expiresAt: '2026-11-13T09:00:00.000Z',
  lastOpenedAt: '2026-11-05T12:00:00.000Z',
  status: 'active',
  endedAt: null,
  viewers: 2,
  maxViewers: 3,
  createdByName: 'Nour Haddad',
};
const LOCKED: ShareLink = { ...LINK, id: 'l-locked', period: 'WHOLE_PROFILE', from: null, to: '2026-11-04', status: 'locked', endedAt: '2026-11-06T08:00:00.000Z', lastOpenedAt: null, viewers: 0 };
const ENDED: ShareLink = { ...LINK, id: 'l-ended', period: 'LAST_1_MONTH', from: '2026-09-01', to: '2026-09-30', status: 'expired', endedAt: '2026-11-06T07:00:00.000Z', viewers: 3 };

describe('the Links column (slice B)', () => {
  const links = (items: ShareLink[]) => ({ [`GET /v1/profiles/${ORG_B}/share-links`]: () => ok({ items, limit: 3 }) });

  it('two columns; each link with its months, ends, last opened, viewers; locked and ended marked; ended has no action', async () => {
    portal(`/p/${ORG_B}/you/sharing`, links([LINK, LOCKED, ENDED]));
    const table = await screen.findByRole('table', { name: 'Links with a PIN' });
    expect(document.querySelector('.hp-sharing-columns--one')).toBeNull();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Aug – Oct 2026');
    expect(rows[0]).toHaveTextContent('Nov 13');
    expect(rows[0]).toHaveTextContent('yesterday');
    expect(rows[0]).toHaveTextContent('2 / 3');
    expect(within(rows[0]).getByRole('button', { name: 'Turn off the link for Aug – Oct 2026' })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Whole profile');
    expect(rows[1]).toHaveTextContent('Locked');
    expect(rows[1]).toHaveTextContent('—');
    expect(within(rows[1]).getByRole('button', { name: /Turn off/ })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('Sep 2026');
    expect(rows[2]).toHaveTextContent('Ended Nov 6');
    expect(within(rows[2]).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/A link is never shown twice/)).toBeInTheDocument();
  });

  it('Turn off confirms in place; confirming sends DELETE, the row reads Ended, and it is counted', async () => {
    let off = false;
    const { user, stub } = portal(`/p/${ORG_B}/you/sharing`, {
      [`GET /v1/profiles/${ORG_B}/share-links`]: () => ok({ items: [off ? { ...LINK, status: 'revoked', endedAt: NOW.toISOString() } : LINK], limit: 3 }),
      [`DELETE /v1/profiles/${ORG_B}/share-links/l-live`]: () => {
        off = true;
        return new Response(null, { status: 204 });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Turn off the link for Aug – Oct 2026' }));
    const confirm = screen.getByRole('group', { name: /Turn off the link for Aug – Oct 2026\?/ });
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Turn off link' }));
    expect(await screen.findByText('Link turned off')).toBeInTheDocument();
    expect(stub.count(`DELETE /v1/profiles/${ORG_B}/share-links/l-live`)).toBe(1);
    await waitFor(() => expect(screen.getByRole('table', { name: 'Links with a PIN' })).toHaveTextContent('Ended Nov 6'));
    expect(track).toHaveBeenCalledWith('share_link_revoked', { was: 'active' });
  });

  it('at the limit of live links Create link is inert and says why', async () => {
    portal(`/p/${ORG_B}/you/sharing`, { [`GET /v1/profiles/${ORG_B}/share-links`]: () => ok({ items: [LINK, LOCKED], limit: 2 }) });
    await screen.findByRole('table', { name: 'Links with a PIN' });
    expect(screen.getByRole('button', { name: 'Create link' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Create link' })).toHaveAccessibleDescription('This profile has 2 live links, the most it can. Turn one off to make another.');
  });

  it('a failing links list keeps the Accountants column, with Retry in its own', async () => {
    portal(`/p/${ORG_B}/you/sharing`, { [`GET /v1/profiles/${ORG_B}/share-links`]: () => fail(500, 'INTERNAL') });
    expect(await screen.findByText('Sami Khoury')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Links with a PIN' })).toBeInTheDocument();
  });

  it('nothing shared, links on: the empty page offers both ways, and Create opens the drawer by URL', async () => {
    const { user, router } = portal(`/p/${ORG_B}/you/sharing`, { [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok({ items: [], limit: 5 }), ...links([]) });
    await screen.findByRole('heading', { name: "You haven't shared this profile yet" });
    await user.click(await screen.findByRole('button', { name: 'Create a link with a PIN' }));
    expect(await screen.findByRole('dialog', { name: 'New link' })).toBeInTheDocument();
    expect(locationOf(router)).toContain('newLink=true');
  });
});

describe('MUT-577: the accountant_access feature', () => {
  it('off: no row in the Manage profiles edit pane either', async () => {
    portal(`/p/${ORG_A}/you?manageProfiles=true&editProfile=${ORG_B}`, {}, { ...me([personal, studio]), clients: [] });
    const dialog = await screen.findByRole('dialog', { name: 'Studio' });
    expect(within(dialog).queryByRole('link', { name: /^Sharing/ })).not.toBeInTheDocument();
  });
});

