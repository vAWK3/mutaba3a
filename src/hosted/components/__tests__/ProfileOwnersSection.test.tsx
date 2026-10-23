import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import type { HostedProfile } from '../../api/client';
import { SUPPORT_EMAIL } from '../../terms';
import { useLostAccess } from '../../session/lostAccess';

/**
 * MUT-373 (ADR-163, design review DR1–DR14): the Owners section of a Business profile's edit pane. The creator
 * removes a co-owner from their row; a co-owner leaves from the foot; both confirm in place, and the confirm waits
 * while the request runs (DR5).
 */

const STUDIO = 'd1111111-1111-4111-8111-111111111111';
const ME = me().user.id;
const BASEL = 'b1111111-1111-4111-8111-111111111111';
const LINA = 'c1111111-1111-4111-8111-111111111111';
const owner = (userId: string, name: string | null, creator: boolean) => ({ userId, name, email: `${userId.slice(0, 4)}@studio.ps`, creator });
const base = { id: STUDIO, name: 'Sader & Haddad', writerOfRecord: null, owned: true, type: 'BUSINESS', version: 1 } as const;
const builtIn = profile({ id: ORG_B, name: 'Personal', writerOfRecord: null, owned: true, type: 'PERSONAL', isPersonalDefault: true, owners: [owner(ME, 'Nour Haddad', true)] });
/** The viewer created it and shares it with Lina. */
const created = profile({ ...base, owners: [owner(ME, 'Nour Haddad', true), owner(LINA, 'Lina Saleh', false)] });
/** Basel created it; the viewer co-owns it. */
const coOwned = profile({ ...base, owners: [owner(BASEL, 'Basel Sader', true), owner(ME, 'Nour Haddad', false)] });

function portal(profiles: HostedProfile[], routes: Record<string, Handler> = {}, path = `/p/${ORG_B}?editProfile=${STUDIO}`) {
  let current = profiles;
  const api = stubApi({
    'GET /v1/me': () => ok(me(current)),
    ...emptyProfileRoutes(),
    'GET /v1/expense-categories': () => ok([]),
    'GET /v1/expenses': () => ok({ items: [], nextCursor: null }),
    ...routes,
  });
  return { ...renderPortal(path), api, setProfiles: (next: HostedProfile[]) => (current = next) };
}

const deletes = (calls: { method: string; url: URL }[]) => calls.filter((c) => c.method === 'DELETE' && c.url.pathname.includes('/owners/'));

/** A response the test releases when it chooses, to hold a request in flight. */
function deferred() {
  let release: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => (release = resolve));
  return { handler: () => promise, release };
}

afterEach(() => {
  vi.unstubAllGlobals();
  useLostAccess.getState().reset();
  localStorage.removeItem(PORTAL_LANGUAGE_KEY);
});

describe('Owners section (MUT-373)', () => {
  it('lists owners creator-first with You and Created, then firm features below it (DR1, DR9)', async () => {
    portal([created, builtIn]);
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    const section = within(dialog).getByRole('region', { name: 'Owners' });
    const rows = within(section).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Nour Haddad');
    expect(rows[0]).toHaveTextContent('You');
    expect(rows[0]).toHaveTextContent('Created this profile');
    expect(rows[1]).toHaveTextContent('Lina Saleh');
    const firm = within(dialog).getByRole('region', { name: 'Use this profile for a firm' });
    expect(section.compareDocumentPosition(firm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lets the creator remove a co-owner after confirming, and says so (AD2, AD3)', async () => {
    const { user, api, setProfiles } = portal([created, builtIn], {
      [`DELETE /v1/profiles/${STUDIO}/owners/${LINA}`]: () => {
        setProfiles([{ ...created, owners: [owner(ME, 'Nour Haddad', true)] }, builtIn]);
        return ok({ result: 'removed' });
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove Lina Saleh' }));
    const confirm = within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' });
    expect(confirm).toHaveTextContent('Lina Saleh loses access to Sader & Haddad. What they recorded stays.');
    await user.click(within(confirm).getByRole('button', { name: 'Remove Lina Saleh' }));
    await waitFor(() => expect(deletes(api.calls)).toHaveLength(1));
    expect(deletes(api.calls)[0].headers.get('Idempotency-Key')).toMatch(/.+/);
    expect(await screen.findByText('Lina Saleh removed from Sader & Haddad')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByText('Lina Saleh')).toBeNull());
  });

  it('keeps the confirm open with a banner when the network fails, and retries with the same key (DR5)', async () => {
    let attempts = 0;
    const { user, api } = portal([created, builtIn], {
      [`DELETE /v1/profiles/${STUDIO}/owners/${LINA}`]: () => {
        if (++attempts === 1) throw new TypeError('network down');
        return ok({ result: 'removed' });
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove Lina Saleh' }));
    const confirm = within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove Lina Saleh' }));
    expect(await within(dialog).findByText(/Can't reach MTB3A/)).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' })).toBeInTheDocument();
    await user.click(within(within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' })).getByRole('button', { name: 'Remove Lina Saleh' }));
    await waitFor(() => expect(deletes(api.calls)).toHaveLength(2));
    const [first, second] = deletes(api.calls);
    expect(second.headers.get('Idempotency-Key')).toBe(first.headers.get('Idempotency-Key'));
  });

  it('moves focus to the Owners heading once the last removable row has gone (DR6)', async () => {
    const { user, setProfiles } = portal([created, builtIn], {
      [`DELETE /v1/profiles/${STUDIO}/owners/${LINA}`]: () => {
        setProfiles([{ ...created, owners: [owner(ME, 'Nour Haddad', true)] }, builtIn]);
        return ok({ result: 'removed' });
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove Lina Saleh' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' })).getByRole('button', { name: 'Remove Lina Saleh' }));
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Owners' })).toHaveFocus());
  });

  it('moves focus to the next owner’s Remove after a removal, not the heading (DR6)', async () => {
    const OMAR = 'e1111111-1111-4111-8111-111111111111';
    const three = profile({ ...base, owners: [owner(ME, 'Nour Haddad', true), owner(LINA, 'Lina Saleh', false), owner(OMAR, 'Omar Khalil', false)] });
    const { user, setProfiles } = portal([three, builtIn], {
      [`DELETE /v1/profiles/${STUDIO}/owners/${LINA}`]: () => {
        setProfiles([{ ...three, owners: [owner(ME, 'Nour Haddad', true), owner(OMAR, 'Omar Khalil', false)] }, builtIn]);
        return ok({ result: 'removed' });
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove Lina Saleh' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' })).getByRole('button', { name: 'Remove Lina Saleh' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Remove Omar Khalil' })).toHaveFocus());
  });

  it('cancels without sending anything, and returns focus to that row’s Remove', async () => {
    const { user, api } = portal([created, builtIn]);
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove Lina Saleh' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Remove Lina Saleh' })).toHaveFocus());
    expect(deletes(api.calls)).toHaveLength(0);
  });

  it('keeps the confirm and the row when the server refuses (NOT_CREATOR), and says why', async () => {
    const { user } = portal([created, builtIn], {
      [`DELETE /v1/profiles/${STUDIO}/owners/${LINA}`]: () => fail(403, 'READ_ONLY_PROFILE', { reason: 'NOT_CREATOR' }),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove Lina Saleh' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' })).getByRole('button', { name: 'Remove Lina Saleh' }));
    expect(await within(dialog).findByText('Only the person who created this profile can remove someone.')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' })).toBeInTheDocument();
    expect(within(dialog).getByText('Lina Saleh')).toBeInTheDocument();
  });

  it('stays open while a removal is in flight: Escape waits for the answer (DR5)', async () => {
    const held = deferred();
    const { user } = portal([created, builtIn], { [`DELETE /v1/profiles/${STUDIO}/owners/${LINA}`]: held.handler });
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove Lina Saleh' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' })).getByRole('button', { name: 'Remove Lina Saleh' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Sader & Haddad' })).toBeInTheDocument();
    held.release(ok({ result: 'removed' }));
    expect(await screen.findByText('Lina Saleh removed from Sader & Haddad')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('treats someone already removed elsewhere as done (DR5)', async () => {
    const { user } = portal([created, builtIn], { [`DELETE /v1/profiles/${STUDIO}/owners/${LINA}`]: () => fail(404, 'NOT_FOUND') });
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove Lina Saleh' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Remove Lina Saleh?' })).getByRole('button', { name: 'Remove Lina Saleh' }));
    expect(await screen.findByText('Lina Saleh removed from Sader & Haddad')).toBeInTheDocument();
  });

  it('gives a co-owner Leave at the foot, not Remove on anyone, and hides Save while the leave confirm is open (AD1, DR4)', async () => {
    const { user } = portal([coOwned, builtIn]);
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    expect(within(dialog).queryByRole('button', { name: /^Remove/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Leave Sader & Haddad' }));
    const confirm = within(dialog).getByRole('group', { name: 'Leave Sader & Haddad?' });
    expect(confirm).toHaveTextContent("You'll lose access to Sader & Haddad. What you recorded stays.");
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('leaving the open profile lands on the personal profile with a toast, and closes the drawer (DR4)', async () => {
    const { user, setProfiles } = portal(
      [coOwned, builtIn],
      {
        [`DELETE /v1/profiles/${STUDIO}/owners/${ME}`]: () => {
          setProfiles([builtIn]);
          return ok({ result: 'left' });
        },
      },
      `/p/${STUDIO}?editProfile=${STUDIO}`,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Leave Sader & Haddad' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Leave Sader & Haddad?' })).getByRole('button', { name: 'Leave Sader & Haddad' }));
    expect(await screen.findByText('You left Sader & Haddad')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText("This profile isn't available")).toBeNull();
    expect(screen.queryByText(/You no longer have access/)).toBeNull();
  });

  it.each([
    ['the network fails', () => Promise.reject(new TypeError('network down')), /Can't reach MTB3A/],
    ['the creator tries to leave', () => fail(409, 'CONFLICT', { reason: 'CREATOR_CANNOT_LEAVE' }), /you can't leave it/],
  ] as const)('keeps the leave confirm open with a banner, Save still hidden, when %s', async (_label, answer, banner) => {
    const { user, router } = portal([coOwned, builtIn], { [`DELETE /v1/profiles/${STUDIO}/owners/${ME}`]: answer as Handler }, `/p/${STUDIO}?editProfile=${STUDIO}`);
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Leave Sader & Haddad' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Leave Sader & Haddad?' })).getByRole('button', { name: 'Leave Sader & Haddad' }));
    expect(await within(dialog).findByText(banner)).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Leave Sader & Haddad?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(locationOf(router)).toContain(`/p/${STUDIO}`);
  });

  it('treats a leave the server no longer knows (404) as left: personal profile, toast, no lost-access banner', async () => {
    const { user, setProfiles } = portal(
      [coOwned, builtIn],
      {
        [`DELETE /v1/profiles/${STUDIO}/owners/${ME}`]: () => {
          setProfiles([builtIn]);
          return fail(404, 'NOT_FOUND');
        },
      },
      `/p/${STUDIO}?editProfile=${STUDIO}`,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Leave Sader & Haddad' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Leave Sader & Haddad?' })).getByRole('button', { name: 'Leave Sader & Haddad' }));
    expect(await screen.findByText('You left Sader & Haddad')).toBeInTheDocument();
    expect(screen.queryByText(/You no longer have access/)).toBeNull();
  });

  it('leaving a profile that isn’t open closes the drawer and stays on the open profile', async () => {
    const { user, router, setProfiles } = portal([coOwned, builtIn], {
      [`DELETE /v1/profiles/${STUDIO}/owners/${ME}`]: () => {
        setProfiles([builtIn]);
        return ok({ result: 'left' });
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    await user.click(within(dialog).getByRole('button', { name: 'Leave Sader & Haddad' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Leave Sader & Haddad?' })).getByRole('button', { name: 'Leave Sader & Haddad' }));
    expect(await screen.findByText('You left Sader & Haddad')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(locationOf(router)).toMatch(new RegExp(`^/p/${ORG_B}`));
  });

  it('locks the Personal type card on a shared profile, and explains it at the card', async () => {
    portal([created, builtIn]);
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    expect(within(dialog).getByRole('radio', { name: /Personal/ })).toBeDisabled();
    expect(within(dialog).getByText('A shared profile stays Business.')).toBeInTheDocument();
  });

  it('offers a solo creator the add-a-partner email, prefilled, with the address to copy (AD5, DR14)', async () => {
    portal([profile({ ...base, owners: [owner(ME, 'Nour Haddad', true)] }), builtIn]);
    const dialog = await screen.findByRole('dialog', { name: 'Sader & Haddad' });
    const section = within(dialog).getByRole('region', { name: 'Owners' });
    expect(section).toHaveTextContent('Only you own this profile.');
    const link = within(section).getByRole('link', { name: 'write to us' });
    const href = new URL(link.getAttribute('href')!);
    expect(href.protocol).toBe('mailto:');
    expect(href.pathname).toBe(SUPPORT_EMAIL);
    expect(href.searchParams.get('subject')).toBe('Add a partner to Sader & Haddad');
    expect(href.searchParams.get('body')).toContain('Their email:');
    expect(section).toHaveTextContent(SUPPORT_EMAIL);
  });

  it('never shows on the built-in personal profile', async () => {
    portal([created, builtIn], {}, `/p/${ORG_B}?editProfile=${ORG_B}`);
    await screen.findByRole('dialog', { name: 'Personal' });
    expect(screen.queryByRole('region', { name: 'Owners' })).toBeNull();
  });
});

describe('Shared cue and cap hint (MUT-373 DR2, DR12)', () => {
  it('names the other owners in the Manage list, and explains the count to a co-owner', async () => {
    portal([coOwned, builtIn], {}, `/p/${ORG_B}?manageProfiles=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Profiles' });
    expect(within(dialog).getByText('Business · Shared with Basel Sader')).toBeInTheDocument();
    expect(within(dialog).getByText("Profiles shared with you don't count.")).toBeInTheDocument();
  });
});

describe('Lost access (MUT-373 DR3)', () => {
  it('moves someone removed while working to their personal profile, with a banner naming the profile', async () => {
    const { setProfiles, queryClient } = portal([coOwned, builtIn], {}, `/p/${STUDIO}`);
    await screen.findAllByText('Sader & Haddad');
    setProfiles([builtIn]);
    // Any 404 on the open profile re-reads /v1/me (QueryView); here the re-read is triggered directly.
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    expect(await screen.findByText('You no longer have access to Sader & Haddad. What you recorded stays.')).toBeInTheDocument();
  });

  it('closes the banner for good once dismissed', async () => {
    const { user, setProfiles, queryClient } = portal([coOwned, builtIn], {}, `/p/${STUDIO}`);
    await screen.findAllByText('Sader & Haddad');
    setProfiles([builtIn]);
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    const banner = await screen.findByText(/You no longer have access to Sader & Haddad/);
    await user.click(within(banner.closest('.hp-lost-access') as HTMLElement).getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/You no longer have access/)).toBeNull();
    expect(useLostAccess.getState().lost).toBeNull();
  });

  it('shows the plain unavailable screen for a deep link to a profile never open in this tab', async () => {
    portal([builtIn], {}, `/p/${STUDIO}`);
    expect(await screen.findByText("This profile isn't available")).toBeInTheDocument();
    expect(screen.queryByText(/You no longer have access/)).toBeNull();
  });
});
